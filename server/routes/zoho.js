'use strict';

const crypto = require('node:crypto');
const Http = require('../http');
const Auth = require('../auth');
const Audit = require('../audit');
const Events = require('../events');
const Zoho = require('../integrations/zoho');
const NOT_HANDLED = require('./not-handled');

// Zoho routes that read and write the database directly.
async function zohoRoutes(ctx) {
  const { route, method, res, body, req, url } = ctx;
  let lightweightMatch = null;
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
    return Http.sendJson(res, await Zoho.loadZohoRecordsPreviewDb());
  }
  return NOT_HANDLED;
}

// Zoho routes that work on the fully loaded workspace (db).
async function zohoWorkspaceRoutes(ctx) {
  const { route, method, res, req, url, db, user } = ctx;
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
  return NOT_HANDLED;
}

exports.zohoRoutes = zohoRoutes;
exports.zohoWorkspaceRoutes = zohoWorkspaceRoutes;
