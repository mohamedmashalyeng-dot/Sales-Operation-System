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
const Authorization = require('../authorization');
const LeadAiAnalysis = require('../lead-ai-analysis');
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
    params.owner_id = Authorization.ownerFilter(user, params.owner_id);
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
    Authorization.rejectProtectedFields(body);
    body.owner_id = Authorization.ownerForWrite(user, body.owner_id);
    const result = await Leads.createLeadFastDb(body, user);
    return Http.sendJson(res, result, result.created ? 201 : 200);
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)$/);
  if (lightweightMatch && method === 'GET' && Storage.usesPostgresStorage()) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'lead', lightweightMatch[1]);
    await Storage.ensureStorage();
    const detail = await Leads.loadLeadDetailDb(decodeURIComponent(lightweightMatch[1]));
    // A previously owned duplicate can point at a master now assigned elsewhere.
    // Authorize the resolved record before returning its contents.
    if (detail.lead?.id !== decodeURIComponent(lightweightMatch[1])) await Authorization.requireRecord(user,'lead',detail.lead?.id);
    return Http.sendJson(res, detail);
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/(timeline|emails|tasks|application|applications|meetings|calls|files|notes)$/);
  if (lightweightMatch && method === 'GET' && Storage.usesPostgresStorage()) {
    const user = await Auth.currentSessionUser(req, trace);
    const leadId = decodeURIComponent(lightweightMatch[1]);
    const tab = lightweightMatch[2] === 'applications' ? 'application' : lightweightMatch[2];
    await Authorization.requireRecord(user, 'lead', leadId);
    await Storage.ensureStorage();
    const options = { limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor') };
    const loaders = {
      timeline: Leads.loadLead360TimelineDb,
      emails: Leads.loadLead360EmailsDb,
      tasks: Leads.loadLead360TasksDb,
      application: Leads.loadLead360ApplicationsDb,
      meetings: Leads.loadLead360MeetingsDb,
      calls: Leads.loadLead360CallsDb,
      files: Leads.loadLead360FilesDb,
      notes: Leads.loadLead360NotesDb
    };
    return Http.sendJson(res, await loaders[tab](leadId, options), 200, {}, trace);
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)$/);
  if (lightweightMatch && method === 'PATCH' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.rejectProtectedFields(body);
    await Authorization.requireRecord(user, 'lead', lightweightMatch[1]);
    if (body.owner_id !== undefined) body.owner_id = Authorization.ownerForWrite(user, body.owner_id);
    return Http.sendJson(res, await Leads.updateLeadFastDb(lightweightMatch[1], body, user));
  }
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    if (!Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete leads.');
    return Http.sendJson(res, await Leads.deleteLeadFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'lead', lightweightMatch[1]);
    return Http.sendJson(res, await Leads.addProgrammeOpportunityFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/ai-analysis$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'lead', lightweightMatch[1]);
    return Http.sendJson(res, await LeadAiAnalysis.analyseLeadFastDb(decodeURIComponent(lightweightMatch[1]), user, {
      apply: body.apply !== false
    }));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'lead', lightweightMatch[1]);
    return Http.sendJson(res, await Leads.addLeadNoteFastDb(lightweightMatch[1], body, user), 201);
  }
  if (route === '/api/calls' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    await Authorization.requireRecord(user, 'lead', body.lead_id);
    return Http.sendJson(res, await logCallFastDb(body, user));
  }
  return NOT_HANDLED;
}

