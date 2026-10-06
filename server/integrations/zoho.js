'use strict';

const crypto = require('node:crypto');
const Config = require('../config');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Programmes = require('../programmes');
const Leads = require('../leads');
const Emails = require('../emails');
const Events = require('../events');
const Applications = require('../applications');
const Zoom = require('./zoom');

const activeZohoSyncWorkers = new Set();

// Schema DDL only needs to run once per process; the Zoho worker and status polls call
// these helpers on every page, so repeat calls reuse the first run.
let zohoRecordsTableReady = null;

function ensureZohoRecordsTable(client = State.postgresPool, trace = null) {
  if (!client) return Promise.resolve();
  zohoRecordsTableReady ||= createZohoRecordsTable(client, trace).catch(error => {
    zohoRecordsTableReady = null;
    throw error;
  });
  return zohoRecordsTableReady;
}

async function createZohoRecordsTable(client, trace = null) {
  const q = client === State.postgresPool
    ? (label, sql, params = []) => Storage.tracedPostgresPoolQuery(trace, label, sql, params)
    : (label, sql, params = []) => client.query(sql, params);
  await q('schema_zoho_records_table', `
    create table if not exists app_zoho_records (
      key text primary key,
      module text not null,
      zoho_id text not null,
      title text,
      email text,
      phone text,
      company text,
      owner_name text,
      status text,
      created_time timestamptz,
      modified_time timestamptz,
      data jsonb not null default '{}'::jsonb,
      synced_at timestamptz not null default now()
    )
  `);
  await q('schema_zoho_records_module_index', `create index if not exists app_zoho_records_module_idx on app_zoho_records(module)`);
  await q('schema_zoho_records_modified_index', `create index if not exists app_zoho_records_modified_idx on app_zoho_records(modified_time desc nulls last)`);
  await q('schema_zoho_records_module_modified_index', `create index if not exists app_zoho_records_module_modified_idx on app_zoho_records(module, modified_time desc nulls last, key)`);
  // Zoho lead matching looks up existing leads by Zoho record id and email on every page.
  await q('schema_leads_zoho_record_id_index', `create index if not exists app_leads_zoho_record_id_idx on app_leads((data->>'zoho_record_id'))`).catch(() => null);
  await q('schema_leads_email_lower_index', `create index if not exists app_leads_email_lower_idx on app_leads(lower(email))`).catch(() => null);
}

function zohoHasToken(state = {}) {
  return Boolean(state.refresh_token || state.access_token);
}

function zohoAccessTokenValid(state = {}) {
  return Boolean(state.access_token && (!state.expires_at || state.expires_at > Date.now()));
}

function zohoTokenUsable(state = {}) {
  return Boolean(state.refresh_token);
}

function zohoReconnectError(message = '') {
  return /invalid oauth|invalid_token|invalid code|invalid_client|invalid_grant|refresh token|oauth token|not connected|reauthorization/i.test(String(message || ''));
}

function zohoReconnectRequiredMessage() {
  return 'Zoho authorization is incomplete or expired. Reconnect Zoho CRM, approve access, then run Sync Zoho data again.';
}

function zohoStoredConnection(db = {}) {
  return db.zoho || db.meta?.zoho || {};
}

function zohoConnectionDiagnostics(req, db = {}) {
  const issues = zohoConfigIssues(req);
  const state = zohoStoredConnection(db);
  const connectionRecordExists = Boolean(state && Object.keys(state).length);
  const refreshTokenStored = Boolean(state.refresh_token);
  const accessTokenStored = Boolean(state.access_token);
  const accessTokenExpired = accessTokenStored && !zohoAccessTokenValid(state);
  const accountsServerStored = Boolean(state.accounts_url && safeUrl(state.accounts_url));
  const apiDomainStored = Boolean(state.api_domain && safeUrl(state.api_domain));
  const permanentReauthorizationFailure = Boolean(
    (state.reauthorization_required || state.reconnect_required) &&
    /invalid_grant|invalid refresh|revoked|invalid_token|oauth token/i.test(String(state.last_error || ''))
  );
  const reauthorizationRequired = Boolean(
    permanentReauthorizationFailure ||
    (connectionRecordExists && (state.connected || state.connected_at || accessTokenStored) && !refreshTokenStored)
  );
  const connected = Boolean(
    !issues.length &&
    connectionRecordExists &&
    refreshTokenStored &&
    accountsServerStored &&
    apiDomainStored &&
    !reauthorizationRequired
  );
  const status = issues.length
    ? 'not_configured'
    : connected
      ? 'connected'
      : reauthorizationRequired
        ? 'reauthorization_required'
        : connectionRecordExists
          ? 'error'
          : 'not_connected';
  return {
    clientConfigured: issues.length === 0,
    configured: issues.length === 0,
    connectionRecordExists,
    refreshTokenStored,
    hasRefreshToken: refreshTokenStored,
    accessTokenStored,
    accessTokenExpired,
    accessTokenExpiresAt: state.expires_at ? new Date(state.expires_at).toISOString() : null,
    accountsServerStored,
    apiDomainStored,
    accountsServer: accountsServerStored ? state.accounts_url : null,
    apiDomain: apiDomainStored ? state.api_domain : null,
    dataCenter: state.location || null,
    connected,
    status,
    reauthorizationRequired,
    reauthorization_required: reauthorizationRequired,
    lastSuccessfulSyncAt: state.last_sync_at || null,
    last_sync_at: state.last_sync_at || null,
    last_error: state.last_error || null,
    config_issues: issues
  };
}

function mergeZohoState(currentZoho = {}, nextZoho = {}) {
  const merged = {
    ...(currentZoho || {}),
    ...(nextZoho || {}),
    records: {
      ...(currentZoho?.records || {}),
      ...(nextZoho?.records || {})
    },
    imported_record_ids: [
      ...new Set([
        ...(currentZoho?.imported_record_ids || []),
        ...(nextZoho?.imported_record_ids || [])
      ])
    ]
  };
  if (!zohoHasToken(nextZoho) && zohoHasToken(currentZoho)) {
    for (const key of ['access_token', 'refresh_token', 'expires_at', 'accounts_url', 'api_domain', 'location', 'scope', 'email', 'connected_at', 'reauthorization_required']) {
      if (currentZoho[key] !== undefined) merged[key] = currentZoho[key];
    }
    if (currentZoho.connected !== undefined && nextZoho.connected === undefined) merged.connected = currentZoho.connected;
    if (currentZoho.last_error && nextZoho.last_error === undefined) merged.last_error = currentZoho.last_error;
  }
  return merged;
}

function zohoRecordRows(db = {}) {
  const records = db.zoho?.records || {};
  return Object.entries(records).flatMap(([moduleName, rows]) => (Array.isArray(rows) ? rows : []).map(row => ({
    key: row.key || `${moduleName}:${row.id || ''}`,
    module: row.module || moduleName,
    zoho_id: row.id || String(row.key || '').split(':').slice(1).join(':') || '',
    title: row.title || row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    company: row.company || '',
    owner_name: row.owner || '',
    status: row.status || '',
    created_time: row.created_time || null,
    modified_time: row.modified_time || null,
    data: row
  }))).filter(row => row.key && !row.key.endsWith(':'));
}

async function upsertZohoRecordRows(client, rows = []) {
  if (!rows.length) return;
  await ensureZohoRecordsTable(client);
  await client.query(
    `with rows as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         key text, module text, zoho_id text, title text, email text, phone text, company text,
         owner_name text, status text, created_time text, modified_time text, data jsonb
       )
     )
     insert into app_zoho_records (key, module, zoho_id, title, email, phone, company, owner_name, status, created_time, modified_time, data, synced_at)
     select key, module, zoho_id, title, email, phone, company, owner_name, status,
       nullif(created_time, '')::timestamptz,
       nullif(modified_time, '')::timestamptz,
       data,
       now()
     from rows
     on conflict (key) do update set
       module = excluded.module,
       zoho_id = excluded.zoho_id,
       title = excluded.title,
       email = excluded.email,
       phone = excluded.phone,
       company = excluded.company,
       owner_name = excluded.owner_name,
       status = excluded.status,
       created_time = excluded.created_time,
       modified_time = excluded.modified_time,
       data = excluded.data,
       synced_at = now()`,
    [Applications.jsonValue(rows)]
  );
}

function zohoRedirectUri(req) {
  return process.env.ZOHO_REDIRECT_URI || `${Http.originFor(req)}/api/integrations/zoho/callback`;
}

function zohoAccountsUrl() {
  return String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, '');
}

function zohoAuthAccountsUrl() {
  return String(process.env.ZOHO_AUTH_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, '');
}

function zohoTokenAccountsUrl(db = {}) {
  return String(db.zoho?.accounts_url || process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, '');
}

function zohoApiBaseUrl(db = {}) {
  return String(db.zoho?.api_domain || process.env.ZOHO_API_BASE_URL || 'https://www.zohoapis.com').replace(/\/+$/, '');
}

function zohoScopes() {
  const configured = String(process.env.ZOHO_SCOPES || Config.DEFAULT_ZOHO_SCOPES.join(','))
    .split(/[,\s]+/)
    .map(scope => scope.trim())
    .filter(Boolean);
  return configured.length ? [...new Set(configured)] : Config.DEFAULT_ZOHO_SCOPES;
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' && parsed.origin === String(value || '').replace(/\/+$/, '');
  } catch {
    return false;
  }
}

