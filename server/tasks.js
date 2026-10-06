'use strict';

const crypto = require('node:crypto');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Audit = require('./audit');
const Applications = require('./applications');
const Monitoring = require('./monitoring');

function importTaskRows(db) {
  return (db.tasks || []).map(item => ({
    id: item.id,
    title: item.title || null,
    lead_id: item.lead_id || null,
    kind: item.kind || null,
    status: item.status || null,
    due_at: item.due_at || null,
    completed_at: item.completed_at || null,
    priority: item.priority || null,
    owner_id: item.owner_id || null,
    data: item
  }));
}

function escapeSqlLike(value) {
  return String(value || '').replace(/[\\%_]/g, char => `\\${char}`);
}

function parseOptionalIsoDate(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw Http.statusError(400, `Invalid ${label}.`);
  return new Date(time).toISOString();
}

// Planner data straight from app_tasks. Open tasks come oldest-due first, done tasks newest
// first. Bucket counts cover every task; the browser passes its own local day boundaries so
// "today" matches what the planner shows.
const TASK_PAGE_DEFAULT_LIMIT = 50;
const TASK_PAGE_MAX_LIMIT = 200;

async function loadTaskPage(options = {}, trace = null) {
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, TASK_PAGE_MAX_LIMIT)) : TASK_PAGE_DEFAULT_LIMIT;
  const status = String(options.status || 'open').trim().toLowerCase();
  if (!['open', 'done', 'all'].includes(status)) throw Http.statusError(400, 'Task status must be open, done or all.');
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  const cursor = Util.decodePageCursor(options.cursor, 'task cursor');
  const bucket = String(options.bucket || '').trim().toLowerCase();
  if (bucket && (status !== 'open' || !['overdue', 'today', 'upcoming'].includes(bucket))) throw Http.statusError(400, 'Task bucket must be overdue, today or upcoming (open tasks only).');
  const search = String(options.search || '').trim().slice(0, 200);
  const ownerId = String(options.owner_id || '').trim();
  const leadId = String(options.lead_id || '').trim();
  const dueBefore = parseOptionalIsoDate(options.due_before, 'due_before');
  const dueAfter = parseOptionalIsoDate(options.due_after, 'due_after');
  const bounds = Monitoring.parseDayBounds(options);
  const includeCounts = !options.cursor && ['1', 'true'].includes(String(options.include_counts || '').toLowerCase());
  if (bucket && !bounds.provided) throw Http.statusError(400, 'A task bucket needs today_start and tomorrow_start.');
  const { todayStart, tomorrowStart } = bounds.provided ? bounds : {};
  await Perf.perfPhase(trace, 'tasks_storage', () => Storage.ensureStorage());
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    const rows = (db.tasks || [])
      .filter(task => status === 'all' || (status === 'open' ? task.status === 'Open' : task.status === 'Done'))
      .filter(task => !ownerId || String(task.owner_id || '') === ownerId)
      .filter(task => !leadId || String(task.lead_id || '') === leadId)
      .filter(task => !dueBefore || new Date(task.due_at || 0) < new Date(dueBefore))
      .filter(task => !dueAfter || new Date(task.due_at || 0) >= new Date(dueAfter))
      .filter(task => !search || JSON.stringify(task).toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => status === 'open'
        ? new Date(a.due_at || 0) - new Date(b.due_at || 0)
        : new Date(b.completed_at || b.due_at || 0) - new Date(a.completed_at || a.due_at || 0));
    const cursorIndex = cursor?.id ? rows.findIndex(item => item.id === cursor.id) + 1 : offset;
    const start = Math.max(0, cursorIndex || 0);
    const items = rows.slice(start, start + limit);
    const nextCursor = start + items.length < rows.length ? Util.encodePageCursor({ id: items[items.length - 1]?.id || '' }) : '';
    return { items, leads: [], counts: null, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, nextOffset: start + items.length, limit, status };
  }
  const sortSql = status === 'open' ? 't.due_at' : 'coalesce(t.completed_at, t.due_at)';
  const order = status === 'open'
    ? `${sortSql} asc nulls last, t.id asc`
    : `${sortSql} desc nulls last, t.id desc`;
  // Buckets and search run in SQL, so each planner column gets its own page of every task.
  const values = [];
  const conditions = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  if (status !== 'all') conditions.push(`t.status = ${bind(status === 'open' ? 'Open' : 'Done')}`);
  if (bucket === 'overdue') conditions.push(`t.due_at < ${bind(todayStart)}::timestamptz`);
  if (bucket === 'today') conditions.push(`t.due_at >= ${bind(todayStart)}::timestamptz and t.due_at < ${bind(tomorrowStart)}::timestamptz`);
  if (bucket === 'upcoming') conditions.push(`(t.due_at >= ${bind(tomorrowStart)}::timestamptz or t.due_at is null)`);
  if (ownerId) conditions.push(`t.owner_id = ${bind(ownerId)}`);
  if (leadId) conditions.push(`t.lead_id = ${bind(leadId)}`);
  if (dueBefore) conditions.push(`t.due_at < ${bind(dueBefore)}::timestamptz`);
  if (dueAfter) conditions.push(`t.due_at >= ${bind(dueAfter)}::timestamptz`);
  if (search) {
    const term = bind(`%${escapeSqlLike(search)}%`);
    conditions.push(`(t.title ilike ${term} or l.first_name ilike ${term} or l.last_name ilike ${term} or l.email ilike ${term})`);
  }
  if (cursor?.id) {
    const cursorSort = cursor.sort_at || null;
    const cursorId = String(cursor.id || '');
    if (status === 'open') {
      if (cursorSort) {
        const sortParam = bind(cursorSort);
        const idParam = bind(cursorId);
        conditions.push(`(${sortSql} > ${sortParam}::timestamptz or (${sortSql} = ${sortParam}::timestamptz and t.id > ${idParam}) or ${sortSql} is null)`);
      } else {
        conditions.push(`(${sortSql} is null and t.id > ${bind(cursorId)})`);
      }
    } else if (cursorSort) {
      const sortParam = bind(cursorSort);
      const idParam = bind(cursorId);
      conditions.push(`(${sortSql} < ${sortParam}::timestamptz or (${sortSql} = ${sortParam}::timestamptz and t.id < ${idParam}) or ${sortSql} is null)`);
    } else {
      conditions.push(`(${sortSql} is null and t.id < ${bind(cursorId)})`);
    }
  }
  const whereSql = conditions.length ? conditions.join(' and ') : 'true';
  const listValues = cursor ? [...values, limit + 1] : [...values, limit + 1, offset];
  const [list, counts] = await Promise.all([
    Storage.timedPostgresQuery(trace, 'tasks_page',
      `select jsonb_build_object(
         'id', t.id,
         'title', t.title,
         'lead_id', t.lead_id,
         'kind', coalesce(t.data->>'kind', 'Follow-up'),
         'status', t.status,
         'created_at', t.data->>'created_at',
         'due_at', t.due_at,
         'completed_at', t.completed_at,
         'priority', coalesce(t.priority, t.data->>'priority', ''),
         'owner_id', coalesce(t.owner_id, t.data->>'owner_id', '')
       ) as task,
         ${sortSql} as sort_at,
         case when l.id is null then null else jsonb_build_object(
           'id', l.id, 'first_name', l.first_name, 'last_name', l.last_name, 'email', l.email, 'phone', l.phone,
           'employer', l.employer, 'programme_id', l.programme_id, 'programme', l.programme, 'level', l.level,
           'owner_id', l.owner_id, 'owner', l.owner, 'stage', l.stage, 'priority', l.priority,
           'source_first_touch', l.source_first_touch, 'source_lead_capture', l.source_lead_capture, 'created_at', l.created_at
         ) end as lead
       from app_tasks t
       left join app_leads l on l.id = t.lead_id
       where ${whereSql}
       order by ${order}
       limit $${cursor ? listValues.length : listValues.length - 1}${cursor ? '' : ` offset $${listValues.length}`}`,
      listValues
    ),
    includeCounts && bounds.provided ? loadTaskBucketCounts(State.postgresPool, bounds, trace) : Promise.resolve(null)
  ]);
  return Perf.perfPhase(trace, 'mapping', async () => {
    const rows = list.rows.slice(0, limit);
    const leads = new Map();
    for (const row of rows) if (row.lead?.id) leads.set(row.lead.id, row.lead);
    const last = rows[rows.length - 1];
    const nextCursor = list.rows.length > limit && last?.task?.id ? Util.encodePageCursor({ sort_at: last.sort_at || null, id: last.task.id }) : '';
    return {
      items: rows.map(row => row.task).filter(Boolean),
      leads: [...leads.values()],
      counts: counts || null,
      hasMore: Boolean(nextCursor),
      has_more: Boolean(nextCursor),
      nextCursor,
      next_cursor: nextCursor,
      nextOffset: offset + rows.length,
      limit,
      status,
      bucket: bucket || null
    };
  });
}

