'use strict';

const Http = require('../http');
const Perf = require('../perf');
const Storage = require('../storage');
const Auth = require('../auth');
const NOT_HANDLED = require('./not-handled');
const SystemRoutes = require('./system');
const AccountRoutes = require('./account');
const BootstrapRoutes = require('./bootstrap');
const DashboardRoutes = require('./dashboard');
const LeadsRoutes = require('./leads');
const TasksRoutes = require('./tasks');
const EventsRoutes = require('./events');
const EmailsRoutes = require('./emails');
const ApplicationsRoutes = require('./applications');
const ZoomRoutes = require('./zoom');
const ZohoRoutes = require('./zoho');
const GmailRoutes = require('./gmail');
const EventbriteRoutes = require('./eventbrite');
const MetaRoutes = require('./meta');
const ApolloRoutes = require('./apollo');
const AutomationsRoutes = require('./automations');
const SavedViewsRoutes = require('./saved-views');
const DataQualityRoutes = require('./data-quality');
const IntegrationCentreRoutes = require('./integration-centre');
const AnalyticsRoutes = require('./analytics');
const NotificationsRoutes = require('./notifications');
const DocumentsRoutes = require('./documents');
const AdminAuditRoutes = require('./admin-audit');

// The route groups, in the order they are tried. A request is answered by the first group
// that has a route for it; every group works on one area of the API.
const OPEN_ROUTES = [SystemRoutes.systemOpenRoutes, AccountRoutes.accountOpenRoutes];
const DIRECT_ROUTES = [AccountRoutes.accountRoutes, BootstrapRoutes.bootstrapRoutes, SystemRoutes.systemRoutes, DashboardRoutes.dashboardRoutes, LeadsRoutes.leadsRoutes, TasksRoutes.tasksRoutes, EventsRoutes.eventsRoutes, EmailsRoutes.emailsRoutes, ApplicationsRoutes.applicationsRoutes, ZoomRoutes.zoomRoutes, ZohoRoutes.zohoRoutes, AutomationsRoutes.automationsRoutes, SavedViewsRoutes.savedViewsRoutes, DataQualityRoutes.dataQualityRoutes, IntegrationCentreRoutes.integrationCentreRoutes, AnalyticsRoutes.analyticsRoutes, NotificationsRoutes.notificationsRoutes, DocumentsRoutes.documentsRoutes, AdminAuditRoutes.adminAuditRoutes];
const PUBLIC_WORKSPACE_ROUTES = [AccountRoutes.accountPublicWorkspaceRoutes];
const WORKSPACE_ROUTES = [LeadsRoutes.leadsWorkspaceRoutes, DashboardRoutes.dashboardWorkspaceRoutes, GmailRoutes.gmailWorkspaceRoutes, EventbriteRoutes.eventbriteWorkspaceRoutes, EventsRoutes.eventsWorkspaceRoutes, ZoomRoutes.zoomWorkspaceRoutes, MetaRoutes.metaWorkspaceRoutes, ApolloRoutes.apolloWorkspaceRoutes, ZohoRoutes.zohoWorkspaceRoutes, TasksRoutes.tasksWorkspaceRoutes, EmailsRoutes.emailsWorkspaceRoutes, ApplicationsRoutes.applicationsWorkspaceRoutes];

async function tryRoutes(groups, ctx) {
  for (const group of groups) {
    const result = await group(ctx);
    if (result !== NOT_HANDLED) return result;
  }
  return NOT_HANDLED;
}

async function handleApi(req, res) {
  Http.applySecurityHeaders(req, res);
  // API answers hold workspace data; a handler that wants caching sets its own header.
  res.setHeader('Cache-Control', 'no-store');
  const handlerEntry = performance.now();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;
  const method = req.method;
  const traceableRoutes = new Set(['/api/health', '/api/bootstrap', '/api/workspace/full', '/api/leads', '/api/tasks', '/api/emails', '/api/events', '/api/zoom/events', '/api/applications', '/api/admissions/pipeline', '/api/search', '/api/data-quality/summary', '/api/data-quality/issues', '/api/integrations/overview', '/api/analytics/overview', '/api/notifications', '/api/notifications/unread-count', '/api/documents', '/api/admin-audit/overview', '/api/admin-audit/audit', '/api/meetings', '/api/activity', '/api/contacts', '/api/monitoring', '/api/dashboard/my-day', '/api/dashboard/monitoring', '/api/debug/db-ping', '/api/debug/ping']);
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
  const ctx = { route, method, finishMiddleware, res, trace, body, req, url };
  let result;
  result = await tryRoutes(OPEN_ROUTES, ctx);
  if (result !== NOT_HANDLED) return result;
  const publicRoutes = new Set(['/api/login', '/api/password/forgot', '/api/password/reset', '/api/integrations/gmail/callback', '/api/integrations/eventbrite/callback', '/api/integrations/zoho/callback']);
  if (!publicRoutes.has(route)) {
    const cookieGateStarted = performance.now();
    const hasSessionCookie = Boolean(Http.parseCookies(req).sid);
    Perf.perfAdd(trace, 'middleware_cookie_gate', performance.now() - cookieGateStarted);
    if (!hasSessionCookie) throw Http.statusError(401, 'Sign in to continue.');
  }
  finishMiddleware();
  result = await tryRoutes(DIRECT_ROUTES, ctx);
  if (result !== NOT_HANDLED) return result;
  const loadDbStart = performance.now();
  const db = await Storage.loadDb();
  ctx.db = db;
  const loadDbMs = performance.now() - loadDbStart;
  if (/^\/api\/(?:leads|tasks|applications|attendees|calls|emails|evidence)/.test(route) && ['POST', 'PATCH', 'DELETE'].includes(method)) {
    console.warn(`[perf] ${method} ${route} used legacy loadDb path in ${loadDbMs.toFixed(1)}ms`);
  }
  result = await tryRoutes(PUBLIC_WORKSPACE_ROUTES, ctx);
  if (result !== NOT_HANDLED) return result;
  const user = await Auth.currentSessionUser(req);
  ctx.user = user;
  result = await tryRoutes(WORKSPACE_ROUTES, ctx);
  if (result !== NOT_HANDLED) return result;

  throw Http.statusError(404, 'API route not found.');
}

exports.handleApi = handleApi;