function maskedCredential(value = '') {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 12) return `${text.slice(0, 3)}...`;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function zohoConfigIssues(req) {
  const issues = [];
  const clientId = String(process.env.ZOHO_CLIENT_ID || '');
  const clientSecret = String(process.env.ZOHO_CLIENT_SECRET || '');
  if (!clientId) issues.push('Missing ZOHO_CLIENT_ID.');
  if (!clientSecret) issues.push('Missing ZOHO_CLIENT_SECRET.');
  if (/your-zoho|replace-with|YOUR_ZOHO|undefined|null/i.test(clientId)) issues.push('ZOHO_CLIENT_ID is a placeholder.');
  if (/your-zoho|replace-with|YOUR_ZOHO|undefined|null/i.test(clientSecret)) issues.push('ZOHO_CLIENT_SECRET is a placeholder.');
  if (!safeUrl(zohoAuthAccountsUrl())) issues.push('ZOHO_AUTH_ACCOUNTS_URL must be an https origin.');
  if (!safeUrl(zohoAccountsUrl())) issues.push('ZOHO_ACCOUNTS_URL must be an https origin.');
  if (!safeUrl(zohoApiBaseUrl())) issues.push('ZOHO_API_BASE_URL must be an https origin.');
  if (!String(zohoRedirectUri(req)).startsWith('https://')) issues.push('ZOHO_REDIRECT_URI must be https in production.');
  if (!zohoScopes().length) issues.push('Missing ZOHO_SCOPES.');
  return issues;
}

function zohoSafeStatus(req, db = {}) {
  const diagnostics = zohoConnectionDiagnostics(req, db);
  const records = db.zoho?.records || {};
  const recordCounts = Object.fromEntries(zohoSyncModules().map(moduleName => [moduleName, Array.isArray(records[moduleName]) ? records[moduleName].length : 0]));
  return {
    configured: diagnostics.configured,
    connected: diagnostics.connected,
    status: diagnostics.status,
    hasRefreshToken: diagnostics.hasRefreshToken,
    accessTokenExpiresAt: diagnostics.accessTokenExpiresAt,
    dataCenter: diagnostics.dataCenter,
    reauthorizationRequired: diagnostics.reauthorizationRequired,
    client_id_hint: maskedCredential(process.env.ZOHO_CLIENT_ID || ''),
    auth_accounts_url: zohoAuthAccountsUrl(),
    token_accounts_url: zohoAccountsUrl(),
    stored_accounts_url: db.zoho?.accounts_url || null,
    api_domain: db.zoho?.api_domain || zohoApiBaseUrl(db),
    redirect_uri: zohoRedirectUri(req),
    scopes: zohoScopes(),
    modules: zohoSyncModules(),
    record_counts: recordCounts,
    email: db.zoho?.email || null,
    last_sync_at: db.zoho?.last_sync_at || null,
    last_error: db.zoho?.last_error || null,
    reconnect_required: diagnostics.reauthorizationRequired,
    config_issues: diagnostics.config_issues
  };
}

function zohoConfigured() {
  return zohoConfigIssues({ headers: {}, socket: {} }).length === 0;
}

function zohoAuthUrl(req, state, options = {}) {
  const params = new URLSearchParams({
    scope: zohoScopes().join(','),
    client_id: process.env.ZOHO_CLIENT_ID,
    response_type: 'code',
    access_type: 'offline',
    redirect_uri: zohoRedirectUri(req),
    state
  });
  if (options.promptConsent) params.set('prompt', 'consent');
  return `${zohoAuthAccountsUrl()}/oauth/v2/auth?${params}`;
}

async function exchangeZohoCode(req, code, accountsUrl = '') {
  return Util.fetchJson(`${String(accountsUrl || zohoAccountsUrl()).replace(/\/+$/, '')}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: zohoRedirectUri(req),
      code
    })
  });
}

async function refreshZohoToken(db) {
  if (!db.zoho?.refresh_token) throw Http.statusError(400, 'Zoho CRM is not connected. Reconnect Zoho CRM so the server can store a refresh token.');
  const accountsUrl = zohoTokenAccountsUrl(db);
  console.info(`[zoho] refresh start accounts=${accountsUrl} access_expired=${!zohoAccessTokenValid(db.zoho)}`);
  const token = await Util.fetchJson(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: db.zoho.refresh_token
    })
  });
  db.zoho.access_token = token.access_token;
  db.zoho.api_domain = token.api_domain || db.zoho.api_domain;
  db.zoho.expires_at = Date.now() + ((token.expires_in || 3600) - 60) * 1000;
  db.zoho.connected = true;
  db.zoho.reauthorization_required = false;
  db.zoho.last_error = null;
  console.info(`[zoho] refresh success api_domain=${db.zoho.api_domain}`);
  return db.zoho.access_token;
}

async function zohoAccessToken(db) {
  if (!db.zoho?.refresh_token) throw Http.statusError(401, zohoReconnectRequiredMessage());
  if (!db.zoho.expires_at || db.zoho.expires_at < Date.now()) return refreshZohoToken(db);
  if (!db.zoho.access_token) return refreshZohoToken(db);
  return db.zoho.access_token;
}

function zohoSyncModules() {
  const configured = String(process.env.ZOHO_SYNC_MODULES || Config.DEFAULT_ZOHO_MODULES.join(','))
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return configured.length ? [...new Set(configured)] : Config.DEFAULT_ZOHO_MODULES;
}

function zohoRecordId(moduleName, record = {}) {
  return `${moduleName}:${String(record.id || record.Id || '').trim()}`;
}

function zohoRecordNameParts(record = {}) {
  const full = record.Full_Name || record.Full_Name__s || record.Name || [record.First_Name, record.Last_Name].filter(Boolean).join(' ');
  const email = Emails.normalizeEmail(record.Email || record.Email_Address || '');
  return {
    first_name: record.First_Name || Util.nameParts(full || '', email).first_name || 'Zoho',
    last_name: record.Last_Name || Util.nameParts(full || '', email).last_name || 'Contact'
  };
}

function zohoRecordEmail(record = {}) {
  return Emails.normalizeEmail(record.Email || record.Email_Address || record.Secondary_Email || '');
}

function zohoRecordPhone(record = {}) {
  return record.Phone || record.Mobile || record.Home_Phone || record.Other_Phone || '';
}

function zohoRecordCompany(record = {}) {
  return record.Company || record.Account_Name?.name || record.Vendor_Name?.name || record.Organization || '';
}

function zohoRecordText(record = {}) {
  return [
    record.Description,
    record.Title,
    record.Lead_Source,
    record.Industry,
    record.Course,
    record.Programme,
    record.Program,
    record.Interested_In,
    record.Tag?.map?.(item => item.name).join(' ')
  ].filter(Boolean).join(' ');
}

function zohoDisplayValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(zohoDisplayValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return value.name || value.display_value || value.email || value.id || '';
  return String(value);
}

function zohoRecordOwner(record = {}) {
  return zohoDisplayValue(record.Owner || record.Created_By || record.Modified_By);
}

function zohoRecordStatus(moduleName, record = {}) {
  return record.Stage || record.Deal_Stage || record.Lead_Status || record.Status || record.Call_Status || record.Event_Status || record.Task_Status || moduleName;
}

function zohoRecordTitle(moduleName, record = {}) {
  const names = zohoRecordNameParts(record);
  const person = [names.first_name, names.last_name].filter(Boolean).join(' ').trim();
  return record.Subject || record.Deal_Name || record.Campaign_Name || record.Account_Name?.name || record.Account_Name || record.Full_Name || record.Name || record.Company || record.Title || person || `${moduleName} record`;
}

function zohoRecordSummary(moduleName, record = {}) {
  const id = String(record.id || record.Id || '').trim();
  const interestingKeys = [
    'Lead_Source',
    'Industry',
    'Description',
    'Amount',
    'Closing_Date',
    'Due_Date',
    'Call_Start_Time',
    'Call_Duration',
    'Call_Type',
    'Venue',
    'Start_DateTime',
    'End_DateTime',
    'Note_Title',
    'Note_Content'
  ];
  const fields = {};
  for (const key of interestingKeys) {
    const value = zohoDisplayValue(record[key]);
    if (value) fields[key] = value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  return {
    id,
    key: zohoRecordId(moduleName, record),
    module: moduleName,
    title: zohoRecordTitle(moduleName, record),
    name: zohoRecordTitle(moduleName, record),
    email: zohoRecordEmail(record),
    phone: zohoRecordPhone(record),
    company: zohoRecordCompany(record),
    owner: zohoRecordOwner(record),
    status: zohoRecordStatus(moduleName, record),
    created_time: record.Created_Time || record.created_time || null,
    modified_time: record.Modified_Time || record.modified_time || null,
    fields
  };
}

function mergeZohoRecordSummaries(db, moduleName, summaries = []) {
  db.zoho ||= { imported_record_ids: [] };
  db.zoho.records ||= {};
  const existing = Array.isArray(db.zoho.records[moduleName]) ? db.zoho.records[moduleName] : [];
  const byKey = new Map(existing.map(item => [item.key || `${moduleName}:${item.id}`, item]));
  for (const summary of summaries) {
    if (!summary?.key || summary.key.endsWith(':')) continue;
    byKey.set(summary.key, { ...(byKey.get(summary.key) || {}), ...summary });
  }
  db.zoho.records[moduleName] = [...byKey.values()]
    .sort((a, b) => new Date(b.modified_time || b.created_time || 0) - new Date(a.modified_time || a.created_time || 0))
    .slice(0, 500);
}

function zohoRecordsPayload(db = {}) {
  const records = db.zoho?.records || {};
  const connection = zohoConnectionDiagnostics({ headers: {}, socket: {} }, db);
  return {
    modules: zohoSyncModules().map(moduleName => {
      const rows = Array.isArray(records[moduleName]) ? records[moduleName] : [];
      return { module: moduleName, total: rows.length, records: rows };
    }),
    last_sync_at: db.zoho?.last_sync_at || null,
    connected: connection.connected
  };
}

function promiseTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = 'KBC_TIMEOUT';
      reject(error);
    }, Math.max(1, Number(timeoutMs) || 1));
    if (timer.unref) timer.unref();
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout
  ]);
}

function zohoRecordsPreviewFallback(db = {}, error = null) {
  const payload = zohoRecordsPayload(db);
  payload.modules = zohoSyncModules().map(moduleName => ({
    module: moduleName,
    total: 0,
    loaded: 0,
    records: []
  }));
  payload.total = 0;
  payload.error = error?.code === 'KBC_TIMEOUT'
    ? 'Zoho records preview timed out while connecting to the database. Try again in a moment.'
    : 'Zoho records preview is temporarily unavailable. Try again in a moment.';
  return payload;
}

async function loadZohoRecordPage(options = {}) {
  await Storage.ensureStorage();
  const limit = Math.max(1, Math.min(Number(options.limit || 200), 500));
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const moduleName = String(options.module || '').trim();
  const search = String(options.search || '').trim().slice(0, 200);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    const all = Object.values(db.zoho?.records || {}).flat()
      .filter(row => !moduleName || String(row.module || '').toLowerCase() === moduleName.toLowerCase())
      .filter(row => !search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
    const records = all.slice(offset, offset + limit);
    return { module: moduleName, search, records, total: all.length, limit, offset, has_more: offset + records.length < all.length, next_offset: offset + records.length };
  }
  await ensureZohoRecordsTable();
  const where = [];
  const params = [];
  if (moduleName) {
    params.push(moduleName);
    where.push(`module = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, char => `\\${char}`)}%`);
    const term = `$${params.length}`;
    where.push(`(title ilike ${term} or email ilike ${term} or phone ilike ${term} or company ilike ${term} or owner_name ilike ${term} or status ilike ${term} or zoho_id ilike ${term})`);
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const [count, rows] = await Promise.all([
    State.postgresPool.query(`select count(*)::int as total from app_zoho_records ${whereSql}`, params),
    State.postgresPool.query(
      `select data from app_zoho_records ${whereSql}
       order by modified_time desc nulls last, key
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    )
  ]);
  const total = Number(count.rows[0]?.total || 0);
  const records = rows.rows.map(row => row.data).filter(Boolean);
  return { module: moduleName, search, records, total, limit, offset, has_more: offset + records.length < total, next_offset: offset + records.length };
}