// Task counts per planner bucket over every task (not just the rows loaded in the browser).
async function loadTaskBucketCounts(db, bounds, trace = null) {
  const queryFn = trace && db === State.postgresPool ? (sql, params) => Storage.timedPostgresQuery(trace, 'tasks_counts', sql, params) : (sql, params) => db.query(sql, params);
  const result = await queryFn(
    `select
       count(*) filter (where status = 'Open' and due_at < $1::timestamptz)::int as overdue,
       count(*) filter (where status = 'Open' and due_at >= $1::timestamptz and due_at < $2::timestamptz)::int as today,
       count(*) filter (where status = 'Open' and (due_at >= $2::timestamptz or due_at is null))::int as upcoming,
       count(*) filter (where status = 'Open')::int as open,
       count(*) filter (where status = 'Done')::int as done
     from app_tasks`,
    [bounds.todayStart, bounds.tomorrowStart]
  );
  return result.rows[0];
}

async function createTaskFastDb(body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    const task = {
      id: `T-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      title: body.title,
      lead_id: lead.id,
      kind: body.kind,
      status: 'Open',
      created_at: new Date().toISOString(),
      due_at: body.due_at,
      priority: body.priority,
      owner_id: body.owner_id
    };
    await client.query(
      `insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`,
      [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, Applications.jsonValue(task)]
    );
    await Audit.appendAuditFast(client, user, 'Task created', 'lead', lead.id, body.title);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function completeTaskFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_tasks where id = $1 for update`, [id]);
    const task = result.rows[0]?.data;
    if (!task) throw Http.statusError(404, 'Task not found.');
    task.status = 'Done';
    task.completed_at = new Date().toISOString();
    await client.query(
      `update app_tasks set status = $2, completed_at = $3::timestamptz, data = $4::jsonb where id = $1`,
      [task.id, task.status, task.completed_at, Applications.jsonValue(task)]
    );
    await Audit.appendAuditFast(client, user, 'Task completed', 'lead', task.lead_id, task.title);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteTaskFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_tasks where id = $1 for update`, [id]);
    const task = result.rows[0]?.data;
    if (!task) throw Http.statusError(404, 'Task not found.');
    await client.query(`delete from app_tasks where id = $1`, [id]);
    await Audit.appendAuditFast(client, user, 'Task deleted', 'lead', task.lead_id, task.title);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, deleted: { tasks: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

exports.importTaskRows = importTaskRows;
exports.escapeSqlLike = escapeSqlLike;
exports.parseOptionalIsoDate = parseOptionalIsoDate;
exports.loadTaskPage = loadTaskPage;
exports.loadTaskBucketCounts = loadTaskBucketCounts;
exports.createTaskFastDb = createTaskFastDb;
exports.completeTaskFastDb = completeTaskFastDb;
exports.deleteTaskFastDb = deleteTaskFastDb;
