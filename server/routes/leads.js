'use strict';

const crypto = require('node:crypto');
const Config = require('../config');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Perf = require('../perf');
const Storage = require('../storage');
const Auth = require('../auth');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Leads = require('../leads');
const Applications = require('../applications');
const Monitoring = require('../monitoring');
const Bootstrap = require('../bootstrap');
const NOT_HANDLED = require('./not-handled');

async function logCallFastDb(body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    let task = null;
    if (body.follow_up) {
      task = {
        id: `T-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        title: body.next_action,
        lead_id: lead.id,
        kind: 'Follow-up',
        status: 'Open',
        created_at: new Date().toISOString(),
        due_at: body.due_at,
        priority: lead.priority,
        owner_id: lead.owner_id
      };
      await client.query(
        `insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
         values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`,
        [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, Applications.jsonValue(task)]
      );
    }
    await Audit.appendAuditFast(client, user, `Call ${body.outcome}`, 'lead', lead.id, body.note);
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

// Leads routes that read and write the database directly.
async function leadsRoutes(ctx) {
  const { route, method, res, trace, body, req, url } = ctx;
  let lightweightMatch = null;
  if (route === '/api/leads' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    const params = Object.fromEntries(['cursor', 'limit', 'search', 'stage', 'owner_id', 'programme_id', 'lead_source', 'created_from', 'created_to', 'sort', 'dir', 'include_total']
      .map(name => [name, url.searchParams.get(name)]));
    const payload = await Leads.loadLeadPage(params, trace);
    if (url.searchParams.get('debug_timing') === 'true') {
      Auth.requireDeveloperAccess(req, user);
      payload._debug = {
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          pre_handler_ms: Number(Perf.perfDuration(trace, 'pre_handler').toFixed(1)),
          middleware_ms: Number(Perf.perfDuration(trace, 'middleware').toFixed(1)),
          auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          leads_query_ms: Number(Perf.perfDuration(trace, 'leads_sql').toFixed(1)),
          serialize_ms: 0
        },
        counters: Perf.perfCounters(trace),
        queries: Bootstrap.bootstrapQueryBreakdown(trace),
        event_loop: Monitoring.eventLoopSnapshot(false)
      };
    }
    return Http.sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/leads' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    const result = await Leads.createLeadFastDb(body, user);
    return Http.sendJson(res, result, result.created ? 201 : 200);
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)$/);
  if (lightweightMatch && method === 'GET' && Storage.usesPostgresStorage()) {
    await Auth.currentSessionUser(req);
    await Storage.ensureStorage();
    return Http.sendJson(res, await Leads.loadLeadDetailDb(decodeURIComponent(lightweightMatch[1])));
  }
  if (lightweightMatch && method === 'PATCH' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Leads.updateLeadFastDb(lightweightMatch[1], body, user));
  }
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    if (!Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete leads.');
    return Http.sendJson(res, await Leads.deleteLeadFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Leads.addProgrammeOpportunityFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Leads.addLeadNoteFastDb(lightweightMatch[1], body, user), 201);
  }
  if (route === '/api/calls' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await logCallFastDb(body, user));
  }
  return NOT_HANDLED;
}

// Leads routes that work on the fully loaded workspace (db).
async function leadsWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  let match = null;
  if (route === '/api/leads/reconcile' && method === 'POST') {
    const summary = Workspace.reconcileImportedData(db, user);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, summary });
  }
  match = route.match(/^\/api\/leads\/([^/]+)$/);
  if (match && method === 'GET') {
    const lead = Leads.leadFor(db, match[1]);
    return Http.sendJson(res, { lead, timeline: Leads.timeline(db, lead) });
  }
  if (route === '/api/leads' && method === 'POST') {
    const programme = db.programmes.find(item => item.id === body.programme_id);
    if (!programme) throw Http.statusError(400, 'Choose a programme.');
    const owner = db.users.find(item => item.id === body.owner_id) || user;
    const result = Leads.ensureLeadRecord(db, owner, {
      first_name: body.first_name,
      last_name: body.last_name,
      programme_id: programme.id,
      email: body.email,
      employer: body.employer,
      phone: body.phone || '',
      city: body.city || '',
      owner_id: owner.id,
      stage: 'New lead',
      priority: body.priority,
      source_first_touch: body.source,
      source_lead_capture: body.source,
      contact_permission: body.contact_permission,
      created_at: new Date().toISOString()
    }, {
      taskTitle: `First contact with ${body.first_name} ${body.last_name}`,
      taskKind: 'Call'
    });
    if (!result.lead) throw Http.statusError(400, 'This sender is excluded from lead creation.');
    let automaticApplication = null;
    if (Config.AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS && Applications.isEnrolledStage(result.lead.stage) && !(db.applications || []).some(app => app.lead_id === result.lead.id)) {
      const appId = Util.nextId('A', [db.applications]);
      automaticApplication = Applications.automaticApplicationFromLead(appId, result.lead, user);
      db.applications.push(automaticApplication);
      db.attribution.unshift({ ...result.lead, programme: automaticApplication.programme, snapshot: { first_touch: result.lead.source_first_touch, lead_capture: result.lead.source_lead_capture, conversion_source: result.lead.source_lead_capture } });
      Audit.addAudit(db, user, 'Application auto-created for lead', 'lead', result.lead.id, appId);
    }
    Audit.addAudit(db, user, result.created ? 'Lead created' : 'Lead updated from duplicate submission', 'lead', result.lead.id);
    await Storage.saveDb(db);
    return Http.sendJson(res, { id: result.lead.id, lead: result.lead, created: result.created, application: automaticApplication ? Applications.publicApplication(automaticApplication) : null }, result.created ? 201 : 200);
  }
  if (match && method === 'PATCH') {
    const lead = Leads.leadFor(db, match[1]);
    Object.assign(lead, { stage: body.stage, owner_id: body.owner_id, priority: body.priority });
    let automaticApplication = null;
    const existingApplication = (db.applications || []).find(app => app.lead_id === lead.id);
    if (Config.AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS && Applications.isEnrolledStage(lead.stage) && !existingApplication) {
      const appId = Util.nextId('A', [db.applications]);
      automaticApplication = Applications.automaticApplicationFromLead(appId, lead, user);
      db.applications.push(automaticApplication);
      db.attribution.unshift({ ...lead, programme: automaticApplication.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
      Audit.addAudit(db, user, 'Application auto-created for lead', 'lead', lead.id, appId);
    }
    Audit.addAudit(db, user, 'Opportunity updated', 'lead', lead.id, body.reason);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, lead, application: automaticApplication ? Applications.publicApplication(automaticApplication) : null });
  }

  match = route.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
  if (match && method === 'POST') {
    const original = Leads.leadFor(db, match[1]);
    const programme = db.programmes.find(item => item.id === body.programme_id);
    if (!programme) throw Http.statusError(400, 'Choose a programme.');
    original.programme_history ||= [];
    if (!original.programme_history.some(item => item.programme_id === original.programme_id)) {
      original.programme_history.push({
        programme_id: original.programme_id,
        programme: original.programme,
        level: original.level,
        added_at: original.created_at || new Date().toISOString()
      });
    }
    if (!original.programme_history.some(item => item.programme_id === programme.id)) {
      original.programme_history.push({
        programme_id: programme.id,
        programme: programme.name,
        level: programme.level,
        added_at: new Date().toISOString()
      });
    }
    original.programme_id = programme.id;
    original.programme = programme.name;
    original.level = programme.level;
    original.stage = 'New lead';
    original.next_action_at = null;
    Audit.addAudit(db, user, 'Programme opportunity linked', 'lead', original.id, programme.name);
    await Storage.saveDb(db);
    return Http.sendJson(res, { id: original.id, created: false });
  }

  match = route.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (match && method === 'POST') {
    Leads.leadFor(db, match[1]);
    Audit.addAudit(db, user, 'Note added', 'lead', match[1], body.note);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  if (route === '/api/calls' && method === 'POST') {
    const lead = Leads.leadFor(db, body.lead_id);
    Audit.addAudit(db, user, `Call ${body.outcome}`, 'lead', lead.id, body.note);
    if (body.follow_up) db.tasks.push({ id: Util.nextId('T', [db.tasks]), title: body.next_action, lead_id: lead.id, kind: 'Follow-up', status: 'Open', created_at: new Date().toISOString(), due_at: body.due_at, priority: lead.priority, owner_id: lead.owner_id });
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }
  return NOT_HANDLED;
}

exports.leadsRoutes = leadsRoutes;
exports.leadsWorkspaceRoutes = leadsWorkspaceRoutes;