function queryZohoPreviewRecords() {
  return State.postgresPool.query(
    `select data
     from app_zoho_records
     order by modified_time desc nulls last, synced_at desc nulls last, key
     limit $1`,
    [Config.ZOHO_RECORDS_PREVIEW_LIMIT]
  );
}

// pendingRecords: the records query when the caller has already sent it (see loadZohoRecordsPreviewDb).
async function zohoRecordsPayloadDbUnsafe(db = {}, pendingRecords = null) {
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return zohoRecordsPayload(db);
  await ensureZohoRecordsTable();
  const records = await (pendingRecords || queryZohoPreviewRecords());
  const byModule = new Map();
  for (const row of records.rows.map(item => item.data).filter(Boolean)) {
    const moduleName = row.module || 'Zoho CRM';
    const list = byModule.get(moduleName) || [];
    list.push(row);
    byModule.set(moduleName, list);
  }
  const payload = zohoRecordsPayload({ ...db, zoho: { ...(db.zoho || {}), records: Object.fromEntries(byModule) } });
  payload.modules = zohoSyncModules().map(moduleName => {
    const rows = byModule.get(moduleName) || [];
    return { module: moduleName, total: rows.length, loaded: rows.length, records: rows };
  });
  payload.total = records.rows.length;
  payload.loaded = records.rows.length;
  payload.limit = Config.ZOHO_RECORDS_PREVIEW_LIMIT;
  payload.preview_limited = true;
  return payload;
}

// GET /api/integrations/zoho/records. The Zoho state and the newest records do not depend on
// each other, so both reads are sent together: one round trip to the database instead of two.
async function loadZohoRecordsPreviewDb() {
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return zohoRecordsPayloadDb(await loadZohoWorkspaceState());
  await Promise.all([Storage.ensureStorage(), ensureZohoRecordsTable()]);
  const pendingRecords = queryZohoPreviewRecords();
  // A failure is reported where the result is awaited, inside zohoRecordsPayloadDb.
  pendingRecords.catch(() => {});
  return zohoRecordsPayloadDb(await loadZohoWorkspaceState(), pendingRecords);
}

async function zohoRecordsPayloadDb(db = {}, pendingRecords = null) {
  try {
    return await promiseTimeout(
      zohoRecordsPayloadDbUnsafe(db, pendingRecords),
      Config.ZOHO_RECORDS_PREVIEW_TIMEOUT_MS,
      'Zoho records preview timed out while connecting to the database.'
    );
  } catch (error) {
    if (error?.code === 'KBC_TIMEOUT' || Storage.postgresConnectionLost(error)) {
      console.error(`Zoho records preview unavailable: ${error.message || error}`);
      return zohoRecordsPreviewFallback(db, error);
    }
    throw error;
  }
}

async function loadZohoWorkspaceState() {
  if (!Storage.usesPostgresStorage()) return Storage.loadDb();
  await Storage.ensureStorage();
  const result = await State.postgresPool.query(
    `select coalesce(meta->'zoho', '{}'::jsonb) - 'records' - 'imported_record_ids' as zoho
     from app_workspace
     where id = $1`,
    ['main']
  );
  return { zoho: result.rows[0]?.zoho || {} };
}

function createOrUpdateZohoLead(db, user, moduleName, record) {
  const recordId = zohoRecordId(moduleName, record);
  if (!recordId.endsWith(':') && (db.zoho.imported_record_ids || []).includes(recordId)) {
    const existing = db.leads.find(item => item.zoho_record_id === recordId);
    if (existing) return { lead: existing, created: false, skipped: true };
  }
  const email = zohoRecordEmail(record) || `${String(record.id || crypto.randomBytes(5).toString('hex'))}@zoho.local`;
  const names = zohoRecordNameParts(record);
  const programme = Programmes.programmeForText(db, zohoRecordText(record));
  return Leads.ensureLeadRecord(db, user, {
    first_name: names.first_name,
    last_name: names.last_name,
    programme_id: programme.id,
    email,
    employer: zohoRecordCompany(record),
    phone: zohoRecordPhone(record),
    city: [record.City, record.State, record.Country].filter(Boolean).join(', '),
    stage: 'New lead',
    priority: moduleName === 'Leads' ? 'P2' : 'P3',
    source_first_touch: 'Zoho CRM',
    source_lead_capture: 'Zoho CRM',
    contact_permission: record.Email_Opt_Out ? 'Declined' : 'Unknown',
    created_at: record.Created_Time || record.Modified_Time || new Date().toISOString(),
    zoho_record_id: recordId,
    zoho_module: moduleName,
    programme_text: zohoRecordText(record)
  });
}

// Only Zoho Leads become CRM leads. Contacts and the other modules stay in
// app_zoho_records and are shown on the Zoho page.
function zohoModuleCreatesCrmLeads(moduleName) {
  return String(moduleName || '').toLowerCase() === 'leads';
}

function zohoRecordFields(moduleName) {
  const common = ['id', 'Owner', 'Created_Time', 'Modified_Time', 'Created_By', 'Modified_By'];
  const byModule = {
    Leads: ['First_Name', 'Last_Name', 'Full_Name', 'Email', 'Secondary_Email', 'Phone', 'Mobile', 'Company', 'City', 'State', 'Country', 'Lead_Status', 'Lead_Source', 'Industry', 'Title', 'Description', 'Email_Opt_Out', 'Tag'],
    Contacts: ['First_Name', 'Last_Name', 'Full_Name', 'Email', 'Secondary_Email', 'Phone', 'Mobile', 'Home_Phone', 'Other_Phone', 'Account_Name', 'Mailing_City', 'Mailing_State', 'Mailing_Country', 'Lead_Source', 'Description', 'Email_Opt_Out', 'Tag'],
    Accounts: ['Account_Name', 'Phone', 'Website', 'Industry', 'Billing_City', 'Billing_State', 'Billing_Country', 'Description', 'Tag'],
    Deals: ['Deal_Name', 'Stage', 'Amount', 'Closing_Date', 'Account_Name', 'Contact_Name', 'Lead_Source', 'Description', 'Tag'],
    Tasks: ['Subject', 'Status', 'Due_Date', 'Priority', 'What_Id', 'Who_Id', 'Description'],
    Calls: ['Subject', 'Call_Type', 'Call_Status', 'Call_Start_Time', 'Call_Duration', 'Who_Id', 'What_Id', 'Description'],
    Events: ['Event_Title', 'Start_DateTime', 'End_DateTime', 'Venue', 'Who_Id', 'What_Id', 'Description'],
    Campaigns: ['Campaign_Name', 'Status', 'Type', 'Start_Date', 'End_Date', 'Expected_Revenue', 'Description'],
    Notes: ['Note_Title', 'Note_Content', 'Parent_Id', 'se_module']
  };
  return [...new Set([...common, ...(byModule[moduleName] || ['Name', 'Email', 'Phone', 'Description'])])].slice(0, 50);
}

