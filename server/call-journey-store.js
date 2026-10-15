'use strict';
const fs = require('node:fs');
const path = require('node:path');
const State = require('./state');
const Storage = require('./storage');
const Audit = require('./audit');
const History = require('./stage-history');
const Policy = require('./call-journey-policy');
let setup;
let localQueue = Promise.resolve();
const pg = () => Boolean(State.postgresPool && Storage.usesPostgresStorage());
async function ensure() {
  await Storage.ensureStorage();
  if (pg()) {
    setup ||= (async () => {
      const client = await State.postgresPool.connect();
      try {
        await client.query('begin');
        // Several task/review requests (or server processes) can arrive together.
        // Run the additive schema setup once at a time, and commit it atomically.
        await client.query('select pg_advisory_xact_lock(hashtext($1))', ['kbc:call-journey-schema:v1']);
        await client.query(fs.readFileSync(path.join(__dirname, '../sql/2026-10-15_call_driven_journey.sql'), 'utf8'));
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally { client.release(); }
    })().catch(error => { setup = null; throw error; });
    await setup;
  }
}
function adapter(client, db) {
  if (db) { db.meta ||= {}; db.meta.callResults ||= []; History.syncLocal(db); }
  return {
    db,
    async userExists(id) {
      if (db) return (db.users || []).some(user => String(user.id) === String(id));
      const table = Storage.sqlIdentifier(require('./config').POSTGRES_USERS_TABLE, 'app_users');
      return Boolean((await client.query(`select id from ${table} where id=$1`, [id])).rows[0]);
    },
    async result(eventId, evaluationId = null) {
      if (db) return db.meta.callResults.find(row => row.event_id === eventId || (evaluationId && row.evaluation_id === evaluationId));
      return (await client.query('select data from app_call_results where event_id = $1 or evaluation_id = $2 for update', [eventId, evaluationId])).rows[0]?.data;
    },
    async lockEvent(eventId) { if (client) await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`call-result:${eventId}`]); },
    async candidates(result) {
      let calls, meetings;
      if (db) { calls = db.zoom?.calls || []; meetings = db.events || []; }
      else {
        calls = (await client.query(`select c as data from app_workspace w cross join lateral jsonb_array_elements(coalesce(w.meta->'zoom'->'calls','[]'::jsonb)) c
          where w.id = 'main' and (c->>'id' = $1 or c->>'zoom_call_id' = $1 or c->>'zoom_call_history_uuid' = $1 or c->>'meeting_uuid' = $2 or c->>'zoom_meeting_uuid' = $2)`, [result.external_call_id || null, result.meeting_uuid || null])).rows.map(row => row.data);
        meetings = result.meeting_uuid ? (await client.query("select data from app_events where data->>'zoom_meeting_uuid' = $1 limit 3", [result.meeting_uuid])).rows.map(row => row.data) : [];
      }
      const rows = [...calls, ...meetings.filter(item => item.zoom_meeting_uuid).map(item => {
        const ids = [...new Set((item.attendees || []).map(attendee => attendee.lead_id).filter(Boolean))];
        return { ...item, lead_id: item.lead_id || (ids.length === 1 ? ids[0] : ''), ambiguous: ids.length > 1 };
      })];
      return rows.filter(item => (!result.external_call_id || [item.id, item.zoom_call_id, item.zoom_call_history_uuid].includes(result.external_call_id))
        && (!result.meeting_uuid || [item.meeting_uuid, item.zoom_meeting_uuid].includes(result.meeting_uuid)));
    },
    async lead(id, lock = true) {
      if (db) return db.leads.find(item => String(item.id) === String(id) && !item.deleted_at);
      return (await client.query(`select data from app_leads where id = $1 and coalesce(data->>'deleted_at','') = '' ${lock ? 'for update' : ''}`, [id])).rows[0]?.data;
    },
    async resources(leadId) {
      if (db) return { applications: (db.applications || []).filter(item => item.lead_id === leadId), agreements: db.employerAgreements || db.meta.employerAgreements || [] };
      const applications = await client.query('select data from app_applications where lead_id = $1', [leadId]);
      const agreements = await client.query("select coalesce(meta->'employerAgreements','[]'::jsonb) as items from app_workspace where id = 'main'");
      return { applications: applications.rows.map(row => row.data), agreements: agreements.rows[0]?.items || [] };
    },
    async saveResult(row, isNew = false) {
      if (db) {
        const index = db.meta.callResults.findIndex(item => item.event_id === row.event_id);
        if (index < 0) db.meta.callResults.push(row); else db.meta.callResults[index] = row;
      } else if (isNew) await client.query(`insert into app_call_results(event_id,evaluation_id,call_id,lead_id,assignee_id,review_status,received_at,payload_hash,data)
        values($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::jsonb)`, [row.event_id, row.evaluation_id, row.call_id, row.lead_id, row.assignee_id, row.review_status, row.received_at, row.payload_hash, JSON.stringify(row)]);
      else await client.query('update app_call_results set review_status=$2,assignee_id=$3,data=$4::jsonb where event_id=$1', [row.event_id, row.review_status, row.assignee_id, JSON.stringify(row)]);
    },
    async saveLead(lead, context) {
      if (db) { db.__stage_context ||= {}; db.__stage_context[lead.id] ||= context; }
      else {
        await client.query("select set_config('kbc.stage_context',$1,true)", [JSON.stringify(context)]);
        await client.query('update app_leads set stage=$2,next_action_at=$3::timestamptz,data=$4::jsonb where id=$1', [lead.id, lead.stage, lead.next_action_at || null, JSON.stringify(lead)]);
      }
    },
    async task(task) {
      if (db) { db.tasks ||= []; const existing = db.tasks.find(item => item.id === task.id); if (!existing) db.tasks.push(task); return existing || task; }
      const inserted = await client.query(`insert into app_tasks(id,title,lead_id,kind,status,due_at,completed_at,priority,owner_id,data)
        values($1,$2,$3,$4,'Open',$5::timestamptz,null,$6,$7,$8::jsonb) on conflict(id) do nothing returning data`,
      [task.id, task.title, task.lead_id, task.kind, task.due_at, task.priority, task.owner_id, JSON.stringify(task)]);
      return inserted.rows[0]?.data || (await client.query('select data from app_tasks where id=$1', [task.id])).rows[0]?.data;
    },
    async audit(user, action, leadId, detail = '') {
      if (db) { db.audit ||= []; Audit.addAudit(db, user, action, 'lead', leadId, detail); }
      else await Audit.appendAuditFast(client, user, action, 'lead', leadId, detail);
    },
    async notify(row) {
      if (db) { db.notifications ||= []; if (!db.notifications.some(item => item.id === row.id)) db.notifications.push(row); }
      else await client.query(`insert into app_notifications(id,user_id,type,title,message,priority,entity_type,entity_id,route,created_at,metadata)
        values($1,$2,'call_analysis_ready',$3,$4,'normal','call_review',$5,$6,$7::timestamptz,$8::jsonb) on conflict(id) do nothing`,
      [row.id, row.user_id, row.title, row.message, row.entity_id, row.route, row.created_at, JSON.stringify(row.metadata)]);
    },
    async closeNotification(eventId) {
      if (db) { for (const item of db.notifications || []) if (item.entity_type === 'call_review' && item.entity_id === eventId) item.read_at = new Date().toISOString(); }
      else await client.query("update app_notifications set read_at=coalesce(read_at,now()) where entity_type='call_review' and entity_id=$1", [eventId]);
    }
  };
}
async function transaction(work, { readOnly = false } = {}) {
  await ensure();
  if (!pg()) {
    const task = localQueue.then(async () => {
      const db = structuredClone(await Storage.loadDb());
      const result = await work(adapter(null, db));
      if (!readOnly) await Storage.saveDb(db); return result;
    });
    localQueue = task.catch(() => {}); return task;
  }
  const client = await State.postgresPool.connect();
  try { await client.query('begin'); const result = await work(adapter(client)); await client.query('commit'); State.dbCache = null; return result; }
  catch (error) { await client.query('rollback'); if (error.code === '23505') throw require('./http').statusError(409, 'The event/evaluation identifier is already associated with another result.'); throw error; }
  finally { client.release(); }
}
async function results({ leadId, callId, assigneeId, pending = false, before = null, limit = 30 } = {}) {
  await ensure();
  if (!pg()) {
    const db = await Storage.loadDb();
    return (db.meta?.callResults || []).filter(row => (!leadId || row.lead_id === leadId) && (!callId || row.call_id === callId)
      && (!assigneeId || (db.leads || []).find(lead => lead.id === row.lead_id)?.owner_id === assigneeId)
      && (!pending || row.review_status === 'pending') && (!before || row.received_at < before.at || (row.received_at === before.at && row.event_id < before.id)))
      .sort((a, b) => b.received_at.localeCompare(a.received_at) || b.event_id.localeCompare(a.event_id)).slice(0, limit);
  }
  const response = await State.postgresPool.query(`select r.data from app_call_results r join app_leads l on l.id=r.lead_id
    where ($1::text is null or r.lead_id=$1) and ($2::text is null or r.call_id=$2)
    and ($3::text is null or l.owner_id=$3) and (not $4::boolean or r.review_status='pending')
    and ($5::timestamptz is null or (r.received_at,r.event_id)<($5::timestamptz,$6::text))
    order by r.received_at desc,r.event_id desc limit $7`, [leadId || null, callId || null, assigneeId || null, pending, before?.at || null, before?.id || null, limit]);
  return response.rows.map(row => row.data);
}
async function history(leadId, offset = 0) {
  await ensure();
  if (!pg()) return (await Storage.loadDb()).meta?.leadStageHistory?.filter(row => row.lead_id === leadId).slice().reverse().slice(offset, offset + 51) || [];
  return (await State.postgresPool.query('select * from app_lead_stage_history where lead_id=$1 order by created_at desc,id desc limit 51 offset $2', [leadId, offset])).rows;
}
exports.ensure = ensure; exports.transaction = transaction; exports.results = results; exports.history = history;
exports.journeyStages = async leadId => {
  await ensure();
  if (!pg()) return (await Storage.loadDb()).meta?.leadStageHistory?.filter(row => row.lead_id === leadId) || [];
  // First visits supply reached dates; latest visits resolve a legacy outcome's
  // last primary stage. The full journal stays paginated (at most two rows/stage here).
  return (await State.postgresPool.query(`select * from (
    (select distinct on(to_stage) * from app_lead_stage_history where lead_id=$1 order by to_stage,created_at asc,id asc)
    union
    (select distinct on(to_stage) * from app_lead_stage_history where lead_id=$1 order by to_stage,created_at desc,id desc)
  ) milestones order by created_at asc,id asc`, [leadId])).rows;
};
exports.summaryExtras = async leadId => {
  await ensure();
  if (!pg()) {
    const db = await Storage.loadDb();
    const tasks = (db.tasks || []).filter(task => task.lead_id === leadId);
    const calls = (db.zoom?.calls || []).filter(call => call.lead_id === leadId).sort((a, b) => Date.parse(b.started_at || 0) - Date.parse(a.started_at || 0));
    const call = calls[0];
    return { open_tasks: tasks.filter(task => task.status !== 'Done').length, completed_tasks: tasks.filter(task => task.status === 'Done').length,
      latest_call: call ? { id: call.id, started_at: call.started_at, result: call.result, duration: call.duration } : null };
  }
  const counts = await State.postgresPool.query("select count(*) filter(where status<>'Done')::int as open_tasks,count(*) filter(where status='Done')::int as completed_tasks from app_tasks where lead_id=$1", [leadId]);
  const latest = await State.postgresPool.query(`select jsonb_build_object('id',c->>'id','started_at',c->>'started_at','result',c->>'result','duration',c->'duration') as call
    from app_workspace w cross join lateral jsonb_array_elements(coalesce(w.meta->'zoom'->'calls','[]'::jsonb)) c
    where w.id='main' and c->>'lead_id'=$1 order by c->>'started_at' desc limit 1`, [leadId]);
  return { ...counts.rows[0], latest_call: latest.rows[0]?.call || null };
};
exports.timeline = async leadId => {
  await ensure();
  const combine = (audit, calls) => [...audit, ...calls.flatMap(call => [
    { id: `CALL-START-${call.id}`, call_id: call.id, entity: 'call', actor: 'Zoom', action: 'Call started', occurred_at: call.started_at },
    { id: `CALL-END-${call.id}`, call_id: call.id, entity: 'call', actor: 'Zoom', action: 'Call completed', occurred_at: call.ended_at || call.raw?.end_time || call.raw?.endTime }
  ].filter(row => row.occurred_at && Number.isFinite(Date.parse(row.occurred_at))))]
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)).slice(0, 50);
  if (!pg()) {
    const db = await Storage.loadDb(); const ids = new Set((db.applications || []).filter(app => app.lead_id === leadId).map(app => app.id));
    const audit = (db.audit || []).filter(item => item.entity === 'lead' && item.entity_id === leadId || item.entity === 'application' && ids.has(item.entity_id))
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, 50);
    const calls = (db.zoom?.calls || []).filter(call => call.lead_id === leadId)
      .sort((a, b) => Date.parse(b.started_at || 0) - Date.parse(a.started_at || 0)).slice(0, 25);
    return combine(audit, calls);
  }
  const [audit, calls] = await Promise.all([
    State.postgresPool.query(`select a.data from app_audit a where (a.entity='lead' and a.entity_id=$1)
      or (a.entity='application' and a.entity_id in(select id from app_applications where lead_id=$1)) order by a.occurred_at desc limit 50`, [leadId]),
    State.postgresPool.query(`select c as data from app_workspace w cross join lateral jsonb_array_elements(coalesce(w.meta->'zoom'->'calls','[]'::jsonb)) c
      where w.id='main' and c->>'lead_id'=$1 order by c->>'started_at' desc limit 25`, [leadId])
  ]);
  return combine(audit.rows.map(row => row.data), calls.rows.map(row => row.data));
};
