'use strict';

const http = require('node:http');
const Config = require('./server/config');
const Http = require('./server/http');
const Perf = require('./server/perf');
const Storage = require('./server/storage');
const Auth = require('./server/auth');
const Workspace = require('./server/workspace');
const Programmes = require('./server/programmes');
const Leads = require('./server/leads');
const Tasks = require('./server/tasks');
const Emails = require('./server/emails');
const Events = require('./server/events');
const Applications = require('./server/applications');
const Dashboard = require('./server/dashboard');
const Monitoring = require('./server/monitoring');
const Bootstrap = require('./server/bootstrap');
const Gmail = require('./server/integrations/gmail');
const Eventbrite = require('./server/integrations/eventbrite');
const Zoom = require('./server/integrations/zoom');
const Zoho = require('./server/integrations/zoho');
const Jobs = require('./server/jobs');
const StaticFiles = require('./server/static-files');
const Routes = require('./server/routes');

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  req.__requestEntryAt = startedAt;
  const apiRequest = Http.requestPath(req).startsWith('/api/');
  if (apiRequest) res.once('finish', () => Monitoring.recordApiTiming(req, res.statusCode, startedAt));
  try {
    if (apiRequest) return await Routes.handleApi(req, res);
    return StaticFiles.serveStatic(req, res);
  } catch (error) {
    if (apiRequest) Monitoring.recordApiError(req, error);
    const status = error.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${Http.requestPath(req)} ${status}: ${Http.isInternalError(error) ? error.stack || error.message : error.message}`);
    if (res.headersSent) return res.end();
    Http.sendJson(res, { error: Http.publicErrorMessage(error) }, status, error.headers || {}, req.__perfTrace || null);
  }
});

if (process.env.NEST_COMPAT_MODE !== 'true') {
  server.listen(Config.PORT, '0.0.0.0', () => {
    console.log(`Kent Business College backend running on port ${Config.PORT}`);
    Jobs.startAutoSync();
    Monitoring.startMonitoringSnapshotScheduler();
    setTimeout(() => Applications.runEnrolledLeadApplicationBackfill(), 5000);
  });
}

module.exports = {
  handleApi: Routes.handleApi,
  serveStatic: StaticFiles.serveStatic,
  publicStaticFile: StaticFiles.publicStaticFile,
  withoutIntegrationSecrets: Workspace.withoutIntegrationSecrets,
  startAutoSync: Jobs.startAutoSync,
  runEnrolledLeadApplicationBackfill: Applications.runEnrolledLeadApplicationBackfill,
  server,
  bootstrap: Bootstrap.bootstrap,
  loadDb: Storage.loadDb,
  saveDb: Storage.saveDb,
  saveEventImportTables: Events.saveEventImportTables,
  saveGmailImportTables: Gmail.saveGmailImportTables,
  importSpreadsheetEvents: Events.importSpreadsheetEvents,
  importEventbriteEvents: Eventbrite.importEventbriteEvents,
  importZoomMeetings: Zoom.importZoomMeetings,
  importZoomCalls: Zoom.importZoomCalls,
  importGmailMessages: Gmail.importGmailMessages,
  databaseSafeMetadata: Storage.databaseSafeMetadata,
  ensureProgrammeCatalog: Programmes.ensureProgrammeCatalog,
  programmeForText: Programmes.programmeForText,
  programmeForEvent: Events.programmeForEvent,
  recalculate: Workspace.recalculate,
  publicErrorMessage: Http.publicErrorMessage,
  __securityTest: {
    authThrottle: Auth.authThrottle,
    assertAuthThrottle: Auth.assertAuthThrottle,
    recordAuthThrottle: Auth.recordAuthThrottle,
    loginThrottleLimits: Auth.loginThrottleLimits,
    contentSecurityPolicy: Http.contentSecurityPolicy,
    applySecurityHeaders: Http.applySecurityHeaders,
    hashPassword: Auth.hashPassword,
    verifyPassword: Auth.verifyPassword,
    initialAdminPassword: Auth.initialAdminPassword,
    AUTH_THROTTLE_WINDOW_MS: Auth.AUTH_THROTTLE_WINDOW_MS,
    LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS: Auth.LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS
  },
  __zohoTest: {
    zohoAccessTokenValid: Zoho.zohoAccessTokenValid,
    zohoTokenUsable: Zoho.zohoTokenUsable,
    zohoConnectionDiagnostics: Zoho.zohoConnectionDiagnostics,
    zohoSafeStatus: Zoho.zohoSafeStatus,
    mergeZohoState: Zoho.mergeZohoState,
    zohoReconnectRequiredMessage: Zoho.zohoReconnectRequiredMessage,
    createOrResumeZohoSyncJob: Zoho.createOrResumeZohoSyncJob,
    runZohoSyncWorker: Zoho.runZohoSyncWorker,
    getZohoSyncJob: Zoho.getZohoSyncJob,
    loadZohoRecordPage: Zoho.loadZohoRecordPage
  },
  __leadsTest: {
    loadLeadPage: Leads.loadLeadPage,
    loadLeadDetailDb: Leads.loadLeadDetailDb,
    loadTaskPage: Tasks.loadTaskPage,
    loadEventPage: Events.loadEventPage,
    loadBootstrapPayload: Bootstrap.loadBootstrapPayload,
    buildLeadPageQuery: Leads.buildLeadPageQuery,
    bootstrapPayloadQuery: Bootstrap.bootstrapPayloadQuery,
    explainBootstrapAndLeads: Leads.explainBootstrapAndLeads,
    loadDashboardSummaryDb: Dashboard.loadDashboardSummaryDb,
    loadDashboardTotalsDb: Dashboard.loadDashboardTotalsDb,
    loadDashboardMonitoringDb: Monitoring.loadDashboardMonitoringDb,
    refreshMonitoringSnapshotDb: Monitoring.refreshMonitoringSnapshotDb,
    ensureMonitoringSnapshotSchema: Monitoring.ensureMonitoringSnapshotSchema,
    readMonitoringSnapshotState: Monitoring.readMonitoringSnapshotState,
    refreshMonitoringSnapshotInBackground: Monitoring.refreshMonitoringSnapshotInBackground,
    loadEmailPage: Emails.loadEmailPage,
    buildFilteredEmailPageQuery: Emails.buildFilteredEmailPageQuery,
    emailFilterSql: Emails.emailFilterSql,
    emailFiltersSqlCapable: Emails.emailFiltersSqlCapable,
    normalizeEmailPageOptions: Emails.normalizeEmailPageOptions,
    loadContactPage: Leads.loadContactPage,
    loadApplicationListDb: Applications.loadApplicationListDb,
    loadZoomEventPageDb: Zoom.loadZoomEventPageDb,
    explainRemainingPageQueries: Perf.explainRemainingPageQueries,
    databaseSafeMetadata: Storage.databaseSafeMetadata
  }
};