// Zoho only serves the first 2000 records of a listing through `page`; later pages must
// be requested with the `page_token` returned in the previous response's info.
const ZOHO_PAGE_PARAM_RECORD_LIMIT = 2000;

async function fetchZohoRecordPage(db, moduleName, page = 1, maxRecords = Config.ZOHO_SYNC_BATCH_SIZE, pageToken = '', options = {}) {
  const limit = Math.max(1, Math.min(Number(maxRecords || Config.ZOHO_SYNC_BATCH_SIZE), 200));
  const safePage = Math.max(1, Math.min(Number(page || 1), Config.ZOHO_SYNC_MAX_PAGES_PER_MODULE));
  const params = new URLSearchParams({
    fields: zohoRecordFields(moduleName).join(','),
    per_page: String(limit),
    sort_order: 'desc',
    sort_by: 'Modified_Time'
  });
  if (pageToken && safePage * limit > ZOHO_PAGE_PARAM_RECORD_LIMIT) params.set('page_token', pageToken);
  else params.set('page', String(safePage));
  const url = `${zohoApiBaseUrl(db)}/crm/v8/${encodeURIComponent(moduleName)}?${params}`;
  // Incremental runs only ask for records modified after the module's last sync.
  const modifiedSince = options.modifiedSince ? new Date(options.modifiedSince).toISOString().replace(/\.\d{3}Z$/, '+00:00') : '';
  async function requestWithToken() {
    const token = await zohoAccessToken(db);
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    if (modifiedSince) headers['If-Modified-Since'] = modifiedSince;
    return Util.fetchJson(url, { headers, timeoutMs: 30000 });
  }
  const pageResult = result => ({
    records: result.data || [],
    info: result.info || {},
    moreRecords: Boolean(result.info?.more_records),
    nextPage: safePage + 1
  });
  try {
    return pageResult(await requestWithToken());
  } catch (error) {
    // Zoho answers 304 when nothing changed since If-Modified-Since.
    if (Number(error.status || 0) === 304) return pageResult({});
    if (Number(error.status || 0) !== 401 || !db.zoho?.refresh_token) throw error;
    db.zoho.access_token = '';
    db.zoho.expires_at = 0;
    await refreshZohoToken(db);
    try {
      return pageResult(await requestWithToken());
    } catch (retryError) {
      if (Number(retryError.status || 0) === 304) return pageResult({});
      throw retryError;
    }
  }
}

async function fetchZohoRecords(db, moduleName, maxRecords = 50) {
  const result = await fetchZohoRecordPage(db, moduleName, 1, maxRecords);
  return result.records || [];
}

async function importZohoCrmRecords(db, user, maxRecords = 50) {
  if (!zohoConfigured()) throw Http.statusError(400, 'Zoho CRM credentials are not configured. Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.');
  db.zoho ||= { imported_record_ids: [] };
  const connection = zohoConnectionDiagnostics({ headers: {}, socket: {} }, db);
  console.info(`[zoho] sync connection status=${connection.status} record=${connection.connectionRecordExists} refresh=${connection.refreshTokenStored} access_expired=${connection.accessTokenExpired} accounts=${connection.accountsServer || 'missing'} api_domain=${connection.apiDomain || 'missing'}`);
  if (!connection.connected) throw Http.statusError(401, connection.status === 'reauthorization_required' ? zohoReconnectRequiredMessage() : `Zoho CRM is not ready to sync (${connection.status}).`);
  const safeMax = Math.max(1, Math.min(Number(maxRecords || 50), 100));
  const modules = zohoSyncModules();
  let imported = 0, updated = 0, scanned = 0;
  const module_results = [];
  const warnings = [];
  for (const moduleName of modules) {
    let records = [];
    let moduleImported = 0, moduleUpdated = 0;
    try {
      records = await fetchZohoRecords(db, moduleName, safeMax);
    } catch (error) {
      if (/oauth_scope_mismatch|scope|permission|no permission|not authorized|authorization/i.test(error.message || '')) {
        warnings.push(`${moduleName}: ${error.message}`);
        module_results.push({ module: moduleName, scanned: 0, imported: 0, updated: 0, stored: Array.isArray(db.zoho.records?.[moduleName]) ? db.zoho.records[moduleName].length : 0, skipped: true, warning: error.message });
        continue;
      }
      throw error;
    }
    mergeZohoRecordSummaries(db, moduleName, records.slice(0, safeMax).map(record => zohoRecordSummary(moduleName, record)));
    for (const record of records.slice(0, safeMax)) {
      scanned += 1;
      const recordId = zohoRecordId(moduleName, record);
      if (!recordId || recordId.endsWith(':')) continue;
      if (!db.zoho.imported_record_ids.includes(recordId)) db.zoho.imported_record_ids.push(recordId);
      if (!zohoModuleCreatesCrmLeads(moduleName)) continue;
      const result = createOrUpdateZohoLead(db, user, moduleName, record);
      if (!result.excluded && !db.zoho.imported_record_ids.includes(recordId)) db.zoho.imported_record_ids.push(recordId);
      if (result.created) {
        imported += 1;
        moduleImported += 1;
      } else if (result.lead && !result.skipped) {
        updated += 1;
        moduleUpdated += 1;
      }
    }
    module_results.push({
      module: moduleName,
      scanned: records.length,
      imported: moduleImported,
      updated: moduleUpdated,
      stored: Array.isArray(db.zoho.records?.[moduleName]) ? db.zoho.records[moduleName].length : 0
    });
  }
  db.zoho.last_sync_at = new Date().toISOString();
  db.meta ||= {};
  db.meta.zoho = db.zoho;
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Zoho CRM synced', 'integration', 'Zoho CRM', `${imported} created, ${updated} updated, ${scanned} scanned`);
  await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, preserveApollo: true });
  return { imported, updated, scanned, modules: module_results, warnings, reconciliation, last_sync_at: db.zoho.last_sync_at };
}

function zohoSyncConnectionId() {
  return 'main';
}

