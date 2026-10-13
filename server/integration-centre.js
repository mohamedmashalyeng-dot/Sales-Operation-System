'use strict';

const Config = require('./config');
const State = require('./state');
const Storage = require('./storage');
const Http = require('./http');
const Audit = require('./audit');
const Zoho = require('./integrations/zoho');
const Gmail = require('./integrations/gmail');
const Zoom = require('./integrations/zoom');
const Eventbrite = require('./integrations/eventbrite');
const Meta = require('./integrations/meta');
const Apollo = require('./integrations/apollo');

const SECRET_KEY_RE = /(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|webhook[_-]?secret|api[_-]?key|password|session|cookie|bearer)/i;
const HEALTH = new Set(['healthy', 'warning', 'error', 'disconnected', 'unknown']);
const SYNC_STATUS = new Set(['idle', 'queued', 'running', 'completed', 'failed', 'retrying']);

function safeError(value) {
  if (!value) return null;
  return String(value)
    .replace(/access[_-]?token|refresh[_-]?token|client[_-]?secret|password|bearer|authorization[_-]?code|webhook[_-]?secret|api[_-]?key/ig, 'credential')
    .replace(/[A-Za-z0-9._%+-]{20,}/g, '[redacted]')
    .slice(0, 240);
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (SECRET_KEY_RE.test(key)) return [key, '[redacted]'];
    return [key, redactSecrets(val)];
  }));
}

function health(value) {
  return HEALTH.has(value) ? value : 'unknown';
}

function syncStatus(value) {
  return SYNC_STATUS.has(value) ? value : 'idle';
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function safeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string') return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function latestJobFor(provider, jobs = []) {
  return jobs.find(job => job.provider === provider) || null;
}

function jobSyncStatus(job) {
  if (!job) return 'idle';
  if (job.status === 'queued') return job.retry_after_at ? 'retrying' : 'queued';
  if (job.status === 'running') return 'running';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'completed') return 'completed';
  return 'idle';
}

function jobModuleResultTotal(job, key) {
  const moduleResults = job?.state?.moduleResults || {};
  return Object.values(moduleResults).reduce((sum, result) => sum + Number(result?.[key] || 0), 0);
}

function jobSummary(job) {
  if (!job) return null;
  return {
    id: job.id,
    provider: job.provider,
    type: job.type,
    status: syncStatus(jobSyncStatus(job)),
    current_module: job.current_module || null,
    records_read: Number(job.records_scanned || 0),
    records_created: Number(job.records_added || 0),
    records_updated: Number(job.records_updated || 0),
    records_unchanged: jobModuleResultTotal(job, 'unchanged'),
    leads_created: jobModuleResultTotal(job, 'leadsAdded'),
    leads_updated: jobModuleResultTotal(job, 'leadsUpdated'),
    error_count: Number(job.records_failed || 0),
    started_at: safeDate(job.started_at),
    finished_at: safeDate(job.completed_at),
    last_progress_at: safeDate(job.last_progress_at),
    retry_after_at: safeDate(job.retry_after_at),
    duration_ms: job.started_at && job.completed_at ? Math.max(0, new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) : null,
    last_error_summary: safeError(job.last_error)
  };
}

async function loadOperationalState() {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    return { workspace: { gmail: db.gmail || {}, eventbrite: db.eventbrite || {}, meta: { ...(db.meta || {}), zoom: db.zoom || {}, apollo: db.apollo || {}, zoho: db.zoho || db.meta?.zoho || {} } }, jobs: [], zohoRecords: 0, audits: [] };
  }
  await Storage.ensureIntegrationJobsTable();
  const [workspace, jobs, zohoRecords, audits] = await Promise.all([
    State.postgresPool.query(`select gmail, eventbrite, meta from app_workspace where id = $1`, ['main']),
    State.postgresPool.query(`
      select id, provider, connection_id, type, status, current_module, records_scanned, records_added, records_updated, records_failed,
             started_at, completed_at, last_progress_at, retry_after_at, last_error, state, created_at, updated_at
      from integration_jobs
      where provider in ('zoho')
      order by case when status in ('queued', 'running') then 0 else 1 end, updated_at desc
      limit 50
    `),
    State.postgresPool.query(`select to_regclass('app_zoho_records') is not null as exists`).then(async result => {
      if (!result.rows[0]?.exists) return { rows: [{ count: 0 }] };
      return State.postgresPool.query(`select count(*)::int as count from app_zoho_records`);
    }),
    State.postgresPool.query(`
      select occurred_at, actor, action, entity, entity_id, data
      from app_audit
      where entity = 'integration'
      order by occurred_at desc
      limit 30
    `).catch(() => ({ rows: [] }))
  ]);
  return {
    workspace: workspace.rows[0] || { gmail: {}, eventbrite: {}, meta: {} },
    jobs: jobs.rows || [],
    zohoRecords: Number(zohoRecords.rows[0]?.count || 0),
    audits: audits.rows || []
  };
}

