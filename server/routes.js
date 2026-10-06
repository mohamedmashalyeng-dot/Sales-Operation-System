'use strict';

const crypto = require('node:crypto');
const Config = require('./config');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Auth = require('./auth');
const Workspace = require('./workspace');
const Audit = require('./audit');
const Leads = require('./leads');
const Tasks = require('./tasks');
const Emails = require('./emails');
const Events = require('./events');
const Applications = require('./applications');
const Dashboard = require('./dashboard');
const Monitoring = require('./monitoring');
const Bootstrap = require('./bootstrap');
const Gmail = require('./integrations/gmail');
const Eventbrite = require('./integrations/eventbrite');
const Zoom = require('./integrations/zoom');
const Meta = require('./integrations/meta');
const Apollo = require('./integrations/apollo');
const Zoho = require('./integrations/zoho');

const serverStartedAt = new Date();
const externalFetchCounters = { gmail: 0, google: 0, zoho: 0, zoom: 0, eventbrite: 0, meta: 0, apollo: 0 };

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

async function verifyContractFastDb(id, body) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw Http.statusError(404, 'Application not found.');
    app.contract = {
      status: 'Verified',
      signatory: body.signatory,
      signed_at: body.signed_at,
      note: body.note,
      consistency_confirmed: body.consistency_confirmed
    };
    await client.query(
      `update app_applications set contract = $2::jsonb, data = $3::jsonb where id = $1`,
      [app.id, Applications.jsonValue(app.contract), Applications.jsonValue(app)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, application: Applications.publicApplication(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function appFor(db, id) {
  const app = db.applications.find(item => item.id === id);
  if (!app) throw Http.statusError(404, 'Application not found.');
  return app;
}

async function handleApi(req, res) {
  Http.applySecurityHeaders(req, res);
  // API answers hold workspace data; a handler that wants caching sets its own header.
  res.setHeader('Cache-Control', 'no-store');
  const handlerEntry = performance.now();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;
  const method = req.method;
  const traceableRoutes = new Set(['/api/health', '/api/bootstrap', '/api/leads', '/api/tasks', '/api/emails', '/api/events', '/api/zoom/events', '/api/applications', '/api/meetings', '/api/activity', '/api/contacts', '/api/monitoring', '/api/dashboard/monitoring', '/api/debug/db-ping', '/api/debug/ping']);
  const requestEntry = Number(req.__requestEntryAt || handlerEntry);
  const trace = method === 'GET' && traceableRoutes.has(route) ? Perf.createPerfTrace(route, requestEntry) : null;
  req.__perfTrace = trace;
  Perf.perfAdd(trace, 'pre_handler', Math.max(0, handlerEntry - requestEntry));
  const middlewareStarted = performance.now();
  let middlewareRecorded = false;
  const finishMiddleware = () => {
    if (middlewareRecorded) return;
    middlewareRecorded = true;
    Perf.perfAdd(trace, 'middleware', Math.max(0, performance.now() - middlewareStarted));
  };
  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await Perf.perfPhase(trace, 'body_parse', () => Http.readBody(req)) : {};

  if (route === '/api/health' && method === 'GET') {
    finishMiddleware();
    return Http.sendJson(res, { ok: true }, 200, {}, trace);
  }
  if (route === '/api/debug/ping' && method === 'GET') {
    if (!Config.API_DEBUG_ENDPOINTS_ENABLED) throw Http.statusError(404, 'API route not found.');
    finishMiddleware();
    return Http.sendJson(res, { ok: true }, 200, {}, trace);
  }
  if (route === '/api/signup') throw Http.statusError(404, 'Sign up is disabled. Ask the developer to invite your account.');
  const publicRoutes = new Set(['/api/login', '/api/password/forgot', '/api/password/reset', '/api/integrations/gmail/callback', '/api/integrations/eventbrite/callback', '/api/integrations/zoho/callback']);
  if (!publicRoutes.has(route)) {
    const cookieGateStarted = performance.now();
    const hasSessionCookie = Boolean(Http.parseCookies(req).sid);
    Perf.perfAdd(trace, 'middleware_cookie_gate', performance.now() - cookieGateStarted);
    if (!hasSessionCookie) throw Http.statusError(401, 'Sign in to continue.');
  }
  finishMiddleware();
  let lightweightMatch = null;
  if (route === '/api/login' && method === 'POST') {
    const email = Emails.normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) throw Http.statusError(400, 'Email and password are required.');
    const loginLimits = Auth.loginThrottleLimits(req, email);
    Auth.assertAuthThrottle(loginLimits);
    const publishedDefault = password === Auth.LEGACY_DEFAULT_ADMIN_PASSWORD;
    let user = publishedDefault ? null : await Auth.findLoginUser(email);
    if (!publishedDefault && (!user || !Auth.verifyPassword(password, user.password_hash))) {
      user = await Auth.forceConfiguredDeveloperLogin(email, password);
    }
    if (!user || !Auth.verifyPassword(password, user.password_hash)) {
      Auth.recordAuthThrottle(loginLimits);
      if (Auth.isDeveloperEmail(email) && !Auth.developerPasswordConfigured()) {
        throw Http.statusError(500, 'Developer password is not configured on this deployment. Add DEV_PANEL_PASSWORD and redeploy.');
      }
      throw Http.statusError(401, 'Email or password is incorrect.');
    }
    Auth.authThrottle.delete(loginLimits[0][0]);
    const sid = await Auth.createSession(user);
    Http.sendJson(res, { ok: true, user: Auth.publicUser(user) }, 200, { 'Set-Cookie': Auth.sessionCookie(req, sid) });
    Auth.recordPostgresLogin(user, req).catch(error => console.error(`Login audit failed: ${error.message || error}`));
    return;
  }
  if (route === '/api/bootstrap' && method === 'GET') {
    const timings = {};
    const user = await Auth.currentSessionUser(req, trace);
    const payload = await Bootstrap.loadBootstrapPayload(user, timings, trace);
    if (url.searchParams.get('debug_timing') === 'true') {
      Auth.requireDeveloperAccess(req, user);
      payload._debug = {
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          pre_handler_ms: Number(Perf.perfDuration(trace, 'pre_handler').toFixed(1)),
          middleware_ms: Number(Perf.perfDuration(trace, 'middleware').toFixed(1)),
          auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          db_query_ms: Number(Perf.perfDurationEnding(trace, '_query').toFixed(1)),
          serialize_ms: 0
        },
        counters: Perf.perfCounters(trace),
        queries: Bootstrap.bootstrapQueryBreakdown(trace),
        event_loop: Monitoring.eventLoopSnapshot(false)
      };
    }
    // Visible in the browser's Network > Timing panel.
    return Http.sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/debug/db-ping' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    Auth.requireDeveloperAccess(req, user);
    await Perf.perfPhase(trace, 'debug_storage', () => Storage.ensureStorage(trace));
    if (!State.postgresPool || !Storage.usesPostgresStorage()) throw Http.statusError(400, 'PostgreSQL storage is not configured.');
    const poolBefore = Storage.postgresPoolStats();
    const result = await Storage.timedPostgresQuery(trace, 'debug_select1', 'select 1 as ok');
    const poolAfter = Storage.postgresPoolStats();
    return Http.sendJson(res, {
      ok: result.rows[0]?.ok === 1,
      database: Storage.databaseSafeMetadata(),
      pool_before: poolBefore,
      pool_after: poolAfter,
      timings: {
        node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
        pre_handler_ms: Number(Perf.perfDuration(trace, 'pre_handler').toFixed(1)),
        middleware_ms: Number(Perf.perfDuration(trace, 'middleware').toFixed(1)),
        auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
        db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
        db_query_ms: Number(Perf.perfDurationEnding(trace, '_query').toFixed(1)),
        total_ms: Number((performance.now() - trace.started_at).toFixed(1))
      },
      event_loop: Monitoring.eventLoopSnapshot(url.searchParams.get('reset_event_loop') === 'true')
    }, 200, {}, trace);
  }
  if (route === '/api/dashboard/summary' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardCockpitSummaryDb(Dashboard.parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/admin-overview' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardAdminOverviewDb(Dashboard.parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/totals' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardTotalsDb({ today_start: url.searchParams.get('today_start'), tomorrow_start: url.searchParams.get('tomorrow_start') }));
  }
  if ((route === '/api/dashboard/monitoring' || route === '/api/monitoring') && method === 'GET') {
    try {
      await Auth.currentSessionUser(req, trace);
      return Http.sendJson(res, await Monitoring.loadDashboardMonitoringDb({ today_start: url.searchParams.get('today_start'), tomorrow_start: url.searchParams.get('tomorrow_start') }, trace), 200, {}, trace);
    } catch (error) {
      if (error.status === 400) throw error;
      console.error(`[monitoring] request failed ${error.query_name || ''}: ${error.stack || error.message || error}`);
      return Http.sendJson(res, {
        error: error.code || 'monitoring_query_failed',
        message: 'Unable to load monitoring data.'
      }, error.status || 500, {}, trace);
    }
  }
  // Recent activity (audit trail), newest first; same data as the Today widget.
  if (route === '/api/activity' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Dashboard.loadDashboardActivityDb(Dashboard.parseDashboardFilters(url, user), url.searchParams.get('limit') || 20), 200, {}, trace);
  }
  if (route === '/api/contacts' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Leads.loadContactPage({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      cursor: url.searchParams.get('cursor'),
      search: url.searchParams.get('search'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/dashboard/pipeline' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardPipelineDb(Dashboard.parseDashboardFilters(url, user)));
  }
  if (route === '/api/dashboard/my-work' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardMyWorkDb(Dashboard.parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/priority-leads' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardPriorityLeadsDb(Dashboard.parseDashboardFilters(url, user)));
  }
  if (route === '/api/dashboard/source-performance' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Perf.loadDashboardSourcePerformanceDb(Dashboard.parseDashboardFilters(url, user)));
  }
  if (route === '/api/dashboard/integrations' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardIntegrationsDb(user));
  }
  if (route === '/api/dashboard/activity' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardActivityDb(Dashboard.parseDashboardFilters(url, user), url.searchParams.get('limit')));
  }
  if (route === '/api/dashboard/search' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardSearchDb(url.searchParams.get('q'), user));
  }
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
  if (route === '/api/tasks' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    const params = Object.fromEntries(['limit', 'status', 'offset', 'cursor', 'today_start', 'tomorrow_start', 'bucket', 'search', 'owner_id', 'lead_id', 'due_before', 'due_after', 'include_counts']
      .map(name => [name, url.searchParams.get(name)]));
    return Http.sendJson(res, await Tasks.loadTaskPage(params, trace), 200, {}, trace);
  }
  lightweightMatch = route.match(/^\/api\/events\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Events.loadEventDetailDb(decodeURIComponent(lightweightMatch[1]), trace), 200, {}, trace);
  }
  if (route === '/api/events' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Events.loadEventPage({
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      upcoming: url.searchParams.get('upcoming'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/developer/config' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, Auth.developerConfig(req, await Auth.loadDeveloperConfigDb()));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Emails.loadEmailDetail(lightweightMatch[1]), 200, {}, trace);
  }
  if (route === '/api/emails' && method === 'GET') {
    const emailsHandlerStarted = performance.now();
    const externalFetchBefore = { ...externalFetchCounters };
    Perf.perfAdd(trace, 'emails_handler_start', 0, { pool: Storage.postgresPoolStats() });
    const user = await Auth.currentSessionUser(req, trace);
    const params = {
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
      label: url.searchParams.get('label'),
      search: url.searchParams.get('search'),
      day: url.searchParams.get('day'),
      date_field: url.searchParams.get('date_field'),
      date_filter: url.searchParams.get('date_filter'),
      dateField: url.searchParams.get('dateField'),
      sort: url.searchParams.get('sort'),
      include_total: url.searchParams.get('include_total'),
      owner: url.searchParams.get('owner'),
      owner_id: url.searchParams.get('owner_id'),
      folder: url.searchParams.get('folder')
    };
    Perf.perfAdd(trace, 'emails_before_sql', performance.now() - emailsHandlerStarted, {
      pool: Storage.postgresPoolStats(),
      request: Emails.safeEmailRequestParams(params)
    });
    const payload = await Emails.loadEmailPage(params, trace);
    Perf.perfAdd(trace, 'emails_after_sql', performance.now() - emailsHandlerStarted, { pool: Storage.postgresPoolStats() });
    Perf.perfAdd(trace, 'gmail_api_calls', 0, { calls: externalFetchCounters.gmail - Number(externalFetchBefore.gmail || 0) });
    if (url.searchParams.get('debug_timing') === 'true') {
      Auth.requireDeveloperAccess(req, user);
      const filters = Emails.normalizeEmailPageOptions(params);
      payload._debug = {
        request: Emails.safeEmailRequestParams(params, filters),
        email_path: trace.stages.find(stage => stage.name === 'email_path')?.path || 'unknown',
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          emails_page_query_ms: Number(Perf.perfDuration(trace, 'emails_page_query').toFixed(1)),
          email_filter_query_ms: Number(Perf.perfDuration(trace, 'email_filter_query').toFixed(1)),
          fallback_query_ms: Number(Perf.perfDuration(trace, 'fallback_query').toFixed(1)),
          secondary_query_ms: Number(Math.max(0, Perf.perfDurationEnding(trace, '_query') - Perf.perfDuration(trace, 'emails_page_query') - Perf.perfDuration(trace, 'emails_count_query')).toFixed(1)),
          gmail_state_query_ms: Number(Perf.perfDuration(trace, 'gmail_state_query').toFixed(1)),
          mapping_ms: Number(Perf.perfDuration(trace, 'mapping').toFixed(1)),
          serialize_ms: 0
        },
        pool: Storage.postgresPoolStats(),
        external_api_calls: {
          gmail: externalFetchCounters.gmail - Number(externalFetchBefore.gmail || 0),
          google: externalFetchCounters.google - Number(externalFetchBefore.google || 0),
          zoho: externalFetchCounters.zoho - Number(externalFetchBefore.zoho || 0),
          zoom: externalFetchCounters.zoom - Number(externalFetchBefore.zoom || 0),
          eventbrite: externalFetchCounters.eventbrite - Number(externalFetchBefore.eventbrite || 0),
          meta: externalFetchCounters.meta - Number(externalFetchBefore.meta || 0),
          apollo: externalFetchCounters.apollo - Number(externalFetchBefore.apollo || 0)
        },
        counters: Perf.perfCounters(trace),
        queries: Bootstrap.bootstrapQueryBreakdown(trace),
        event_loop: Monitoring.eventLoopSnapshot(false)
      };
    }
    return Http.sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/users' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.createWorkspaceUser(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (lightweightMatch && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.resetWorkspaceUserPassword(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)\/role$/);
  if (lightweightMatch && method === 'PATCH') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.updateWorkspaceUserRole(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, await Auth.deleteWorkspaceUser(lightweightMatch[1], user));
  }
  if (route === '/api/applications' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Applications.loadApplicationListDb({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      cursor: url.searchParams.get('cursor'),
      status: url.searchParams.get('status'),
      programme: url.searchParams.get('programme'),
      programme_id: url.searchParams.get('programme_id'),
      intake: url.searchParams.get('intake'),
      intake_id: url.searchParams.get('intake_id'),
      owner: url.searchParams.get('owner'),
      owner_id: url.searchParams.get('owner_id'),
      source: url.searchParams.get('source'),
      created_from: url.searchParams.get('created_from'),
      created_to: url.searchParams.get('created_to'),
      search: url.searchParams.get('search'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/applications' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Applications.createApplicationFastDb(body, user), 201);
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
  if (route === '/api/tasks' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Tasks.createTaskFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Tasks.completeTaskFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/tasks\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    if (!Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete tasks.');
    return Http.sendJson(res, await Tasks.deleteTaskFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Events.checkInAttendeeFastDb(lightweightMatch[1], user));
  }
  if (route === '/api/calls' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await logCallFastDb(body, user));
  }
  if (route === '/api/emails' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Emails.recordEmailFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)\/resolve$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Emails.resolveEmailFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)\/read$/);
  if (lightweightMatch && method === 'PATCH' && State.postgresPool) {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Emails.updateEmailReadStateFastDb(lightweightMatch[1], body));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    if (!Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete emails.');
    return Http.sendJson(res, await Emails.deleteEmailFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Applications.uploadEvidenceFastDb(lightweightMatch[1], body), 201);
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Applications.reviewEvidenceFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    if (!Auth.permissionsForUser(user).review && !Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete evidence.');
    return Http.sendJson(res, await Applications.deleteEvidenceFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)\/file$/);
  if (lightweightMatch && method === 'GET' && State.postgresPool) {
    await Auth.currentSessionUser(req);
    return Applications.sendEvidenceFileFastDb(lightweightMatch[1], res);
  }
  lightweightMatch = route.match(/^\/api\/document-templates\/([^/]+)\/file$/);
  if (lightweightMatch && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Applications.sendDocumentTemplateFile(decodeURIComponent(lightweightMatch[1]), res);
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Applications.reviewApplicationFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/contract$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await verifyContractFastDb(lightweightMatch[1], body));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/enrol$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Applications.enrolApplicationFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    if (!Auth.permissionsForUser(user).review && !Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete applications.');
    return Http.sendJson(res, await Applications.deleteApplicationFastDb(lightweightMatch[1], user));
  }
  if (route === '/api/zoom/events' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    const page = await Zoom.loadZoomEventPageDb({ limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'), search: url.searchParams.get('search') }, trace);
    return Http.sendJson(res, { events: page.items, has_more: page.has_more, hasMore: page.hasMore, next_cursor: page.next_cursor, nextCursor: page.nextCursor, limit: page.limit }, 200, {}, trace);
  }
  // Zoom meetings under the generic name; default page of 50, newest first.
  if (route === '/api/meetings' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Zoom.loadZoomEventPageDb({
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      start_from: url.searchParams.get('start_from'),
      start_to: url.searchParams.get('start_to'),
      date_from: url.searchParams.get('date_from'),
      date_to: url.searchParams.get('date_to'),
      owner_id: url.searchParams.get('owner_id'),
      owner: url.searchParams.get('owner'),
      lead_id: url.searchParams.get('lead_id'),
      contact: url.searchParams.get('contact'),
      provider: url.searchParams.get('provider'),
      search: url.searchParams.get('search')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/zoom/calls' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Zoom.loadZoomCallPageDb(url.searchParams.get('limit'), url.searchParams.get('offset')));
  }
  if (route === '/api/zoom/numbers' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Zoom.loadZoomNumberPageDb(url.searchParams.get('limit'), url.searchParams.get('offset')));
  }
  if (route === '/api/audit' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, { audit: await Audit.loadAuditListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/attribution' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, { attribution: await Audit.loadAttributionListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/password/reset' && method === 'POST') {
    const resetLimits = [[`reset-address:${Http.requestIp(req)}`, Auth.PASSWORD_RESET_ATTEMPTS_PER_ADDRESS]];
    Auth.assertAuthThrottle(resetLimits);
    Auth.recordAuthThrottle(resetLimits);
    return Http.sendJson(res, await Auth.resetPasswordWithTokenFastDb(body));
  }
  if (route === '/api/logout' && method === 'POST') {
    await Auth.currentSessionUser(req);
    const sid = Http.parseCookies(req).sid;
    await Auth.deleteSession(sid);
    return Http.sendJson(res, { ok: true }, 200, { 'Set-Cookie': Auth.sessionCookie(req, '', 0) });
  }
  if (route === '/api/password' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Auth.changeOwnPassword(user, body), 200, { 'Set-Cookie': Auth.sessionCookie(req, '', 0) });
  }
  if (route === '/api/integrations/zoho/sync' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    const started = performance.now();
    const job = await Zoho.createOrResumeZohoSyncJob(req, user, body);
    const payload = Zoho.zohoSyncJobPayload(job);
    return Http.sendJson(res, { success: true, ...payload, acceptedMs: Math.round(performance.now() - started) }, 202);
  }
  if (route === '/api/integrations/zoho/records/page' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Zoho.loadZohoRecordPage({
      module: url.searchParams.get('module'),
      search: url.searchParams.get('search'),
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    }));
  }
  if (route === '/api/integrations/zoho/sync-status' && method === 'GET') {
    await Auth.currentSessionUser(req);
    const job = await Zoho.latestZohoSyncJob();
    if (job && ['queued', 'running'].includes(job.status)) Zoho.scheduleZohoSyncWorker(job.id, 0);
    return Http.sendJson(res, Zoho.zohoSyncJobPayload(job));
  }
  lightweightMatch = route.match(/^\/api\/integrations\/zoho\/sync-status\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await Auth.currentSessionUser(req);
    const job = await Zoho.getZohoSyncJob(decodeURIComponent(lightweightMatch[1]));
    if (!job) throw Http.statusError(404, 'Zoho sync job not found.');
    if (['queued', 'running'].includes(job.status)) Zoho.scheduleZohoSyncWorker(job.id, 0);
    return Http.sendJson(res, Zoho.zohoSyncJobPayload(job));
  }
  lightweightMatch = route.match(/^\/api\/integrations\/zoho\/sync\/([^/]+)\/cancel$/);
  if (lightweightMatch && method === 'POST') {
    await Auth.currentSessionUser(req);
    const job = await Zoho.cancelZohoSyncJob(decodeURIComponent(lightweightMatch[1]));
    if (!job) throw Http.statusError(404, 'Zoho sync job not found.');
    return Http.sendJson(res, { success: true, ...Zoho.zohoSyncJobPayload(job) });
  }
  if (route === '/api/integrations/zoho/status' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, Zoho.zohoSafeStatus(req, await Zoho.loadZohoWorkspaceState()));
  }
  if (route === '/api/integrations/zoho/diagnostics' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    const canInspect = Auth.permissionsForUser(user).developer || Auth.permissions(user.role).admin;
    if (!canInspect) throw Http.statusError(403, 'Developer access is required.');
    return Http.sendJson(res, Zoho.zohoConnectionDiagnostics(req, await Zoho.loadZohoWorkspaceState()));
  }
  if (route === '/api/integrations/zoho/records' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Zoho.zohoRecordsPayloadDb(await Zoho.loadZohoWorkspaceState()));
  }
  if (route === '/api/password/forgot' && method === 'POST') {
    // Checked here, before the full workspace load that the handler below needs.
    const forgotLimits = [
      [`forgot-address:${Http.requestIp(req)}`, Auth.PASSWORD_FORGOT_REQUESTS_PER_ADDRESS],
      [`forgot-email:${Emails.normalizeEmail(body.email)}`, Auth.PASSWORD_FORGOT_REQUESTS_PER_EMAIL]
    ];
    Auth.assertAuthThrottle(forgotLimits);
    Auth.recordAuthThrottle(forgotLimits);
  }
  const loadDbStart = performance.now();
  const db = await Storage.loadDb();
  const loadDbMs = performance.now() - loadDbStart;
  if (/^\/api\/(?:leads|tasks|applications|attendees|calls|emails|evidence)/.test(route) && ['POST', 'PATCH', 'DELETE'].includes(method)) {
    console.warn(`[perf] ${method} ${route} used legacy loadDb path in ${loadDbMs.toFixed(1)}ms`);
  }
  if (route === '/api/password/forgot' && method === 'POST') {
    if (!State.postgresPool) throw Http.statusError(500, 'Password reset requires Neon/PostgreSQL storage.');
    const email = Emails.normalizeEmail(body.email);
    if (!email) throw Http.statusError(400, 'Email is required.');
    const user = db.users.find(item => Emails.normalizeEmail(item.email) === email);
    if (user) {
      const resetsTable = Storage.sqlIdentifier(Config.POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
      const token = crypto.randomBytes(32).toString('base64url');
      await State.postgresPool.query(
        `insert into ${resetsTable} (user_id, email, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 minutes')`,
        [user.id, email, Auth.tokenHash(token)]
      );
      try {
        await Auth.sendPasswordResetMail(db, req, user, token);
      } catch (error) {
        console.error(`Password reset email failed for ${email}: ${error.message}`);
        if (!Http.isLocalRequest(req)) throw error;
        return Http.sendJson(res, {
          ok: true,
          message: 'Email delivery is not configured. Opening a local reset link instead.',
          reset_url: Auth.resetUrl(req, token),
          delivery_error: error.message
        });
      }
    }
    return Http.sendJson(res, { ok: true, message: 'If this email is registered, a reset link has been sent.' });
  }
  const user = await Auth.currentSessionUser(req);
  if (route === '/api/leads/reconcile' && method === 'POST') {
    const summary = Workspace.reconcileImportedData(db, user);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, summary });
  }
  if (route === '/api/monitoring/system' && method === 'GET') {
    const now = Date.now();
    const since = new Date(now - 24 * 60 * 60 * 1000);
    return Http.sendJson(res, {
      storage: Storage.storageMode(),
      uptime_ms: now - serverStartedAt.getTime(),
      started_at: serverStartedAt.toISOString(),
      last_save_at: Monitoring.monitoringState.last_save_at,
      api_errors: Monitoring.monitoringState.api_errors,
      api_error_count: Monitoring.monitoringState.api_errors.length,
      api_timings: Monitoring.monitoringState.api_timings,
      background_jobs: {
        gmail: State.gmailAutoSyncState,
        events: State.eventAutoSyncState,
        zoom: State.zoomAutoSyncState
      },
      audit_24h: (db.audit || []).filter(item => new Date(item.occurred_at || 0) >= since).length
    });
  }
  // GET /api/bootstrap and GET /api/developer/config are handled by the lightweight
  // handlers earlier in this function. They intentionally return before this point so a
  // full workspace is never loaded for a page refresh.
  if (route === '/api/integrations/gmail/status' && method === 'GET') {
    const gmailNeedsReconnect = Boolean(db.gmail?.reconnect_required || db.gmail?.last_error);
    return Http.sendJson(res, {
      configured: Gmail.gmailConfigured(),
      connected: Boolean(db.gmail?.connected && !gmailNeedsReconnect),
      email: db.gmail?.email || null,
      last_sync_at: db.gmail?.last_sync_at || null,
      reconnect_required: gmailNeedsReconnect,
      last_error: gmailNeedsReconnect ? 'Gmail token expired or revoked. Reconnect Gmail from Settings.' : null,
      auto_sync: State.gmailAutoSyncState,
      import_enabled: Config.GMAIL_IMPORT_ENABLED,
      redirect_uri: Gmail.gmailRedirectUri(req)
    });
  }
  if (route === '/api/integrations/gmail/connect' && method === 'GET') {
    if (!Gmail.gmailConfigured()) throw Http.statusError(400, 'Gmail credentials are not configured. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env.');
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session) throw Http.statusError(401, 'Sign in to continue.');
    const gmailState = crypto.randomBytes(16).toString('hex');
    await Auth.patchSession(sid, { gmail_state: gmailState });
    res.writeHead(302, { Location: Gmail.gmailAuthUrl(req, gmailState) });
    return res.end();
  }
  if (route === '/api/integrations/gmail/callback' && method === 'GET') {
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session || !session.gmail_state || session.gmail_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?gmail=session-expired' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw Http.statusError(400, url.searchParams.get('error') || 'Gmail did not return an authorization code.');
    const token = await Gmail.exchangeGmailCode(req, code);
    const profile = await Util.fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token.access_token}` } });
    db.gmail = {
      ...(db.gmail || {}),
      connected: true,
      email: profile.emailAddress || '',
      access_token: token.access_token,
      refresh_token: token.refresh_token || db.gmail?.refresh_token,
      expires_at: Date.now() + ((token.expires_in || 3600) - 60) * 1000,
      connected_at: new Date().toISOString(),
      reconnect_required: false,
      last_error: '',
      imported_message_ids: db.gmail?.imported_message_ids || []
    };
    Audit.addAudit(db, user, 'Gmail connected', 'integration', 'Gmail', db.gmail.email);
    await Storage.saveDb(db);
    res.writeHead(302, { Location: '/#/zoho?connected=1' });
    return res.end();
  }
  if (route === '/api/integrations/gmail/sync' && method === 'POST') {
    if (!Config.GMAIL_IMPORT_ENABLED) throw Http.statusError(403, 'Gmail import is paused. Existing emails remain available.');
    let result;
    try {
      result = await Gmail.importGmailMessages(db, user, Number(body.max_results || 10), {
        latest: body.latest === undefined ? true : Boolean(body.latest),
        skipTrash: Boolean(body.skip_trash),
        forceTrash: Boolean(body.force_trash)
      });
    } catch (error) {
      if (Gmail.gmailReconnectError(error.message)) throw await Gmail.markGmailReconnectRequired(db, error.message);
      throw error;
    }
    return Http.sendJson(res, result);
  }
  if (route === '/api/integrations/eventbrite/status' && method === 'GET') {
    return Http.sendJson(res, {
      configured: Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured(),
      connected: Boolean(db.eventbrite?.connected || Eventbrite.eventbritePrivateTokenConfigured()),
      name: db.eventbrite?.name || null,
      last_sync_at: db.eventbrite?.last_sync_at || null,
      auto_sync: State.eventAutoSyncState,
      redirect_uri: Eventbrite.eventbriteRedirectUri(req)
    });
  }
  if (route === '/api/integrations/eventbrite/connect' && method === 'GET') {
    if (!Eventbrite.eventbriteConfigured()) throw Http.statusError(400, 'Eventbrite credentials are not configured. Add EVENTBRITE_CLIENT_ID and EVENTBRITE_CLIENT_SECRET to .env.');
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session) throw Http.statusError(401, 'Sign in to continue.');
    const eventbriteState = crypto.randomBytes(16).toString('hex');
    await Auth.patchSession(sid, { eventbrite_state: eventbriteState });
    res.writeHead(302, { Location: Eventbrite.eventbriteAuthUrl(req, eventbriteState) });
    return res.end();
  }
  if (route === '/api/integrations/eventbrite/callback' && method === 'GET') {
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session || !session.eventbrite_state || session.eventbrite_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?eventbrite=session-expired' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw Http.statusError(400, url.searchParams.get('error') || 'Eventbrite did not return an authorization code.');
    const token = await Eventbrite.exchangeEventbriteCode(req, code);
    const profile = await Util.fetchJson('https://www.eventbriteapi.com/v3/users/me/', { headers: { Authorization: `Bearer ${token.access_token}` } });
    db.eventbrite = {
      ...(db.eventbrite || {}),
      connected: true,
      name: profile.name || profile.emails?.[0]?.email || 'Eventbrite account',
      email: profile.emails?.[0]?.email || '',
      access_token: token.access_token,
      connected_at: new Date().toISOString(),
      imported_event_ids: db.eventbrite?.imported_event_ids || [],
      imported_attendee_ids: db.eventbrite?.imported_attendee_ids || []
    };
    Audit.addAudit(db, user, 'Eventbrite connected', 'integration', 'Eventbrite', db.eventbrite.name);
    await Storage.saveDb(db);
    res.writeHead(302, { Location: '/#/settings' });
    return res.end();
  }
  if (route === '/api/integrations/eventbrite/sync' && method === 'POST') {
    const result = await Eventbrite.importEventbriteEvents(db, user, Number(body.max_events || 10), { save: false });
    await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, deleteEventIds: result.deleted_event_ids || [] });
    return Http.sendJson(res, result);
  }
  if (route === '/api/events/import' && method === 'POST') {
    if (!Auth.permissions(user.role).sales) throw Http.statusError(403, 'You do not have permission to import events.');
    const result = await Events.importSpreadsheetEvents(db, user, body);
    await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
    return Http.sendJson(res, result, 201);
  }
  if (route === '/api/integrations/zoom/status' && method === 'GET') {
    const accounts = Zoom.zoomAccounts();
    return Http.sendJson(res, {
      configured: Zoom.zoomConfigured(),
      connected: Zoom.zoomConfigured(),
      user_id: Zoom.zoomSyncAllUsers() ? `all users across ${accounts.length} accounts` : (process.env.ZOOM_USER_ID || 'me'),
      meeting_type: Zoom.zoomMeetingType(),
      report_history_months: Zoom.zoomReportHistoryMonths(),
      history_months: Zoom.zoomReportHistoryMonths(),
      history_from: process.env.ZOOM_HISTORY_FROM || null,
      all_users: Zoom.zoomSyncAllUsers(),
      accounts: accounts.length,
      last_sync_at: db.zoom?.last_sync_at || null,
      last_call_sync_at: db.zoom?.last_call_sync_at || null,
      auto_sync: State.zoomAutoSyncState
    });
  }
  if (route === '/api/integrations/zoom/sync' && method === 'POST') {
    const result = await Zoom.importZoomMeetings(db, user, Number(body.max_meetings || body.max_events || process.env.ZOOM_MAX_MEETINGS || 500), {
      save: false,
      report_history_months: body.report_history_months || body.history_months,
      history_from: body.history_from
    });
    await Events.saveEventImportTables(db, { preserveGmail: true });
    return Http.sendJson(res, result);
  }
  if (route === '/api/zoom/calls' && method === 'GET') {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 50), 250));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const allCalls = (db.zoom?.calls || [])
      .map(call => Zoom.hydrateZoomStoredCall(db, call))
      .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
    const calls = allCalls.slice(offset, offset + limit);
    return Http.sendJson(res, {
      calls,
      total: allCalls.length,
      offset,
      limit,
      loaded: offset + calls.length,
      has_more: offset + calls.length < allCalls.length,
      next_offset: offset + calls.length,
      last_sync_at: db.zoom?.last_call_sync_at || null
    });
  }
  if (route === '/api/integrations/zoom/calls/sync' && method === 'POST') {
    const result = await Zoom.importZoomCalls(db, user, Number(body.max_calls || process.env.ZOOM_MAX_CALLS || 1000), {
      save: false,
      max_calls: body.max_calls,
      call_history_months: body.call_history_months
    });
    await Events.saveEventImportTables(db, { preserveGmail: true });
    return Http.sendJson(res, result);
  }
  if (route === '/api/integrations/meta/status' && method === 'GET') {
    return Http.sendJson(res, {
      configured: Meta.metaConfigured(),
      connected: Meta.metaConfigured(),
      page_id: process.env.META_PAGE_ID || null,
      last_sync_at: db.meta?.last_sync_at || null
    });
  }
  if (route === '/api/integrations/meta/sync' && method === 'POST') {
    const result = await Meta.importMetaLeads(db, user, Number(body.max_leads || 50));
    return Http.sendJson(res, result);
  }
  if (route === '/api/integrations/apollo/status' && method === 'GET') {
    return Http.sendJson(res, {
      configured: Apollo.apolloConfigured(),
      connected: Apollo.apolloConfigured(),
      keywords: process.env.APOLLO_KEYWORDS || null,
      titles: Apollo.csvEnv('APOLLO_PERSON_TITLES'),
      last_sync_at: db.apollo?.last_sync_at || null
    });
  }
  if (route === '/api/integrations/apollo/sync' && method === 'POST') {
    const result = await Apollo.importApolloPeople(db, user, Number(body.max_people || body.max_leads || 25));
    return Http.sendJson(res, result);
  }
  if (route === '/api/integrations/zoho/status' && method === 'GET') {
    return Http.sendJson(res, Zoho.zohoSafeStatus(req, db));
  }
  if (route === '/api/integrations/zoho/diagnostics' && method === 'GET') {
    const canInspect = Auth.permissionsForUser(user).developer || Auth.permissions(user.role).admin;
    if (!canInspect) throw Http.statusError(403, 'Developer access is required.');
    return Http.sendJson(res, Zoho.zohoConnectionDiagnostics(req, db));
  }
  if (route === '/api/integrations/zoho/records' && method === 'GET') {
    return Http.sendJson(res, await Zoho.zohoRecordsPayloadDb(db));
  }
  if ((route === '/api/integrations/zoho/connect' || route === '/api/integrations/zoho/authorize') && method === 'GET') {
    const issues = Zoho.zohoConfigIssues(req);
    if (issues.length) throw Http.statusError(400, `Zoho OAuth configuration appears invalid. Verify ZOHO_CLIENT_ID and ZOHO_ACCOUNTS_URL. ${issues[0]}`);
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session) throw Http.statusError(401, 'Sign in to continue.');
    const zohoState = crypto.randomBytes(16).toString('hex');
    await Auth.patchSession(sid, { zoho_state: zohoState });
    const promptConsent = ['1', 'true', 'yes'].includes(String(url.searchParams.get('reauthorize') || url.searchParams.get('prompt_consent') || '').toLowerCase());
    console.info(`[zoho] authorize start prompt_consent=${promptConsent} accounts=${Zoho.zohoAuthAccountsUrl()}`);
    res.writeHead(302, { Location: Zoho.zohoAuthUrl(req, zohoState, { promptConsent }) });
    return res.end();
  }
  if (route === '/api/integrations/zoho/callback' && method === 'GET') {
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session || !session.zoho_state || session.zoho_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?zoho=session-expired' });
      return res.end();
    }
    const providerError = url.searchParams.get('error');
    if (providerError) {
      db.zoho ||= {};
      db.zoho.connected = false;
      db.zoho.reauthorization_required = true;
      db.zoho.last_error = 'Zoho OAuth did not authorize the connection. Verify the Client ID, data center, redirect URI and scopes.';
      db.meta ||= {};
      db.meta.zoho = db.zoho;
      await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, preserveApollo: true });
      res.writeHead(302, { Location: '/#/settings?zoho=oauth-error' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw Http.statusError(400, url.searchParams.get('error') || 'Zoho did not return an authorization code.');
    const callbackAccountsUrl = url.searchParams.get('accounts-server') || url.searchParams.get('accounts_server') || Zoho.zohoAccountsUrl();
    const callbackLocation = url.searchParams.get('location') || url.searchParams.get('dc') || '';
    const previousZoho = db.zoho || db.meta?.zoho || {};
    const token = await Zoho.exchangeZohoCode(req, code, callbackAccountsUrl);
    const refreshToken = token.refresh_token || previousZoho.refresh_token || '';
    const durableConnection = Boolean(refreshToken);
    db.zoho = {
      ...previousZoho,
      connected: durableConnection,
      reauthorization_required: !durableConnection,
      email: token.email || previousZoho.email || '',
      access_token: token.access_token,
      refresh_token: refreshToken || undefined,
      accounts_url: callbackAccountsUrl,
      location: callbackLocation || previousZoho.location || '',
      scope: token.scope || Zoho.zohoScopes().join(','),
      api_domain: token.api_domain || previousZoho.api_domain || Zoho.zohoApiBaseUrl(db),
      expires_at: Date.now() + ((token.expires_in || 3600) - 60) * 1000,
      connected_at: new Date().toISOString(),
      last_error: durableConnection ? null : 'Zoho did not return a refresh token. Reconnect with consent to store durable offline access.',
      imported_record_ids: previousZoho.imported_record_ids || [],
      records: previousZoho.records || {}
    };
    db.meta ||= {};
    db.meta.zoho = db.zoho;
    console.info(`[zoho] callback persisted connected=${db.zoho.connected} refresh_token=${Boolean(db.zoho.refresh_token)} accounts=${db.zoho.accounts_url} api_domain=${db.zoho.api_domain} location=${db.zoho.location || 'unknown'}`);
    Audit.addAudit(db, user, 'Zoho CRM connected', 'integration', 'Zoho CRM', db.zoho.api_domain || '');
    await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, preserveApollo: true });
    res.writeHead(302, { Location: durableConnection ? '/#/settings?zoho=connected' : '/#/zoho?zoho=reauthorization-required' });
    return res.end();
  }
  let match = route.match(/^\/api\/leads\/([^/]+)$/);
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

  if (route === '/api/tasks' && method === 'POST') {
    const lead = Leads.leadFor(db, body.lead_id);
    db.tasks.push({ id: Util.nextId('T', [db.tasks]), title: body.title, lead_id: lead.id, kind: body.kind, status: 'Open', created_at: new Date().toISOString(), due_at: body.due_at, priority: body.priority, owner_id: body.owner_id });
    Audit.addAudit(db, user, 'Task created', 'lead', lead.id, body.title);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (match && method === 'POST') {
    const task = db.tasks.find(item => item.id === match[1]);
    if (!task) throw Http.statusError(404, 'Task not found.');
    task.status = 'Done';
    task.completed_at = new Date().toISOString();
    Audit.addAudit(db, user, 'Task completed', 'lead', task.lead_id, task.title);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
  if (match && method === 'POST') {
    const attendee = db.events.flatMap(event => event.attendees || []).find(item => item.id === match[1]);
    if (!attendee) throw Http.statusError(404, 'Attendee not found.');
    attendee.attended_at = attendee.attended_at || new Date().toISOString();
    const lead = attendee.lead_id ? db.leads.find(item => item.id === attendee.lead_id) : null;
    if (lead) {
      db.tasks.push({
        id: Util.nextId('T', [db.tasks]),
        title: `Follow up after event attendance`,
        lead_id: lead.id,
        kind: 'Follow-up',
        status: 'Open',
        created_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 86400000).toISOString(),
        priority: lead.priority,
        owner_id: lead.owner_id
      });
      Audit.addAudit(db, user, 'Event attendee checked in', 'lead', lead.id, `${attendee.first_name} ${attendee.last_name}`);
    }
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

  if (route === '/api/emails' && method === 'POST') {
    const lead = Leads.leadFor(db, body.lead_id);
    const received = new Date(body.received_at);
    db.emails.unshift({ id: Util.nextId('E', [db.emails]), first_name: lead.first_name, last_name: lead.last_name, email: lead.email, lead_id: lead.id, subject: body.subject, body: body.body, owner: lead.owner, direction: 'inbound', response_at: null, due_at: new Date(received.getTime() + Config.EMAIL_RESPONSE_SLA_MS).toISOString(), received_at: received.toISOString() });
    Audit.addAudit(db, user, 'Inbound email recorded', 'lead', lead.id, body.subject);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/emails\/([^/]+)\/resolve$/);
  if (match && method === 'POST') {
    const email = db.emails.find(item => item.id === match[1]);
    if (!email) throw Http.statusError(404, 'Email not found.');
    const responseAt = new Date(body.response_at);
    email.response_at = Number.isNaN(responseAt.getTime()) || responseAt.getFullYear() <= 2000 ? new Date().toISOString() : responseAt.toISOString();
    email.response_note = body.note;
    Audit.addAudit(db, user, 'Email response recorded', 'lead', email.lead_id, body.note);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/emails\/([^/]+)\/reply$/);
  if (match && method === 'POST') {
    const email = db.emails.find(item => item.id === match[1]);
    if (!email) throw Http.statusError(404, 'Email not found.');
    const messageText = String(body.message || '').trim();
    if (!messageText) throw Http.statusError(400, 'Response message is required.');
    const subject = /^re:/i.test(email.subject || '') ? email.subject : `Re: ${email.subject || '(No subject)'}`;
    const fromEmail = Auth.mailFromAddress(db);
    const fromName = Auth.mailFromName();
    const message = Emails.rawEmail({ from: Emails.encodeMailAddress(fromName, fromEmail), to: email.email, subject, text: messageText });
    try {
    await Gmail.sendGmailApiMail(db, message);
  } catch (apiError) {
    await Gmail.sendSmtpMail({ fromEmail, fromName, to: email.email, subject, text: messageText }).catch(smtpError => {
        throw Http.statusError(400, Emails.emailDeliveryError(apiError, smtpError).message);
      });
    }
    email.response_at = new Date().toISOString();
    email.response_note = messageText;
    Audit.addAudit(db, user, 'Email response sent', 'lead', email.lead_id, subject);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  if (route === '/api/applications' && method === 'POST') {
    const lead = Leads.leadFor(db, body.lead_id);
    const intake = db.intakes.find(item => item.id === body.intake_id);
    const alreadyEnrolled = Boolean(body.already_enrolled);
    const learner = Applications.applicationLearnerFromBody(body);
    const appId = Util.nextId('A', [db.applications]);
    lead.stage = alreadyEnrolled ? 'Enrolled' : 'Application Submitted';
    const documentsNeedSignature = Boolean(body.documents_need_signature);
    const evidenceVerified = alreadyEnrolled && !documentsNeedSignature;
    const app = { id: appId, lead_id: lead.id, first_name: lead.first_name, last_name: lead.last_name, programme: lead.programme, intake: intake?.name || 'Next intake', status: alreadyEnrolled ? 'Enrolled' : 'In review', manager: user.name, member: lead.first_name, created_at: new Date().toISOString(), contract: evidenceVerified ? { status: 'Verified', note: 'Existing enrolled learner documents uploaded.' } : { status: 'Draft', note: documentsNeedSignature ? 'Documents uploaded for learner signature.' : undefined }, requirements: Applications.applicationRequirements(appId, body.evidence_files, { verified: evidenceVerified, reviewer: user.name }), learner };
    db.applications.push(app);
    let attribution = null;
    if (alreadyEnrolled) {
      attribution = { ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } };
      db.attribution.unshift(attribution);
    }
    Audit.addAudit(db, user, alreadyEnrolled ? 'Existing learner enrolled' : 'Application started', 'lead', lead.id);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true, application: Applications.publicApplication(app), lead, attribution }, 201);
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const req = app.requirements.find(item => item.id === body.requirement_id);
    if (!req) throw Http.statusError(404, 'Requirement not found.');
    req.latest = { id: Util.nextId('ER', [db.applications.flatMap(a => a.requirements.map(r => r.latest).filter(Boolean))]), filename: body.filename, version: (req.latest?.version || 0) + 1, status: 'Pending', reviewer: null, content_base64: body.content_base64 };
    if (!app.learner) app.status = 'In review';
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/evidence\/([^/]+)\/file$/);
  if (match && method === 'GET') {
    const req = db.applications.flatMap(app => app.requirements).find(item => item.latest?.id === match[1]);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    const content = Buffer.from(req.latest.content_base64 || '', 'base64');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${req.latest.filename}"` });
    return res.end(content);
  }

  match = route.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (match && method === 'POST') {
    const req = db.applications.flatMap(app => app.requirements).find(item => item.latest?.id === match[1]);
    if (!req?.latest) throw Http.statusError(404, 'Evidence not found.');
    req.latest.status = body.status;
    req.latest.reviewer = user.name;
    req.latest.review_note = body.note;
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const lead = Leads.leadFor(db, app.lead_id);
    app.status = body.status;
    lead.stage = body.status === 'Eligible' ? 'Ready for Enrolment' : 'Not Eligible';
    Audit.addAudit(db, user, 'Eligibility decision', 'lead', lead.id, body.status);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/contract$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    app.contract = { status: 'Verified', signatory: body.signatory, signed_at: body.signed_at, note: body.note, consistency_confirmed: body.consistency_confirmed };
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/enrol$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const lead = Leads.leadFor(db, app.lead_id);
    app.status = 'Enrolled';
    app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
    lead.stage = 'Enrolled';
    db.attribution.unshift({ ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
    Audit.addAudit(db, user, 'Learner enrolled', 'lead', lead.id, body.external_reference);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }

  throw Http.statusError(404, 'API route not found.');
}

exports.externalFetchCounters = externalFetchCounters;
exports.handleApi = handleApi;