function zohoSyncJobId() {
  return `zoho_sync_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function zohoSyncCursor(values = {}, batchSize = Config.ZOHO_SYNC_BATCH_SIZE) {
  return {
    page: Math.max(1, Number(values.page || 1)),
    pageToken: values.pageToken || null,
    limit: Math.max(1, Math.min(Number(values.limit || batchSize), 200)),
    done: Boolean(values.done),
    skipped: Boolean(values.skipped),
    modifiedSince: values.modifiedSince || null
  };
}

function zohoSyncState(row = {}) {
  const state = row.state || {};
  const modules = Array.isArray(state.modules) && state.modules.length ? state.modules : zohoSyncModules();
  const batchSize = Math.max(1, Math.min(Number(state.batchSize || Config.ZOHO_SYNC_BATCH_SIZE), 200));
  const moduleIndex = Math.max(0, Math.min(Number(state.moduleIndex || 0), modules.length));
  const moduleResults = state.moduleResults || {};
  const cursors = {};
  modules.forEach((moduleName, index) => {
    if (state.cursors?.[moduleName]) {
      cursors[moduleName] = zohoSyncCursor(state.cursors[moduleName], batchSize);
    } else if (state.cursors) {
      cursors[moduleName] = zohoSyncCursor({}, Config.ZOHO_SYNC_BATCH_SIZE);
    } else if (index < moduleIndex) {
      // Jobs created before per-module cursors walked the modules one at a time.
      cursors[moduleName] = zohoSyncCursor({ done: true, skipped: moduleResults[moduleName]?.skipped }, batchSize);
    } else if (index === moduleIndex) {
      cursors[moduleName] = zohoSyncCursor({ page: row.current_page, pageToken: row.next_page_token }, batchSize);
    } else {
      cursors[moduleName] = zohoSyncCursor({}, Config.ZOHO_SYNC_BATCH_SIZE);
    }
  });
  const mode = state.mode || (state.fullSync === false ? 'partial' : 'full');
  return {
    ...state,
    version: 2,
    mode,
    modules,
    moduleIndex,
    batchSize,
    maxRecords: Math.max(0, Math.min(Number(state.maxRecords || 0), 1000000)),
    fullSync: mode === 'full',
    cursors,
    warnings: Array.isArray(state.warnings) ? state.warnings : [],
    moduleResults
  };
}

function zohoIncrementalSince(mark) {
  const time = mark ? new Date(mark).getTime() : NaN;
  return Number.isFinite(time) ? new Date(time - Config.ZOHO_INCREMENTAL_OVERLAP_MS).toISOString() : null;
}

function zohoSyncJobPayload(row = null) {
  if (!row) return { jobId: null, status: 'idle' };
  const state = zohoSyncState(row);
  return {
    jobId: row.id,
    status: row.status,
    currentModule: row.current_module || null,
    currentPage: Number(row.current_page || 1),
    recordsScanned: Number(row.records_scanned || 0),
    recordsAdded: Number(row.records_added || 0),
    recordsUpdated: Number(row.records_updated || 0),
    recordsFailed: Number(row.records_failed || 0),
    modulesCompleted: Number(row.modules_completed || 0),
    modulesTotal: Number(row.modules_total || 0),
    batchSize: state.batchSize,
    maxRecords: state.maxRecords,
    fullSync: state.fullSync,
    mode: state.mode,
    activeModules: ['queued', 'running'].includes(row.status) ? state.modules.filter(moduleName => !state.cursors[moduleName]?.done) : [],
    moduleResults: state.moduleResults,
    warnings: state.warnings,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    lastProgressAt: row.last_progress_at ? new Date(row.last_progress_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    retryAfterAt: row.retry_after_at ? new Date(row.retry_after_at).toISOString() : null,
    lastError: row.last_error || null
  };
}

function zohoSafeJobError(error) {
  return String(error?.message || error || 'Zoho sync failed.')
    .replace(/access[_-]?token|refresh[_-]?token|client[_-]?secret|password|bearer|zoho-oauthtoken/ig, 'credential')
    .slice(0, 500);
}

async function loadZohoConnectionState(client = State.postgresPool) {
  await Storage.ensureIntegrationJobsTable(client);
  const result = await client.query(`select meta from app_workspace where id = $1`, ['main']);
  const meta = result.rows[0]?.meta || {};
  return meta.zoho || { imported_record_ids: [] };
}

async function saveZohoConnectionState(client, zohoState = {}) {
  const current = await client.query(`select demo, stages, sources, gmail, eventbrite, meta from app_workspace where id = $1`, ['main']);
  const row = current.rows[0] || {};
  const meta = { ...(row.meta || {}), zoho: zohoState };
  await client.query(
    `insert into app_workspace (id, demo, stages, sources, gmail, eventbrite, meta, updated_at)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
     on conflict (id) do update set meta = excluded.meta, updated_at = now()`,
    ['main', Boolean(row.demo), Applications.jsonValue(row.stages || []), Applications.jsonValue(row.sources || []), Applications.jsonValue(row.gmail || {}), Applications.jsonValue(row.eventbrite || {}), Applications.jsonValue(meta)]
  );
  State.dbCache = null;
}

async function latestZohoSyncJob(connectionId = zohoSyncConnectionId()) {
  await Storage.ensureStorage();
  if (!State.postgresPool) return null;
  await Storage.ensureIntegrationJobsTable();
  const result = await State.postgresPool.query(
    `select * from integration_jobs
     where provider = 'zoho'
       and type = 'crm_sync'
       and connection_id = $1
     order by
       case when status in ('queued', 'running') then 0 else 1 end,
       updated_at desc
     limit 1`,
    [connectionId]
  );
  return result.rows[0] || null;
}

async function getZohoSyncJob(jobId) {
  await Storage.ensureStorage();
  if (!State.postgresPool) return null;
  await Storage.ensureIntegrationJobsTable();
  const result = await State.postgresPool.query(`select * from integration_jobs where id = $1 and provider = 'zoho' limit 1`, [jobId]);
  return result.rows[0] || null;
}

async function createOrResumeZohoSyncJob(req, user, options = {}) {
  await Storage.ensureStorage();
  if (!State.postgresPool) throw Http.statusError(500, 'Zoho background sync requires PostgreSQL storage.');
  await Storage.ensureIntegrationJobsTable();
  if (!zohoConfigured()) throw Http.statusError(400, 'Zoho CRM credentials are not configured. Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.');
  const connectionId = zohoSyncConnectionId();
  const client = await State.postgresPool.connect();
  try {
    const active = await client.query(
      `select * from integration_jobs
       where provider = 'zoho'
         and type = 'crm_sync'
         and connection_id = $1
         and status in ('queued', 'running')
       order by updated_at desc
       limit 1`,
      [connectionId]
    );
    const fullSyncRequested = options.full_sync === true || String(options.full_sync || '').toLowerCase() === 'true' || String(options.mode || '').toLowerCase() === 'full' || String(options.max_records || options.maxRecords || '').toLowerCase() === 'all';
    // A running job's state is written page by page by its module workers, so it is never
    // rewritten here; a full resync requested meanwhile starts after the active job ends.
    if (active.rows[0]) {
      scheduleZohoSyncWorker(active.rows[0].id, 0);
      return active.rows[0];
    }
    const zoho = await loadZohoConnectionState(client);
    const connection = zohoConnectionDiagnostics(req, { zoho });
    if (!connection.connected) {
      throw Http.statusError(401, connection.status === 'reauthorization_required' ? zohoReconnectRequiredMessage() : `Zoho CRM is not ready to sync (${connection.status}).`);
    }
    // A normal sync picks up a recently failed job from its saved cursors instead of
    // starting over. Zoho page tokens last 24 hours, so older failures start fresh.
    if (!fullSyncRequested) {
      const resumed = await client.query(
        `update integration_jobs
         set status = 'queued', completed_at = null, last_error = null, retry_after_at = null,
             locked_by = null, locked_until = null, updated_at = now()
         where id = (
             select id from integration_jobs
             where provider = 'zoho' and type = 'crm_sync' and connection_id = $1
             order by updated_at desc
             limit 1
           )
           and status = 'failed'
           and updated_at > now() - interval '20 hours'
         returning *`,
        [connectionId]
      );
      if (resumed.rows[0]) {
        scheduleZohoSyncWorker(resumed.rows[0].id, 0);
        return resumed.rows[0];
      }
    }
    const modules = zohoSyncModules();
    const batchSize = Math.max(1, Math.min(Number(options.batch_size || options.batchSize || Config.ZOHO_SYNC_BATCH_SIZE), 200));
    const id = zohoSyncJobId();
    // Modules with a previous completed sync only fetch what changed since then, unless a
    // full resync was asked for.
    const marks = fullSyncRequested ? {} : (zoho.sync_marks || {});
    const cursors = Object.fromEntries(modules.map(moduleName => [moduleName, zohoSyncCursor({ modifiedSince: zohoIncrementalSince(marks[moduleName]) }, batchSize)]));
    const mode = modules.some(moduleName => cursors[moduleName].modifiedSince) ? 'incremental' : 'full';
    const state = { version: 2, mode, modules, batchSize, maxRecords: 0, fullSync: mode === 'full', cursors, warnings: [], moduleResults: {}, startedBy: user.id };
    const inserted = await client.query(
      `insert into integration_jobs (
         id, provider, connection_id, type, status, current_module, current_page,
         records_scanned, records_added, records_updated, records_failed,
         modules_total, modules_completed, created_by, state, created_at, updated_at
       )
       values ($1, 'zoho', $2, 'crm_sync', 'queued', $3, 1, 0, 0, 0, 0, $4, 0, $5, $6::jsonb, now(), now())
       returning *`,
      [id, connectionId, modules[0] || null, modules.length, user.id, Applications.jsonValue(state)]
    );
    scheduleZohoSyncWorker(id, 0);
    return inserted.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const existing = await latestZohoSyncJob(connectionId);
      if (existing && ['queued', 'running'].includes(existing.status)) {
        scheduleZohoSyncWorker(existing.id, 0);
        return existing;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function upsertZohoLeadFromRecord(client, user, moduleName, record) {
  const recordId = zohoRecordId(moduleName, record);
  if (!recordId || recordId.endsWith(':')) return { added: 0, updated: 0 };
  const email = zohoRecordEmail(record) || `${String(record.id || crypto.randomBytes(5).toString('hex'))}@zoho.local`;
  if (Leads.isExcludedLeadSender(email, record.First_Name, record.Last_Name)) return { added: 0, updated: 0 };
  const names = zohoRecordNameParts(record);
  const programme = Programmes.programmeForText({ programmes: [] }, zohoRecordText(record));
  const incoming = {
    first_name: names.first_name,
    last_name: names.last_name,
    full_name: `${names.first_name} ${names.last_name}`.trim(),
    programme: programme.name,
    programme_id: programme.id,
    level: programme.level,
    email: Emails.normalizeEmail(email),
    employer: zohoRecordCompany(record),
    phone: zohoRecordPhone(record),
    city: [record.City, record.State, record.Country, record.Mailing_City, record.Mailing_State, record.Mailing_Country].filter(Boolean).join(', '),
    owner: user?.name || 'Sales',
    owner_id: user?.id || 'system',
    stage: 'New lead',
    priority: moduleName === 'Leads' ? 'P2' : 'P3',
    source_first_touch: 'Zoho CRM',
    source_lead_capture: 'Zoho CRM',
    contact_permission: record.Email_Opt_Out ? 'Declined' : 'Unknown',
    created_at: record.Created_Time || record.Modified_Time || new Date().toISOString(),
    next_action_at: null,
    zoho_record_id: recordId,
    zoho_module: moduleName
  };
  // A match on a merged duplicate resolves to its master, so re-imports never recreate it.
  const existing = await client.query(
    `select ${State.leadSoftDelete.enabled ? 'coalesce(m.data, l.data)' : 'l.data'} as data from app_leads l
     ${State.leadSoftDelete.enabled ? 'left join app_leads m on m.id = l.merged_into_id and m.deleted_at is null' : ''}
     where l.data->>'zoho_record_id' = $1
        or ($2 <> '' and lower(coalesce(l.email, '')) = $2)
     order by case when l.data->>'zoho_record_id' = $1 then 0 else 1 end
     limit 1`,
    [recordId, incoming.email]
  );
  let lead = existing.rows[0]?.data || null;
  let added = 0;
  if (lead) {
    Leads.mergeLeadData(lead, incoming);
  } else {
    let id = Emails.leadIdForEmail({ leads: [] }, incoming.email);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const taken = await client.query(`select data from app_leads where id = $1 limit 1`, [id]);
      if (!taken.rows[0] || Emails.normalizeEmail(taken.rows[0].data?.email) === incoming.email) break;
      id = Emails.emailLeadId(`${incoming.email}:${recordId}`, attempt);
    }
    lead = { ...incoming, id, person_id: id };
    Leads.addLeadSource(lead, 'Zoho CRM', { provider_id: recordId, captured_at: incoming.created_at });
    added = 1;
  }
  lead.full_name = Util.fullName(lead);
  await client.query(
    `insert into app_leads (id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::timestamptz, $20::timestamptz, $21::jsonb)
     on conflict (id) do update set
       person_id = excluded.person_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
       employer = excluded.employer, phone = excluded.phone, city = excluded.city, programme_id = excluded.programme_id,
       programme = excluded.programme, level = excluded.level, owner_id = excluded.owner_id, owner = excluded.owner,
       stage = excluded.stage, priority = excluded.priority, source_first_touch = excluded.source_first_touch,
       source_lead_capture = excluded.source_lead_capture, contact_permission = excluded.contact_permission,
       created_at = excluded.created_at, next_action_at = excluded.next_action_at, data = excluded.data`,
    [lead.id, lead.person_id || lead.id, lead.first_name || null, lead.last_name || null, lead.email || null, lead.employer || null, lead.phone || null, lead.city || null, lead.programme_id || null, lead.programme || null, lead.level || null, lead.owner_id || null, lead.owner || null, lead.stage || null, lead.priority || null, lead.source_first_touch || null, lead.source_lead_capture || null, lead.contact_permission || null, lead.created_at || null, lead.next_action_at || null, Applications.jsonValue(lead)]
  );
  if (added) {
    const taskId = `ZT-${crypto.createHash('sha1').update(recordId).digest('hex').slice(0, 16)}`;
    const task = {
      id: taskId,
      title: `Follow up Zoho ${moduleName.slice(0, -1).toLowerCase()}: ${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      lead_id: lead.id,
      kind: 'Follow-up',
      status: 'Open',
      created_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 86400000).toISOString(),
      priority: lead.priority,
      owner_id: lead.owner_id
    };
    await client.query(
      `insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)
       on conflict (id) do nothing`,
      [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, Applications.jsonValue(task)]
    );
  }
  return { added, updated: added ? 0 : 1 };
}