// Leads routes that work on the fully loaded workspace (db).
async function leadsWorkspaceRoutes(ctx) {
  const { route, method, res, body, url, db, user } = ctx;
  let match = null;
  if (route === '/api/leads/reconcile' && method === 'POST') {
    Authorization.requireTeam(user);
    const summary = Workspace.reconcileImportedData(db, user);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, summary });
  }
  match = route.match(/^\/api\/leads\/([^/]+)$/);
  if (match && method === 'GET') {
    await Authorization.requireRecord(user, 'lead', match[1], db);
    const lead = Leads.leadFor(db, match[1]);
    return Http.sendJson(res, { lead, timeline: Leads.timeline(db, lead).slice(0, 8), recent_activity: Leads.timeline(db, lead).slice(0, 8), tabs: ['timeline', 'emails', 'tasks', 'application', 'meetings', 'calls', 'notes', 'files'] });
  }
  match = route.match(/^\/api\/leads\/([^/]+)\/(timeline|emails|tasks|application|applications|meetings|calls|files|notes)$/);
  if (match && method === 'GET') {
    await Authorization.requireRecord(user, 'lead', match[1], db);
    const lead = Leads.leadFor(db, match[1]);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 30), 100));
    const tab = match[2] === 'applications' ? 'application' : match[2];
    const applications = (db.applications || []).filter(app => String(app.lead_id) === String(lead.id)).map(Applications.publicApplication);
    if (tab === 'timeline') return Http.sendJson(res, { items: Leads.timeline(db, lead).slice(0, limit), has_more: false, next_cursor: '', limit });
    if (tab === 'emails') return Http.sendJson(res, { items: (db.emails || []).filter(email => String(email.lead_id) === String(lead.id)).slice(0, limit), emails: (db.emails || []).filter(email => String(email.lead_id) === String(lead.id)).slice(0, limit), has_more: false, next_cursor: '', limit });
    if (tab === 'tasks') return Http.sendJson(res, { items: (db.tasks || []).filter(task => String(task.lead_id) === String(lead.id)).slice(0, limit), tasks: (db.tasks || []).filter(task => String(task.lead_id) === String(lead.id)).slice(0, limit), has_more: false, next_cursor: '', limit });
    if (tab === 'application') return Http.sendJson(res, { items: applications.slice(0, limit), applications: applications.slice(0, limit), application: applications[0] || null, has_more: false, next_cursor: '', limit });
    if (tab === 'meetings') {
      const fields=['id','name','title','start_at','end_at','duration','duration_mins','location','status','zoom_meeting_id','zoom_meeting_uuid','zoom_host_label','zoom_account_label','meeting_link','zoom_link','join_url'];
      const items=(db.events || []).filter(event => (event.attendees || []).some(a => String(a.lead_id)===String(lead.id))).slice(0,limit)
        .map(event => Object.fromEntries(fields.filter(key => event[key]!==undefined).map(key => [key,event[key]])));
      return Http.sendJson(res,{items,events:items,has_more:false,next_cursor:'',limit});
    }
    if (tab === 'calls') {
      const fields=['id','lead_id','direction','caller_number','caller_name','callee_number','callee_name','started_at','ended_at','occurred_at','duration_sec','duration','result','status','owner_id'];
      const items=(db.zoom?.calls || []).filter(call => String(call.lead_id || '')===String(lead.id)).slice(0,limit)
        .map(call => Object.fromEntries(fields.filter(key => call[key]!==undefined).map(key => [key,call[key]])));
      return Http.sendJson(res,{items,calls:items,has_more:false,next_cursor:'',limit});
    }
    if (tab === 'files') {
      const files = applications.flatMap(app => (app.requirements || []).flatMap(req => req.latest ? [{ ...req.latest, title: req.title, application_id: app.id, requirement_id: req.id, content_base64: undefined, download_url: `/api/evidence/${encodeURIComponent(req.latest.id)}/file` }] : []));
      return Http.sendJson(res, { items: files.slice(0, limit), files: files.slice(0, limit), has_more: false, next_cursor: '', limit });
    }
    return Http.sendJson(res, { items: (db.audit || []).filter(item => String(item.entity_id) === String(lead.id) && item.action === 'Note added').slice(0, limit), notes: (db.audit || []).filter(item => String(item.entity_id) === String(lead.id) && item.action === 'Note added').slice(0, limit), has_more: false, next_cursor: '', limit });
  }
  if (route === '/api/leads' && method === 'POST') {
    Authorization.rejectProtectedFields(body);
    body.owner_id = Authorization.ownerForWrite(user, body.owner_id);
    Authorization.requireOwnDuplicate(user, body.email ? (db.leads || []).find(lead => String(lead.email || '').trim().toLowerCase() === String(body.email).trim().toLowerCase()) : null);
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
  match = route.match(/^\/api\/leads\/([^/]+)$/);
  if (match && method === 'PATCH') {
    Authorization.rejectProtectedFields(body);
    await Authorization.requireRecord(user, 'lead', match[1], db);
    if (body.owner_id !== undefined) body.owner_id = Authorization.ownerForWrite(user, body.owner_id);
    const lead = Leads.leadFor(db, match[1]);
    if (body.stage !== undefined && body.stage !== lead.stage) {
      const Journey = require('../call-journey');
      Journey.enforceStage(lead, body.stage, user, body, Journey.facts(lead, { applications: (db.applications || []).filter(app => app.lead_id === lead.id), agreements: db.meta?.employerAgreements || [] }), true);
      db.__stage_context = { [lead.id]: { source: 'manual', reason: body.reason || 'Manual lead update', approved_by: user.id } };
      lead.stage_origin = 'manual'; lead.stage_updated_at = new Date().toISOString();
    }
    // Only the fields the request carries: assigning all three wiped the owner, the stage or the
    // priority whenever one of them was left out.
    for (const field of ['stage', 'owner_id', 'priority']) if (body[field] !== undefined) lead[field] = body[field];
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
    await Authorization.requireRecord(user, 'lead', match[1], db);
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

  match = route.match(/^\/api\/leads\/([^/]+)\/ai-analysis$/);
  if (match && method === 'POST') {
    await Authorization.requireRecord(user, 'lead', match[1], db);
    return Http.sendJson(res, await LeadAiAnalysis.analyseLeadWorkspace(db, decodeURIComponent(match[1]), user, {
      apply: body.apply !== false
    }));
  }

  match = route.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (match && method === 'POST') {
    await Authorization.requireRecord(user, 'lead', match[1], db);
    Leads.leadFor(db, match[1]);
    Audit.addAudit(db, user, 'Note added', 'lead', match[1], body.note);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  if (route === '/api/calls' && method === 'POST') {
    await Authorization.requireRecord(user, 'lead', body.lead_id, db);
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
