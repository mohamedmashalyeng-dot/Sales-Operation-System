'use strict';

const State = require('../state');
const Http = require('../http');
const Perf = require('../perf');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Leads = require('../leads');
const Dashboard = require('../dashboard');
const Monitoring = require('../monitoring');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

const serverStartedAt = new Date();

// Dashboard routes that read and write the database directly.
async function dashboardRoutes(ctx) {
  const { route, method, res, trace, req, url } = ctx;
  if (route === '/api/dashboard/summary' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardCockpitSummaryDb(Dashboard.parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/admin-overview' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Dashboard.loadDashboardAdminOverviewDb(Dashboard.parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/totals' && method === 'GET') {
    await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Dashboard.loadDashboardTotalsDb({ today_start: url.searchParams.get('today_start'), tomorrow_start: url.searchParams.get('tomorrow_start') }));
  }
  if ((route === '/api/dashboard/monitoring' || route === '/api/monitoring') && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    Authorization.requireTeam(user);
    try {
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
    const user = await Auth.currentSessionUser(req, trace);
    Authorization.requireTeam(user);
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
  if (route === '/api/audit' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, { audit: await Audit.loadAuditListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/attribution' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, { attribution: await Audit.loadAttributionListDb(url.searchParams.get('limit')) });
  }
  return NOT_HANDLED;
}

// Dashboard routes that work on the fully loaded workspace (db).
async function dashboardWorkspaceRoutes(ctx) {
  const { route, method, res, db, user } = ctx;
  if (route === '/api/monitoring/system' && method === 'GET') {
    Authorization.requireTeam(user);
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
  return NOT_HANDLED;
}

exports.dashboardRoutes = dashboardRoutes;
exports.dashboardWorkspaceRoutes = dashboardWorkspaceRoutes;