async function upsertZohoLeadsFromRecords(client, user, moduleName, records = []) {
  const incomingRows = [];
  for (const record of records) {
    const recordId = zohoRecordId(moduleName, record);
    if (!recordId || recordId.endsWith(':')) continue;
    const email = zohoRecordEmail(record) || `${String(record.id || crypto.randomBytes(5).toString('hex'))}@zoho.local`;
    if (Leads.isExcludedLeadSender(email, record.First_Name, record.Last_Name)) continue;
    const names = zohoRecordNameParts(record);
    const programme = Programmes.programmeForText({ programmes: [] }, zohoRecordText(record));
    incomingRows.push({
      first_name: names.first_name,
      last_name: names.last_name,
      full_name: `${names.first_name} ${names.last_name}`.trim(),
      programme: programme.name,
      programme_id: programme.id,
      level: programme.level,
      email: Emails.normalizeEmail(email),
      employer: zohoRecordCompany(record),
      phone: zohoRecordPhone(record),
      city: [record.City, record.State, record.Country, record.Mailing_City, record.Mailing_State, record.Mailing_Country].filter(Boolean).join(', '),
      owner: user?.name || 'Sales',
      owner_id: user?.id || 'system',
      stage: 'New lead',
      priority: moduleName === 'Leads' ? 'P2' : 'P3',
      source_first_touch: 'Zoho CRM',
      source_lead_capture: 'Zoho CRM',
      contact_permission: record.Email_Opt_Out ? 'Declined' : 'Unknown',
      created_at: record.Created_Time || record.Modified_Time || new Date().toISOString(),
      next_action_at: null,
      zoho_record_id: recordId,
      zoho_module: moduleName
    });
  }
  if (!incomingRows.length) return { added: 0, updated: 0, failed: 0 };
  const zohoIds = incomingRows.map(row => row.zoho_record_id);
  const emails = incomingRows.map(row => String(row.email || '').toLowerCase()).filter(Boolean);
  // Matches on a merged duplicate resolve to its master, so re-imports never recreate it.
  const existing = await client.query(
    `select ${State.leadSoftDelete.enabled ? 'coalesce(m.data, l.data)' : 'l.data'} as data,
       l.data->>'zoho_record_id' as matched_zoho_id, lower(l.email) as matched_email
     from app_leads l
     ${State.leadSoftDelete.enabled ? 'left join app_leads m on m.id = l.merged_into_id and m.deleted_at is null' : ''}
     where l.data->>'zoho_record_id' = any($1::text[])
        or lower(l.email) = any($2::text[])`,
    [zohoIds, emails]
  );
  // One object per lead id, so a lead matched twice is updated once.
  const byId = new Map();
  const byZoho = new Map();
  const byEmail = new Map();
  for (const row of existing.rows.filter(item => item.data?.id)) {
    const lead = byId.get(row.data.id) || row.data;
    byId.set(lead.id, lead);
    for (const key of [row.matched_zoho_id, lead.zoho_record_id]) if (key) byZoho.set(key, lead);
    for (const key of [row.matched_email, lead.email]) if (key) byEmail.set(Emails.normalizeEmail(key), lead);
  }
  const touched = new Map();
  let added = 0;
  let updated = 0;
  const usedIds = new Set(byId.keys());
  for (const incoming of incomingRows) {
    let lead = byZoho.get(incoming.zoho_record_id) || byEmail.get(incoming.email) || null;
    if (lead) {
      Leads.mergeLeadData(lead, incoming);
      updated += 1;
    } else {
      let id = Emails.leadIdForEmail({ leads: [] }, incoming.email);
      for (let attempt = 0; usedIds.has(id) && attempt < 20; attempt += 1) id = Emails.emailLeadId(`${incoming.email}:${incoming.zoho_record_id}`, attempt);
      usedIds.add(id);
      lead = { ...incoming, id, person_id: id };
      Leads.addLeadSource(lead, 'Zoho CRM', { provider_id: incoming.zoho_record_id, captured_at: incoming.created_at });
      // Later rows in this batch with the same email or record join this lead instead of
      // creating a second one.
      if (incoming.zoho_record_id) byZoho.set(incoming.zoho_record_id, lead);
      if (incoming.email) byEmail.set(incoming.email, lead);
      added += 1;
    }
    lead.full_name = Util.fullName(lead);
    touched.set(lead.id, lead);
  }
  const leadRows = [...touched.values()].map(lead => ({
    id: lead.id,
    person_id: lead.person_id || lead.id,
    first_name: lead.first_name || null,
    last_name: lead.last_name || null,
    email: lead.email || null,
    employer: lead.employer || null,
    phone: lead.phone || null,
    city: lead.city || null,
    programme_id: lead.programme_id || null,
    programme: lead.programme || null,
    level: lead.level || null,
    owner_id: lead.owner_id || null,
    owner: lead.owner || null,
    stage: lead.stage || null,
    priority: lead.priority || null,
    source_first_touch: lead.source_first_touch || null,
    source_lead_capture: lead.source_lead_capture || null,
    contact_permission: lead.contact_permission || null,
    created_at: lead.created_at || null,
    next_action_at: lead.next_action_at || null,
    data: lead
  }));
  await client.query(
    `with rows as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         id text, person_id text, first_name text, last_name text, email text, employer text, phone text, city text,
         programme_id text, programme text, level text, owner_id text, owner text, stage text, priority text,
         source_first_touch text, source_lead_capture text, contact_permission text, created_at text, next_action_at text, data jsonb
       )
     )
     insert into app_leads (id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data)
     select id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at::timestamptz, next_action_at::timestamptz, data from rows
     on conflict (id) do update set
       person_id = excluded.person_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
       employer = excluded.employer, phone = excluded.phone, city = excluded.city, programme_id = excluded.programme_id,
       programme = excluded.programme, level = excluded.level, owner_id = excluded.owner_id, owner = excluded.owner,
       stage = excluded.stage, priority = excluded.priority, source_first_touch = excluded.source_first_touch,
       source_lead_capture = excluded.source_lead_capture, contact_permission = excluded.contact_permission,
       created_at = excluded.created_at, next_action_at = excluded.next_action_at, data = excluded.data`,
    [Applications.jsonValue(leadRows)]
  );
  return { added, updated, failed: 0 };
}