function providerBase({ id, name, configured, connected, job, recordsProcessed = null, recordsStored = null, lastSuccessAt = null, lastAttemptAt = null, lastError = null, needsReconnect = false, accounts = [], supportsSync = false, reconnectUrl = null, detail = '' }) {
  const status = jobSyncStatus(job);
  const errorSummary = safeError(lastError || job?.last_error);
  const isRunning = ['queued', 'running'].includes(status);
  const providerHealth = !configured ? 'unknown' : needsReconnect || errorSummary ? 'error' : connected ? 'healthy' : 'disconnected';
  const storedCount = Number(recordsStored ?? recordsProcessed ?? 0);
  const currentProcessed = Number(job?.records_scanned || 0);
  return {
    id,
    name,
    configured: Boolean(configured),
    connected: Boolean(connected),
    health: health(providerHealth),
    sync_status: syncStatus(status),
    last_attempt_at: safeDate(lastAttemptAt || job?.started_at || job?.created_at),
    last_success_at: safeDate(lastSuccessAt || (job?.status === 'completed' ? job.completed_at : null)),
    last_error_at: errorSummary ? safeDate(job?.updated_at || job?.completed_at || job?.last_progress_at) : null,
    last_error_summary: errorSummary,
    records_processed: currentProcessed,
    needs_reconnect: Boolean(needsReconnect),
    running: isRunning,
    async_supported: Boolean(supportsSync),
    reconnect_url: reconnectUrl,
    accounts,
    records_stored: storedCount,
    current_sync_processed: currentProcessed,
    current_sync_inserted: Number(job?.records_added || 0),
    current_sync_updated: Number(job?.records_updated || 0),
    current_sync_unchanged: jobModuleResultTotal(job, 'unchanged'),
    detail
  };
}

function gmailSummary(workspace) {
  const gmail = workspace.gmail || {};
  const needsReconnect = Boolean(gmail.reconnect_required || gmail.last_error);
  return providerBase({
    id: 'gmail',
    name: 'Gmail',
    configured: Gmail.gmailConfigured(),
    connected: Boolean(gmail.connected && !needsReconnect),
    recordsProcessed: countArray(gmail.imported_message_ids),
    lastSuccessAt: gmail.last_sync_at || null,
    lastAttemptAt: State.gmailAutoSyncState?.last_result?.last_sync_at || gmail.last_sync_at || null,
    lastError: State.gmailAutoSyncState?.last_error || (needsReconnect ? 'Gmail token expired or revoked. Reconnect Gmail from Settings.' : ''),
    needsReconnect,
    reconnectUrl: '/api/integrations/gmail/connect',
    detail: gmail.email || ''
  });
}

function zohoSummary(req, workspace, jobs, zohoRecords) {
  const zoho = workspace.meta?.zoho || {};
  const diagnostics = Zoho.zohoConnectionDiagnostics(req, { zoho });
  const job = latestJobFor('zoho', jobs);
  return providerBase({
    id: 'zoho',
    name: 'Zoho CRM',
    configured: diagnostics.configured,
    connected: diagnostics.connected,
    recordsProcessed: Number(zohoRecords || 0),
    lastSuccessAt: diagnostics.last_sync_at || null,
    lastAttemptAt: job?.created_at || diagnostics.last_sync_at || null,
    lastError: diagnostics.last_error || job?.last_error,
    needsReconnect: diagnostics.reauthorization_required,
    job,
    supportsSync: true,
    reconnectUrl: '/api/integrations/zoho/connect',
    detail: diagnostics.apiDomain || diagnostics.status
  });
}

function zoomSummaries(workspace) {
  const zoom = workspace.meta?.zoom || {};
  const accounts = Zoom.zoomAccounts();
  if (accounts.length > 1) {
    return accounts.map((account, index) => providerBase({
      id: `zoom:${index + 1}`,
      name: `Zoom ${account.label || `Account ${index + 1}`}`,
      configured: Zoom.zoomConfigured(),
      connected: Zoom.zoomConfigured(),
      recordsProcessed: countArray(zoom.imported_meeting_ids) + countArray(zoom.calls),
      lastSuccessAt: zoom.last_sync_at || zoom.last_call_sync_at || null,
      lastAttemptAt: State.zoomAutoSyncState?.last_result?.last_sync_at || zoom.last_sync_at || null,
      lastError: State.zoomAutoSyncState?.last_error,
      accounts: [{ label: account.label || `Account ${index + 1}`, connected: Zoom.zoomConfigured() }],
      detail: Zoom.zoomSyncAllUsers() ? 'All users' : (process.env.ZOOM_USER_ID || 'me')
    }));
  }
  return [providerBase({
    id: 'zoom',
    name: 'Zoom',
    configured: Zoom.zoomConfigured(),
    connected: Zoom.zoomConfigured(),
    recordsProcessed: countArray(zoom.imported_meeting_ids) + countArray(zoom.calls),
    lastSuccessAt: zoom.last_sync_at || zoom.last_call_sync_at || null,
    lastAttemptAt: State.zoomAutoSyncState?.last_result?.last_sync_at || zoom.last_sync_at || null,
    lastError: State.zoomAutoSyncState?.last_error,
    accounts: [{ label: Zoom.zoomSyncAllUsers() ? `all users across ${accounts.length || 1} account(s)` : (process.env.ZOOM_USER_ID || 'me'), connected: Zoom.zoomConfigured() }],
    detail: `${accounts.length || 1} configured account(s)`
  })];
}

function eventbriteSummary(workspace) {
  const eventbrite = workspace.eventbrite || {};
  return providerBase({
    id: 'eventbrite',
    name: 'Eventbrite',
    configured: Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured(),
    connected: Boolean(eventbrite.connected || Eventbrite.eventbritePrivateTokenConfigured()),
    recordsProcessed: countArray(eventbrite.imported_event_ids) + countArray(eventbrite.imported_attendee_ids),
    lastSuccessAt: eventbrite.last_sync_at || null,
    lastAttemptAt: State.eventAutoSyncState?.last_result?.last_sync_at || eventbrite.last_sync_at || null,
    lastError: State.eventAutoSyncState?.last_error,
    reconnectUrl: Eventbrite.eventbriteConfigured() ? '/api/integrations/eventbrite/connect' : null,
    detail: eventbrite.name || ''
  });
}

function metaSummary(workspace) {
  const meta = workspace.meta || {};
  return providerBase({
    id: 'meta',
    name: 'Meta Lead Ads',
    configured: Meta.metaConfigured(),
    connected: Meta.metaConfigured(),
    recordsProcessed: countArray(meta.imported_lead_ids),
    lastSuccessAt: meta.last_sync_at || null,
    lastAttemptAt: meta.last_sync_at || null,
    detail: process.env.META_PAGE_ID ? 'Page configured' : ''
  });
}

function apolloSummary(workspace) {
  const apollo = workspace.meta?.apollo || {};
  return providerBase({
    id: 'apollo',
    name: 'Apollo',
    configured: Apollo.apolloConfigured(),
    connected: Apollo.apolloConfigured(),
    recordsProcessed: countArray(apollo.imported_person_ids),
    lastSuccessAt: apollo.last_sync_at || null,
    lastAttemptAt: apollo.last_sync_at || null,
    detail: process.env.APOLLO_KEYWORDS || ''
  });
}