async function insertZohoSyncAudit(client, detail) {
  const audit = {
    id: `A-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    occurred_at: new Date().toISOString(),
    actor: 'Zoho Sync',
    action: 'Zoho CRM sync completed',
    entity: 'integration',
    entity_id: 'Zoho CRM',
    detail
  };
  await client.query(
    `insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)
     on conflict (id) do nothing`,
    [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, Applications.jsonValue(audit)]
  );
}

function scheduleZohoSyncWorker(jobId = null, delayMs = Config.ZOHO_SYNC_WORKER_YIELD_MS) {
  if (!State.postgresPool || !Config.ZOHO_SYNC_WORKER_ENABLED) return;
  const delay = Math.max(0, Number(delayMs) || 0);
  const timer = setTimeout(() => {
    runZohoSyncWorker(jobId).catch(error => console.error(`Zoho sync worker failed: ${zohoSafeJobError(error)}`));
  }, delay);
  if (timer.unref) timer.unref();
}

// A job is owned through a lease on its row (locked_by/locked_until) rather than a
// session advisory lock: Neon's pooled connections do not keep a session between
// statements, so advisory locks there neither exclude a second worker nor release cleanly.
async function claimZohoSyncJob(jobId) {
  const result = await State.postgresPool.query(
    `update integration_jobs
     set locked_by = $2, locked_until = now() + ($3 || ' milliseconds')::interval, updated_at = now()
     where id = $1
       and provider = 'zoho'
       and status in ('queued', 'running')
       and (locked_by is null or locked_by = $2 or locked_until is null or locked_until < now())
     returning *`,
    [jobId, Config.ZOHO_WORKER_ID, String(Config.ZOHO_JOB_LEASE_MS)]
  );
  return result.rows[0] || null;
}

async function renewZohoSyncLease(ctx) {
  const result = await State.postgresPool.query(
    `update integration_jobs
     set locked_until = now() + ($3 || ' milliseconds')::interval
     where id = $1 and locked_by = $2
     returning status`,
    [ctx.jobId, Config.ZOHO_WORKER_ID, String(Config.ZOHO_JOB_LEASE_MS)]
  );
  if (result.rows[0]?.status !== 'running') ctx.stop = true;
}

async function releaseZohoSyncJob(jobId) {
  await State.postgresPool.query(
    `update integration_jobs set locked_by = null, locked_until = null where id = $1 and locked_by = $2`,
    [jobId, Config.ZOHO_WORKER_ID]
  ).catch(() => null);
}

// Dropped connections to Zoho or Neon (TLS resets, timeouts, DNS blips) are temporary; the
// job resumes from its saved cursors instead of failing.
function isTransientNetworkError(error) {
  const code = String(error?.code || error?.cause?.code || '');
  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', '57P01', '08000', '08003', '08006'].includes(code)) return true;
  return /socket disconnected|socket hang up|tls connection|connection terminated|connection timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(String(error?.message || ''));
}

function isZohoScopeError(error) {
  return /oauth_scope_mismatch|scope|permission|no permission|not authorized|authorization/i.test(error?.message || '');
}

async function fetchZohoPageWithRetry(ctx, moduleName, cursor) {
  let lastError = null;
  for (let attempt = 0; attempt < Config.ZOHO_FETCH_ATTEMPTS; attempt += 1) {
    if (ctx.stop) throw Http.statusError(499, 'Zoho sync stopped.');
    try {
      return await fetchZohoRecordPage(ctx.dbLike, moduleName, cursor.page, cursor.limit, cursor.pageToken || '', { modifiedSince: cursor.modifiedSince || '' });
    } catch (error) {
      lastError = error;
      const status = Number(error.status || 0);
      if (![429, 500, 502, 503, 504].includes(status) || attempt === Config.ZOHO_FETCH_ATTEMPTS - 1) throw error;
      await Zoom.wait(status === 429 ? 30000 * (attempt + 1) : 3000 * (attempt + 1));
      await renewZohoSyncLease(ctx);
    }
  }
  throw lastError;
}

async function saveZohoRecordPage(ctx, moduleName, records) {
  const rows = records.map(record => {
    const summary = zohoRecordSummary(moduleName, record);
    return { ...summary, zoho_id: summary.id || '', owner_name: summary.owner || '', data: summary };
  });
  const leadModule = zohoModuleCreatesCrmLeads(moduleName);
  const [, leads] = await Promise.all([
    upsertZohoRecordRows(State.postgresPool, rows),
    leadModule ? upsertZohoLeadsFromRecords(State.postgresPool, ctx.user, moduleName, records) : Promise.resolve({ added: 0, updated: 0, failed: 0 })
  ]);
  State.dbCache = null;
  return leads;
}

async function persistZohoTokenIfChanged(ctx) {
  const zoho = ctx.dbLike.zoho || {};
  if ((zoho.access_token || '') === ctx.savedAccessToken) return;
  ctx.savedAccessToken = zoho.access_token || '';
  const latest = await loadZohoConnectionState();
  await saveZohoConnectionState(State.postgresPool, { ...latest, ...zohoNewerTokenFields(zoho, latest) });
}

function zohoNewerTokenFields(candidate = {}, current = {}) {
  if (!candidate.access_token || Number(candidate.expires_at || 0) <= Number(current.expires_at || 0)) return {};
  return { access_token: candidate.access_token, expires_at: candidate.expires_at, api_domain: candidate.api_domain || current.api_domain };
}

// One progress write per page: counters, this module's cursor and results, and the lease.
async function recordZohoModuleProgress(ctx, moduleName, cursor, results, delta, options = {}) {
  const result = await State.postgresPool.query(
    `update integration_jobs
     set current_module = $3,
         current_page = $4,
         next_page_token = $5,
         records_scanned = records_scanned + $6,
         records_added = records_added + $7,
         records_updated = records_updated + $8,
         records_failed = records_failed + $9,
         modules_completed = modules_completed + $10,
         state = jsonb_set(
           jsonb_set(
             jsonb_set(state, '{warnings}', coalesce(state->'warnings', '[]'::jsonb) || $13::jsonb, true),
             array['cursors', $3::text], $11::jsonb, true
           ),
           array['moduleResults', $3::text], $12::jsonb, true
         ),
         locked_until = now() + ($14 || ' milliseconds')::interval,
         last_progress_at = now(),
         updated_at = now()
     where id = $1 and locked_by = $2
     returning status`,
    [
      ctx.jobId,
      Config.ZOHO_WORKER_ID,
      moduleName,
      cursor.page,
      cursor.pageToken || null,
      Number(delta.scanned || 0),
      Number(delta.added || 0),
      Number(delta.updated || 0),
      Number(delta.failed || 0),
      options.moduleFinished ? 1 : 0,
      Applications.jsonValue(cursor),
      Applications.jsonValue(results),
      Applications.jsonValue(options.warning ? [options.warning] : []),
      String(Config.ZOHO_JOB_LEASE_MS)
    ]
  );
  if (result.rows[0]?.status !== 'running') ctx.stop = true;
}

// Pulls one module to the end. The next Zoho page is requested while the current one is
// being written, so Zoho latency and database latency overlap instead of adding up.
async function syncZohoModule(ctx, moduleName) {
  const cursor = ctx.state.cursors[moduleName];
  const results = { scanned: 0, added: 0, updated: 0, failed: 0, ...(ctx.state.moduleResults[moduleName] || {}) };
  const request = next => {
    const pending = fetchZohoPageWithRetry(ctx, moduleName, next);
    pending.catch(() => null);
    return pending;
  };
  let pending = request({ ...cursor });
  while (!ctx.stop) {
    let pageResult;
    try {
      pageResult = await pending;
    } catch (error) {
      if (!isZohoScopeError(error)) throw error;
      Object.assign(cursor, { done: true, skipped: true, pageToken: null });
      results.skipped = true;
      await recordZohoModuleProgress(ctx, moduleName, cursor, results, {}, { moduleFinished: true, warning: `${moduleName}: ${zohoSafeJobError(error)}` });
      return;
    }
    const records = (pageResult.records || []).slice(0, cursor.limit);
    const more = pageResult.moreRecords && records.length > 0;
    const next = { ...cursor, page: cursor.page + 1, pageToken: pageResult.info?.next_page_token || null };
    if (more && next.page > Config.ZOHO_SYNC_MAX_PAGES_PER_MODULE) throw Http.statusError(500, `Zoho pagination safety limit reached for ${moduleName}.`);
    if (more) pending = request(next);
    const saved = await saveZohoRecordPage(ctx, moduleName, records);
    results.scanned += records.length;
    results.added += saved.added;
    results.updated += saved.updated;
    results.failed += saved.failed;
    if (more) Object.assign(cursor, { page: next.page, pageToken: next.pageToken });
    else Object.assign(cursor, { done: true, pageToken: null });
    await persistZohoTokenIfChanged(ctx);
    await recordZohoModuleProgress(ctx, moduleName, cursor, results, { scanned: records.length, ...saved }, { moduleFinished: !more });
    if (!more) return;
  }
}

async function completeZohoSyncJob(ctx) {
  const current = await State.postgresPool.query(
    `select * from integration_jobs where id = $1 and locked_by = $2 and status = 'running'`,
    [ctx.jobId, Config.ZOHO_WORKER_ID]
  );
  const row = current.rows[0];
  if (!row) return;
  const state = zohoSyncState(row);
  // Save the sync marks before flipping the job to completed, so anything that sees a
  // completed job also sees the marks the next incremental run starts from.
  const mark = new Date(row.started_at || row.created_at || Date.now()).toISOString();
  const latest = await loadZohoConnectionState();
  const marks = { ...(latest.sync_marks || {}) };
  for (const moduleName of state.modules) {
    if (state.cursors[moduleName]?.done && !state.cursors[moduleName]?.skipped) marks[moduleName] = mark;
  }
  await saveZohoConnectionState(State.postgresPool, {
    ...latest,
    ...zohoNewerTokenFields(ctx.dbLike.zoho, latest),
    sync_marks: marks,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    connected: true,
    reauthorization_required: false
  });
  await insertZohoSyncAudit(State.postgresPool, `${state.mode} sync: ${Number(row.records_scanned || 0)} scanned, ${Number(row.records_added || 0)} created, ${Number(row.records_updated || 0)} updated`);
  await State.postgresPool.query(
    `update integration_jobs
     set status = 'completed', completed_at = now(), current_module = null, next_page_token = null,
         last_progress_at = now(), updated_at = now()
     where id = $1 and locked_by = $2 and status = 'running'`,
    [ctx.jobId, Config.ZOHO_WORKER_ID]
  );
}

async function runZohoSyncWorker(jobId = null) {
  await Storage.ensureStorage();
  if (!State.postgresPool) return;
  await Storage.ensureIntegrationJobsTable();
  const target = jobId || (await latestZohoSyncJob())?.id;
  if (!target || activeZohoSyncWorkers.has(target)) return;
  activeZohoSyncWorkers.add(target);
  let retryDelay = 0;
  try {
    const job = await claimZohoSyncJob(target);
    if (!job) {
      // Another process holds the lease. Check back after it would expire so the job
      // is taken over if that process has died.
      const current = await getZohoSyncJob(target);
      if (current && ['queued', 'running'].includes(current.status)) retryDelay = Config.ZOHO_JOB_LEASE_MS;
      return;
    }
    if (job.retry_after_at && new Date(job.retry_after_at).getTime() > Date.now()) {
      retryDelay = Math.max(1000, new Date(job.retry_after_at).getTime() - Date.now());
      return;
    }
    const state = zohoSyncState(job);
    await State.postgresPool.query(
      `update integration_jobs
       set status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1,
           last_error = null, retry_after_at = null, state = $3::jsonb, updated_at = now()
       where id = $1 and locked_by = $2`,
      [target, Config.ZOHO_WORKER_ID, Applications.jsonValue(state)]
    );
    const zoho = await loadZohoConnectionState();
    const ctx = {
      jobId: target,
      state,
      stop: false,
      user: { id: job.created_by || 'system', name: 'Zoho Sync' },
      dbLike: { zoho },
      savedAccessToken: zoho.access_token || ''
    };
    const queue = state.modules.filter(moduleName => !state.cursors[moduleName]?.done);
    let failure = null;
    const runners = Array.from({ length: Math.min(Config.ZOHO_SYNC_MODULE_CONCURRENCY, queue.length) }, async () => {
      while (!ctx.stop && queue.length) {
        const moduleName = queue.shift();
        try {
          await syncZohoModule(ctx, moduleName);
        } catch (error) {
          if (!ctx.stop) failure ||= error;
          ctx.stop = true;
        }
      }
    });
    await Promise.all(runners);
    if (failure) throw failure;
    if (ctx.stop) return;
    await completeZohoSyncJob(ctx);
  } catch (error) {
    const status = Number(error.status || 0);
    const safeMessage = zohoSafeJobError(error);
    try {
      if ([429, 502, 503, 504].includes(status) || isTransientNetworkError(error)) {
        retryDelay = status === 429 ? 60 * 1000 : 15 * 1000;
        await State.postgresPool.query(
          `update integration_jobs
           set status = 'queued', retry_after_at = now() + ($2 || ' milliseconds')::interval,
               last_error = $3, updated_at = now()
           where id = $1 and provider = 'zoho'`,
          [target, String(retryDelay), safeMessage]
        );
      } else if (/oauth|token|reauthorization|refresh/i.test(safeMessage)) {
        await State.postgresPool.query(`update integration_jobs set status = 'failed', last_error = $2, completed_at = now(), updated_at = now() where id = $1 and provider = 'zoho'`, [target, zohoReconnectRequiredMessage()]);
      } else {
        await State.postgresPool.query(`update integration_jobs set status = 'failed', last_error = $2, completed_at = now(), updated_at = now() where id = $1 and provider = 'zoho'`, [target, safeMessage]);
      }
    } catch (updateError) {
      // The database itself was unreachable; the job keeps its saved cursors, so try again.
      console.error(`Zoho sync status update failed: ${zohoSafeJobError(updateError)}`);
      retryDelay = 30 * 1000;
    }
  } finally {
    await releaseZohoSyncJob(target);
    activeZohoSyncWorkers.delete(target);
  }
  if (retryDelay) scheduleZohoSyncWorker(target, retryDelay);
}

async function resumeZohoSyncJobs() {
  await Storage.ensureStorage();
  if (!State.postgresPool) return;
  await Storage.ensureIntegrationJobsTable();
  const active = await State.postgresPool.query(
    `select id from integration_jobs
     where provider = 'zoho'
       and type = 'crm_sync'
       and status in ('queued', 'running')
     order by updated_at desc
     limit $1`,
    [Config.ZOHO_SYNC_CONCURRENCY]
  );
  for (const row of active.rows) scheduleZohoSyncWorker(row.id, 1000);
}

// After the first full import, keep app_zoho_records current with small incremental runs.
function scheduleZohoAutoSync(delayMs = Config.ZOHO_AUTO_SYNC_INTERVAL_MS) {
  if (!Config.ZOHO_AUTO_SYNC_ENABLED || !Storage.usesPostgresStorage()) return;
  const timer = setTimeout(async () => {
    try {
      await startZohoAutoSync();
    } catch (error) {
      console.error(`Zoho auto sync skipped: ${zohoSafeJobError(error)}`);
    }
    scheduleZohoAutoSync();
  }, delayMs);
  if (timer.unref) timer.unref();
}

async function startZohoAutoSync() {
  await Storage.ensureStorage();
  if (!State.postgresPool) return;
  const zoho = await loadZohoConnectionState();
  // Only incremental runs are automatic; the first full import is started from the UI.
  if (!Object.keys(zoho.sync_marks || {}).length) return;
  await createOrResumeZohoSyncJob({ headers: {}, socket: {} }, { id: 'system', name: 'Zoho Auto Sync' }, { mode: 'incremental' });
}

async function cancelZohoSyncJob(jobId) {
  await Storage.ensureStorage();
  if (!State.postgresPool) throw Http.statusError(500, 'Zoho background sync requires PostgreSQL storage.');
  await Storage.ensureIntegrationJobsTable();
  const result = await State.postgresPool.query(
    `update integration_jobs
     set status = 'cancelled', completed_at = now(), last_error = $2, updated_at = now()
     where id = $1
       and provider = 'zoho'
       and status in ('queued', 'running')
     returning *`,
    [jobId, 'Cancelled by user.']
  );
  return result.rows[0] || await getZohoSyncJob(jobId);
}

exports.ensureZohoRecordsTable = ensureZohoRecordsTable;
exports.zohoAccessTokenValid = zohoAccessTokenValid;
exports.zohoTokenUsable = zohoTokenUsable;
exports.zohoReconnectRequiredMessage = zohoReconnectRequiredMessage;
exports.zohoConnectionDiagnostics = zohoConnectionDiagnostics;
exports.mergeZohoState = mergeZohoState;
exports.zohoRecordRows = zohoRecordRows;
exports.upsertZohoRecordRows = upsertZohoRecordRows;
exports.zohoRedirectUri = zohoRedirectUri;
exports.zohoAccountsUrl = zohoAccountsUrl;
exports.zohoAuthAccountsUrl = zohoAuthAccountsUrl;
exports.zohoApiBaseUrl = zohoApiBaseUrl;
exports.zohoScopes = zohoScopes;
exports.zohoConfigIssues = zohoConfigIssues;
exports.zohoSafeStatus = zohoSafeStatus;
exports.zohoConfigured = zohoConfigured;
exports.zohoAuthUrl = zohoAuthUrl;
exports.exchangeZohoCode = exchangeZohoCode;
exports.loadZohoRecordPage = loadZohoRecordPage;
exports.loadZohoRecordsPreviewDb = loadZohoRecordsPreviewDb;
exports.zohoRecordsPayloadDb = zohoRecordsPayloadDb;
exports.loadZohoWorkspaceState = loadZohoWorkspaceState;
exports.zohoSyncJobPayload = zohoSyncJobPayload;
exports.zohoSafeJobError = zohoSafeJobError;
exports.latestZohoSyncJob = latestZohoSyncJob;
exports.getZohoSyncJob = getZohoSyncJob;
exports.createOrResumeZohoSyncJob = createOrResumeZohoSyncJob;
exports.scheduleZohoSyncWorker = scheduleZohoSyncWorker;
exports.runZohoSyncWorker = runZohoSyncWorker;
exports.resumeZohoSyncJobs = resumeZohoSyncJobs;
exports.scheduleZohoAutoSync = scheduleZohoAutoSync;
exports.cancelZohoSyncJob = cancelZohoSyncJob;