function sheetsSummary() {
  return providerBase({
    id: 'sheets-excel',
    name: 'Sheets / Excel imports',
    configured: true,
    connected: false,
    recordsProcessed: 0,
    lastSuccessAt: null,
    detail: Config.EVENTS_SHEET_URL ? 'Google Sheets URL configured for manual imports' : 'Manual event import only'
  });
}

function buildSummaries(req, state) {
  const workspace = state.workspace || {};
  const integrations = [
    zohoSummary(req, workspace, state.jobs, state.zohoRecords),
    gmailSummary(workspace),
    ...zoomSummaries(workspace),
    eventbriteSummary(workspace),
    metaSummary(workspace),
    apolloSummary(workspace),
    sheetsSummary()
  ];
  return integrations.map(redactSecrets);
}

function overviewMetrics(integrations, jobs = []) {
  return {
    connected: integrations.filter(item => item.connected).length,
    attention_required: integrations.filter(item => ['warning', 'error', 'disconnected'].includes(item.health)).length,
    syncing: integrations.filter(item => ['queued', 'running', 'retrying'].includes(item.sync_status)).length,
    failed_recently: jobs.filter(job => job.status === 'failed' && new Date(job.updated_at || job.completed_at || 0).getTime() > Date.now() - 24 * 60 * 60 * 1000).length
  };
}

async function overview(req) {
  const started = performance.now();
  const state = await loadOperationalState();
  const integrations = buildSummaries(req, state);
  const recentActivity = state.jobs.slice(0, 20).map(jobSummary).filter(Boolean);
  return redactSecrets({
    generated_at: new Date().toISOString(),
    metrics: overviewMetrics(integrations, state.jobs),
    integrations,
    recent_activity: recentActivity,
    duration_ms: Number((performance.now() - started).toFixed(1))
  });
}

async function detail(req, id) {
  const payload = await overview(req);
  const integration = payload.integrations.find(item => item.id === id || item.id.split(':')[0] === id);
  if (!integration) throw Http.statusError(404, 'Integration not found.');
  const state = await loadOperationalState();
  const provider = id.split(':')[0];
  const history = state.jobs.filter(job => job.provider === provider).slice(0, 50).map(jobSummary);
  const audit = state.audits
    .filter(row => String(row.entity_id || '').toLowerCase().includes(integration.name.split(' ')[0].toLowerCase()))
    .slice(0, 20)
    .map(row => ({ occurred_at: row.occurred_at, actor: row.actor, action: row.action, summary: safeError(row.data?.detail || row.action) }));
  return redactSecrets({
    generated_at: payload.generated_at,
    integration,
    connection: {
      configured: integration.configured,
      connected: integration.connected,
      needs_reconnect: integration.needs_reconnect,
      credentials_configured: integration.configured,
      refresh_token_present: integration.id === 'zoho' ? Boolean(state.workspace?.meta?.zoho?.refresh_token) : integration.id === 'gmail' ? Boolean(state.workspace?.gmail?.refresh_token) : undefined
    },
    sync: {
      status: integration.sync_status,
      last_success_at: integration.last_success_at,
      last_attempt_at: integration.last_attempt_at,
      records_processed: integration.records_processed,
      async_supported: integration.async_supported
    },
    history,
    recent_safe_errors: [...history.filter(item => item.last_error_summary).map(item => ({ at: item.finished_at || item.last_progress_at, summary: item.last_error_summary })), ...audit.filter(item => /error|failed|expired|reconnect/i.test(item.summary || ''))].slice(0, 20),
    audit
  });
}

async function startSync(req, user, id, options = {}) {
  if (id !== 'zoho') throw Http.statusError(409, 'This integration does not have a safe asynchronous sync action yet.');
  const job = await Zoho.createOrResumeZohoSyncJob(req, user, {
    ...options,
    full_sync: options.full_sync === true,
    mode: options.mode || 'incremental'
  });
  return redactSecrets({ success: true, integration: 'zoho', accepted: true, ...Zoho.zohoSyncJobPayload(job) });
}

exports.overview = overview;
exports.detail = detail;
exports.startSync = startSync;
exports.redactSecrets = redactSecrets;
exports.safeError = safeError;
exports.buildSummaries = buildSummaries;
