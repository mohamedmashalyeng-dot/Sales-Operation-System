'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const zlib = require('node:zlib');
const { monitorEventLoopDelay, performance: perfHooksPerformance } = require('node:perf_hooks');
const XLSX = require('xlsx');

const ROOT = __dirname;

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'pathway-db.json');
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.MONGODB_URI || process.env.MONGO_URI || '';
const DATABASE_NAME = process.env.DATABASE_NAME || process.env.MONGODB_DB || 'pathway';
const MONGO_STATE_COLLECTION = process.env.MONGO_STATE_COLLECTION || 'app_state';
const POSTGRES_STATE_TABLE = process.env.POSTGRES_STATE_TABLE || 'app_state';
const POSTGRES_USERS_TABLE = process.env.POSTGRES_USERS_TABLE || 'app_users';
const POSTGRES_LOGIN_EVENTS_TABLE = process.env.POSTGRES_LOGIN_EVENTS_TABLE || 'app_login_events';
const POSTGRES_PASSWORD_RESETS_TABLE = process.env.POSTGRES_PASSWORD_RESETS_TABLE || 'app_password_resets';
const POSTGRES_SESSIONS_TABLE = process.env.POSTGRES_SESSIONS_TABLE || 'app_sessions';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_AUTH_CACHE_MS = Math.max(0, Math.min(Number(process.env.SESSION_AUTH_CACHE_MS || 60000), 120000));
const LEAD_SOFT_DELETE_CONFIG = String(process.env.LEAD_SOFT_DELETE_ENABLED || '').trim().toLowerCase();
const memorySessions = new Map();
const postgresSessionUserLookups = new Map();
const postgresSessionUserCache = new Map();
let sessionAuthCacheEpoch = 0;
let mongoClient = null;
let mongoStateCollection = null;
let postgresPool = null;
let postgresPoolWarmup = null;
let postgresUserSchemaReady = false;
let postgresSchemaReady = false;
let storageReady = null;
let dbCache = null;
// When the cache was last filled from storage. Other processes (background workers,
// a second server sharing the same DATABASE_URL) write straight to the tables, so the
// cache must expire or those rows never become visible here.
let dbCacheLoadedAt = 0;
// Row ids present in the last full Postgres load, per table. Saves only delete rows
// that were loaded and then removed, never rows another writer inserted meanwhile.
const postgresLoadedIds = new Map();
let identityCleanupRunning = false;
const DB_CACHE_TTL_MS = Math.max(0, Math.min(Number(process.env.DB_CACHE_TTL_MS ?? 5 * 60 * 1000), 30 * 60 * 1000));

const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const DEFAULT_ZOHO_MODULES = ['Leads', 'Contacts', 'Accounts', 'Deals', 'Tasks', 'Calls', 'Events', 'Campaigns', 'Notes'];
const DEFAULT_ZOHO_SCOPES = [
  'ZohoCRM.modules.leads.READ',
  'ZohoCRM.modules.contacts.READ',
  'ZohoCRM.modules.accounts.READ',
  'ZohoCRM.modules.deals.READ',
  'ZohoCRM.modules.tasks.READ',
  'ZohoCRM.modules.calls.READ',
  'ZohoCRM.modules.events.READ',
  'ZohoCRM.modules.campaigns.READ',
  'ZohoCRM.modules.notes.READ',
  'ZohoCRM.users.READ'
];
const EMAIL_RESPONSE_SLA_MS = 48 * 60 * 60 * 1000;
const EMAIL_LIST_STATEMENT_TIMEOUT_MS = Math.max(1000, Math.min(Number(process.env.EMAIL_LIST_STATEMENT_TIMEOUT_MS || 5000), 30000));
const DEFAULT_DEVELOPER_EMAIL = 'mohamedmashalyeng@gmail.com';
const LEGACY_DEVELOPER_EMAILS = ['alteam.kbc@gmail.com'];
const AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS = String(process.env.AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS ?? process.env.AUTO_CREATE_APPLICATIONS_FOR_LEADS ?? 'true').toLowerCase() !== 'false';
const ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED = AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS && String(process.env.ENROLLED_LEAD_APPLICATION_BACKFILL ?? process.env.LEAD_APPLICATION_BACKFILL ?? 'true').toLowerCase() !== 'false';
const ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT = Math.max(1, Math.min(Number(process.env.ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT || process.env.LEAD_APPLICATION_BACKFILL_LIMIT || 10000), 50000));
const BACKGROUND_JOBS_ENABLED = String(process.env.BACKGROUND_JOBS_ENABLED || 'false').toLowerCase() === 'true';
const GMAIL_IMPORT_ENABLED = String(process.env.GMAIL_IMPORT || 'true').toLowerCase() !== 'false';
const GMAIL_INCREMENTAL_ONLY = String(process.env.GMAIL_INCREMENTAL_ONLY || 'false').toLowerCase() === 'true';
const GMAIL_AUTO_SYNC_ENABLED = BACKGROUND_JOBS_ENABLED && String(process.env.GMAIL_AUTO_SYNC || 'true').toLowerCase() !== 'false';
const GMAIL_AUTO_SYNC_MODE = ['daily', 'interval'].includes(String(process.env.GMAIL_AUTO_SYNC_MODE || 'daily').toLowerCase())
  ? String(process.env.GMAIL_AUTO_SYNC_MODE || 'daily').toLowerCase()
  : 'daily';
const GMAIL_AUTO_SYNC_DAILY_TIME = process.env.GMAIL_AUTO_SYNC_DAILY_TIME || '18:00';
const GMAIL_AUTO_SYNC_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.GMAIL_AUTO_SYNC_BATCH_SIZE || 25), 25));
const GMAIL_AUTO_SYNC_ACTIVE_MS = Math.max(1000, Number(process.env.GMAIL_AUTO_SYNC_ACTIVE_MS || 90000));
const GMAIL_AUTO_SYNC_IDLE_MS = Math.max(1000, Number(process.env.GMAIL_AUTO_SYNC_IDLE_MS || 5 * 60 * 1000));
const GMAIL_AUTO_SYNC_DAILY_BATCHES = Math.max(1, Math.min(Number(process.env.GMAIL_AUTO_SYNC_DAILY_BATCHES || 20), 100));
const GMAIL_TRASH_SYNC_LIMIT = Math.max(0, Math.min(Number(process.env.GMAIL_TRASH_SYNC_LIMIT || 100), 500));
const GMAIL_TRASH_SYNC_INTERVAL_MS = Math.max(5000, Number(process.env.GMAIL_TRASH_SYNC_INTERVAL_MS || 60 * 1000));
const EVENT_AUTO_SYNC_ENABLED = BACKGROUND_JOBS_ENABLED && String(process.env.EVENT_AUTO_SYNC || 'true').toLowerCase() !== 'false';
const EVENTS_INCREMENTAL_ONLY = String(process.env.EVENTS_INCREMENTAL_ONLY || 'false').toLowerCase() === 'true';
const EVENT_AUTO_SYNC_INTERVAL_MS = Math.max(2 * 60 * 1000, Number(process.env.EVENT_AUTO_SYNC_INTERVAL_MS || 10 * 60 * 1000));
const EVENT_AUTO_SYNC_MAX_EVENTS = Math.max(1, Math.min(Number(process.env.EVENT_AUTO_SYNC_MAX_EVENTS || 10), 50));
const EVENTBRITE_DELETE_SCAN_PAGES = Math.max(1, Math.min(Number(process.env.EVENTBRITE_DELETE_SCAN_PAGES || 10), 50));
const EVENTS_SHEET_URL = process.env.EVENTS_SHEET_URL || '';
const ZOOM_AUTO_SYNC_ENABLED = BACKGROUND_JOBS_ENABLED && String(process.env.ZOOM_AUTO_SYNC || 'true').toLowerCase() !== 'false';
const ZOOM_AUTO_SYNC_MEETINGS = String(process.env.ZOOM_AUTO_SYNC_MEETINGS || 'true').toLowerCase() !== 'false';
const ZOOM_AUTO_SYNC_CALLS = String(process.env.ZOOM_AUTO_SYNC_CALLS || 'true').toLowerCase() !== 'false';
const ZOOM_AUTO_SYNC_INTERVAL_MS = Math.max(2 * 60 * 1000, Number(process.env.ZOOM_AUTO_SYNC_INTERVAL_MS || 10 * 60 * 1000));
const ZOOM_AUTO_SYNC_MAX_MEETINGS = Math.max(1, Math.min(Number(process.env.ZOOM_AUTO_SYNC_MAX_MEETINGS || process.env.ZOOM_MAX_MEETINGS || 500), 5000));
const ZOOM_AUTO_SYNC_MAX_CALLS = Math.max(1, Math.min(Number(process.env.ZOOM_AUTO_SYNC_MAX_CALLS || 250), 1000));
const ZOOM_REQUEST_DELAY_MS = Math.max(0, Number(process.env.ZOOM_REQUEST_DELAY_MS || 350));
const ZOHO_SYNC_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.ZOHO_SYNC_BATCH_SIZE || 200), 200));
const ZOHO_SYNC_CONCURRENCY = Math.max(1, Math.min(Number(process.env.ZOHO_SYNC_CONCURRENCY || 2), 3));
const ZOHO_SYNC_POLL_INTERVAL_MS = Math.max(1000, Math.min(Number(process.env.ZOHO_SYNC_POLL_INTERVAL_MS || 2500), 10000));
const ZOHO_SYNC_WORKER_YIELD_MS = Math.max(50, Math.min(Number(process.env.ZOHO_SYNC_WORKER_YIELD_MS || 150), 10000));
const ZOHO_SYNC_MAX_PAGES_PER_MODULE = Math.max(1, Math.min(Number(process.env.ZOHO_SYNC_MAX_PAGES_PER_MODULE || 1000), 10000));
const ZOHO_SYNC_MODULE_CONCURRENCY = Math.max(1, Math.min(Number(process.env.ZOHO_SYNC_MODULE_CONCURRENCY || 3), 5));
const ZOHO_FETCH_ATTEMPTS = 5;
const ZOHO_JOB_LEASE_MS = 3 * 60 * 1000;
const ZOHO_WORKER_ID = `${require('os').hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const ZOHO_RECORDS_PREVIEW_LIMIT = Math.max(1, Math.min(Number(process.env.ZOHO_RECORDS_PREVIEW_LIMIT || 100), 500));
const ZOHO_RECORDS_PREVIEW_TIMEOUT_MS = Math.max(1000, Math.min(Number(process.env.ZOHO_RECORDS_PREVIEW_TIMEOUT_MS || 3000), 15000));
// ZOHO_SYNC_WORKER=false keeps this process from pulling Zoho jobs (for example a local
// server sharing the production database); jobs are still created and read normally.
const ZOHO_SYNC_WORKER_ENABLED = String(process.env.ZOHO_SYNC_WORKER || 'true').toLowerCase() !== 'false';
const ZOHO_AUTO_SYNC_ENABLED = BACKGROUND_JOBS_ENABLED && ZOHO_SYNC_WORKER_ENABLED && String(process.env.ZOHO_AUTO_SYNC || 'true').toLowerCase() !== 'false';
const ZOHO_AUTO_SYNC_INTERVAL_MS = Math.max(5 * 60 * 1000, Math.min(Number(process.env.ZOHO_AUTO_SYNC_INTERVAL_MS || 15 * 60 * 1000), 24 * 60 * 60 * 1000));
// Incremental runs re-read a small overlap before the last mark so edits made while that
// sync was running are not missed.
const ZOHO_INCREMENTAL_OVERLAP_MS = 10 * 60 * 1000;
const PROGRAMME_CATALOG = [
  { id: 'pr-cim-l4', name: 'CIM Certificate in Professional and Digital Marketing', level: 'Level 4' },
  { id: 'pr-cim-l6', name: 'CIM Diploma in Professional and Digital Marketing', level: 'Level 6' },
  { id: 'pr-marketing-exec-l4', name: 'Marketing Executive', level: 'Level 4' },
  { id: 'pr-marketing-manager-l6', name: 'Marketing Manager', level: 'Level 6' },
  { id: 'pr-pmp-ai', name: 'Project Management Professional (PMP)', level: 'Professional' },
  { id: 'pr-project-control-l6', name: 'Project Control Professional', level: 'Level 6' },
  { id: 'pr-apm-chpp', name: 'APM Chartered Project Professional (ChPP)', level: 'Professional' },
  { id: 'pr-pmo-apm', name: 'PMO with APM Chartered Project Professional', level: 'Professional' },
  { id: 'pr-strategic-sales-dm', name: 'Strategic Sales & Digital Marketing', level: 'Certificate' },
  { id: 'pr-skills-bootcamp', name: 'D2N2 Skills Bootcamp', level: 'Funded programme' },
  { id: 'pr-ipc-masterclass', name: 'IPC London Masterclass', level: 'Masterclass' },
  { id: 'pr-business-networking', name: 'Business Professional Networking', level: 'Event' },
  { id: 'pr-funded-recruitment', name: 'Funded Recruitment & Upskilling', level: 'Employer event' },
  { id: 'pr-unknown', name: 'Programme not identified', level: 'Needs review' }
];
let gmailAutoSyncTimer = null;
let gmailAutoSyncRunning = false;
let gmailAutoSyncState = { enabled: GMAIL_AUTO_SYNC_ENABLED, mode: GMAIL_AUTO_SYNC_MODE, daily_time: GMAIL_AUTO_SYNC_DAILY_TIME, running: false, last_result: null, last_error: null, next_run_at: null };
let eventAutoSyncTimer = null;
let eventAutoSyncRunning = false;
let eventAutoSyncState = { enabled: EVENT_AUTO_SYNC_ENABLED, running: false, last_result: null, last_error: null, next_run_at: null };
let zoomAutoSyncTimer = null;
let zoomAutoSyncRunning = false;
let zoomAutoSyncState = { enabled: ZOOM_AUTO_SYNC_ENABLED, meetings: ZOOM_AUTO_SYNC_MEETINGS, calls: ZOOM_AUTO_SYNC_CALLS, running: false, last_result: null, last_error: null, next_run_at: null };
const activeZohoSyncWorkers = new Set();
const serverStartedAt = new Date();
const API_TIMING_WARN_MS = Math.max(100, Number(process.env.API_TIMING_WARN_MS || 1000));
const API_PERF_TRACE_ENABLED = String(process.env.API_PERF_TRACE || '').toLowerCase() === 'true';
const API_DEBUG_ENDPOINTS_ENABLED = String(process.env.API_DEBUG_ENDPOINTS || '').toLowerCase() === 'true' || process.env.NODE_ENV !== 'production';
const POSTGRES_POOL_MAX = Math.max(1, Math.min(Number(process.env.POSTGRES_POOL_MAX || 10), 50));
const POSTGRES_POOL_WARM_CONNECTIONS = Math.max(0, Math.min(Number(process.env.POSTGRES_POOL_WARM_CONNECTIONS || 2), POSTGRES_POOL_MAX));
const POSTGRES_POOL_IDLE_TIMEOUT_MS = Math.max(30000, Math.min(Number(process.env.POSTGRES_POOL_IDLE_TIMEOUT_MS || 10 * 60 * 1000), 60 * 60 * 1000));
const POSTGRES_POOL_CONNECTION_TIMEOUT_MS = Math.max(1000, Math.min(Number(process.env.POSTGRES_POOL_CONNECTION_TIMEOUT_MS || 10000), 60000));
const MONITORING_STATEMENT_TIMEOUT_MS = Math.max(1000, Math.min(Number(process.env.MONITORING_STATEMENT_TIMEOUT_MS || 5000), 30000));
const MONITORING_SNAPSHOT_TTL_MS = Math.max(5000, Math.min(Number(process.env.MONITORING_SNAPSHOT_TTL_MS || 120000), 5 * 60 * 1000));
const MONITORING_SNAPSHOT_ENABLED = String(process.env.MONITORING_SNAPSHOT_ENABLED || 'true').toLowerCase() !== 'false';
const MONITORING_SNAPSHOT_PROACTIVE_ENABLED = BACKGROUND_JOBS_ENABLED && String(process.env.MONITORING_SNAPSHOT_PROACTIVE_ENABLED || 'true').toLowerCase() !== 'false';
const MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS = Math.max(30000, Math.min(Number(process.env.MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS || 60000), 5 * 60 * 1000));
const MONITORING_SNAPSHOT_REFRESH_LOCK_MS = Math.max(30000, Math.min(Number(process.env.MONITORING_SNAPSHOT_REFRESH_LOCK_MS || 2 * 60 * 1000), 10 * 60 * 1000));
const MONITORING_SNAPSHOT_MEMORY_CACHE_MS = Math.max(0, Math.min(Number(process.env.MONITORING_SNAPSHOT_MEMORY_CACHE_MS || 1000), 5000));
const monitoringState = { last_save_at: null, api_errors: [], api_timings: [] };
let monitoringSnapshotTimer = null;
const activeMonitoringSnapshotRefreshKeys = new Set();
const monitoringSnapshotMemoryCache = new Map();
const monitoringSnapshotReadPromises = new Map();
const externalFetchCounters = { gmail: 0, google: 0, zoho: 0, zoom: 0, eventbrite: 0, meta: 0, apollo: 0 };
const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelayMonitor.enable();
let eventLoopUtilizationBaseline = perfHooksPerformance.eventLoopUtilization
  ? perfHooksPerformance.eventLoopUtilization()
  : null;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, expected] = String(stored || '').split(':');
    if (!salt || !expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
    const actual = hashPassword(password, salt).split(':')[1];
    const actualBuffer = Buffer.from(actual, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function loadEnv() {
  const envFile = ['.env', '.env.hostinger', 'hostinger.env', 'env.hostinger']
    .map(name => path.join(ROOT, name))
    .find(file => fs.existsSync(file));
  if (!envFile) return;
  const fileWins = new Set([
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'INITIAL_ADMIN_NAME',
    'INITIAL_ADMIN_ROLE',
    'DEV_PANEL_EMAIL',
    'DEV_PANEL_PASSWORD',
    'DEV_PANEL_NAME',
    'DEV_PANEL_ROLE',
    'DEV_PANEL_FORCE_PASSWORD',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REDIRECT_URI',
    'EVENTBRITE_CLIENT_ID',
    'EVENTBRITE_CLIENT_SECRET',
    'EVENTBRITE_REDIRECT_URI',
    'EVENTBRITE_PRIVATE_TOKEN',
    'ZOHO_CLIENT_ID',
    'ZOHO_CLIENT_SECRET',
    'ZOHO_REDIRECT_URI',
    'ZOHO_AUTH_ACCOUNTS_URL',
    'ZOHO_ACCOUNTS_URL',
    'ZOHO_API_BASE_URL',
    'ZOHO_SCOPES',
    'INITIAL_ADMIN_EMAIL',
    'INITIAL_ADMIN_PASSWORD',
    'INITIAL_ADMIN_NAME',
    'INITIAL_ADMIN_ROLE',
    'DEV_PANEL_EMAIL',
    'DEV_PANEL_PASSWORD',
    'DEV_PANEL_NAME',
    'DEV_PANEL_ROLE',
    'DEV_PANEL_FORCE_PASSWORD'
  ]);
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
    if (fileWins.has(key) || !process.env[key]) process.env[key] = value;
  }
}

// The seeded admin is hashed once per process: pbkdf2 (120,000 rounds) is synchronous and used
// to block the event loop for ~60 ms on every recalculate()/seedDatabase() call.
let initialUsersCache = null;
function initialUsers() {
  initialUsersCache ||= [{
    id: 'local-user',
    name: process.env.INITIAL_ADMIN_NAME || 'Kent Alteam',
    email: process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com',
    role: process.env.INITIAL_ADMIN_ROLE || 'admin',
    password_hash: hashPassword(initialAdminPassword())
  }];
  return initialUsersCache.map(user => ({ ...user }));
}

// Older versions seeded the admin with this password when INITIAL_ADMIN_PASSWORD was missing.
// It is public, so it is never accepted at sign-in, whatever account still carries it.
const LEGACY_DEFAULT_ADMIN_PASSWORD = 'ChangeMeNow!2026';

// Without INITIAL_ADMIN_PASSWORD the seeded admin gets a random password that nobody knows.
function initialAdminPassword() {
  const configured = String(process.env.INITIAL_ADMIN_PASSWORD || '');
  if (configured) return configured;
  console.warn('INITIAL_ADMIN_PASSWORD is not set. The seeded admin account gets a random password; set INITIAL_ADMIN_PASSWORD or DEV_PANEL_PASSWORD to sign in.');
  return crypto.randomBytes(24).toString('base64url');
}

function developerBootstrapConfig() {
  const email = configuredDeveloperEmail();
  const password = String(process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '');
  return {
    email,
    password,
    name: process.env.DEV_PANEL_NAME || process.env.INITIAL_ADMIN_NAME || 'Developer',
    role: process.env.DEV_PANEL_ROLE || process.env.INITIAL_ADMIN_ROLE || 'admin'
  };
}

function developerPasswordConfigured() {
  return Boolean(String(process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '').trim());
}

function configuredDeveloperPassword() {
  return String(process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '');
}

function ensureConfiguredDeveloperUser(db) {
  const config = developerBootstrapConfig();
  if (!config.email || !config.password) return false;
  db.users ||= [];
  let changed = false;
  let user = db.users.find(item => normalizeEmail(item.email) === config.email);
  if (!user) {
    user = {
      id: nextId('U', [db.users]),
      name: config.name,
      email: config.email,
      role: normalizeWorkspaceRole(config.role) || 'admin',
      password_hash: hashPassword(config.password),
      invited_at: new Date().toISOString(),
      password_changed_at: null
    };
    db.users.push(user);
    return true;
  }
  if (canonicalWorkspaceRole(user.role) !== 'admin') {
    user.role = 'admin';
    changed = true;
  }
  if (config.name && user.name !== config.name) {
    user.name = config.name;
    changed = true;
  }
  if (String(process.env.DEV_PANEL_FORCE_PASSWORD || 'true').toLowerCase() !== 'false') {
    user.password_hash = hashPassword(config.password);
    user.password_changed_at = null;
    changed = true;
  }
  return changed;
}

function isLegacyDeveloperEmail(email) {
  const normalized = normalizeEmail(email);
  return LEGACY_DEVELOPER_EMAILS.includes(normalized);
}

function removeLegacyDeveloperUsers(db) {
  db.users ||= [];
  const before = db.users.length;
  db.users = db.users.filter(user => !isLegacyDeveloperEmail(user.email));
  return db.users.length !== before;
}

async function removeLegacyPostgresDeveloperUsers() {
  if (!postgresPool || !LEGACY_DEVELOPER_EMAILS.length) return false;
  const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const emails = LEGACY_DEVELOPER_EMAILS
    .map(normalizeEmail)
    .filter(Boolean);
  if (!emails.length) return false;
  const result = await postgresPool.query(`delete from ${table} where lower(email) = any($1::text[])`, [emails]);
  if (result.rowCount) dbCache = null;
  return Boolean(result.rowCount);
}

async function persistDeveloperBootstrap(data) {
  if (postgresPool) {
    await upsertPostgresUsers(data.users || []);
    return;
  }
  await saveDb(data);
}

function temporaryPassword() {
  return crypto.randomBytes(9).toString('base64url') + '#KBC1';
}

const DEFAULT_STAGES = ['New lead', 'Qualified', 'Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Enrolled', 'Not Eligible', 'Lost'];
const DEFAULT_SOURCES = ['Website', 'Referral', 'Event', 'Meta', 'LinkedIn', 'Cold outreach'];
const GMAIL_ENROLMENT_LABELS = new Set(['apprenticeship intersted', 'apprenticeship interested']);
const GMAIL_ENROLMENT_LABEL_PREFIXES = ['apprenticeship interests'];

function seedDatabase() {
  const users = initialUsers();
  return recalculate({
    demo: false,
    users,
    programmes: PROGRAMME_CATALOG.map(item => ({ ...item })),
    stages: DEFAULT_STAGES.slice(),
    sources: DEFAULT_SOURCES.slice(),
    leads: [],
    tasks: [],
    emails: [],
    applications: [],
    events: [],
    integrations: [
      { name: 'Gmail', status: 'Not connected', detail: 'Connect Gmail after the backend mailbox adapter is configured.' },
      { name: 'Eventbrite', status: 'Not connected', detail: 'Event data is stored locally until provider sync is enabled.' }
    ],
    intakes: [
      { id: 'I-1', programme_id: 'p1', name: 'January 2027' },
      { id: 'I-2', programme_id: 'p2', name: 'February 2027' }
    ],
    audit: [],
    attribution: []
  });
}

function usesMongoStorage() {
  return /^mongodb(\+srv)?:\/\//i.test(DATABASE_URL);
}

function usesPostgresStorage() {
  return /^postgres(ql)?:\/\//i.test(DATABASE_URL);
}

function storageMode() {
  if (usesPostgresStorage()) return 'postgres';
  return usesMongoStorage() ? 'mongodb' : 'json-file';
}

function databaseSafeMetadata() {
  const meta = {
    storage: storageMode(),
    ssl_configured: false,
    pooled_endpoint: false,
    pool_max: null,
    idle_timeout_ms: null,
    connection_timeout_ms: null,
    host_kind: '',
    host_region_hint: ''
  };
  if (!DATABASE_URL || !usesPostgresStorage()) return meta;
  try {
    const parsed = new URL(DATABASE_URL);
    const host = parsed.hostname;
    meta.host_kind = /neon\.tech$/i.test(host) ? 'neon' : host ? 'other' : '';
    meta.ssl_configured = DATABASE_URL.includes('sslmode=require') || parsed.searchParams.get('sslmode') === 'require';
    meta.pooled_endpoint = /pooler|pool|pooled/i.test(host);
    const region = host.match(/\b([a-z]+-[a-z]+-\d)\b/i);
    meta.host_region_hint = region ? region[1] : '';
  } catch {}
  meta.pool_max = postgresPool?.options?.max || 10;
  meta.idle_timeout_ms = postgresPool?.options?.idleTimeoutMillis || POSTGRES_POOL_IDLE_TIMEOUT_MS;
  meta.connection_timeout_ms = postgresPool?.options?.connectionTimeoutMillis || POSTGRES_POOL_CONNECTION_TIMEOUT_MS;
  return meta;
}

function postgresPoolStats() {
  if (!postgresPool) return { max: POSTGRES_POOL_MAX, totalCount: 0, idleCount: 0, waitingCount: 0 };
  return {
    max: postgresPool.options?.max || POSTGRES_POOL_MAX,
    totalCount: postgresPool.totalCount,
    idleCount: postgresPool.idleCount,
    waitingCount: postgresPool.waitingCount
  };
}

function warmPostgresPool(target = POSTGRES_POOL_WARM_CONNECTIONS) {
  if (!postgresPool || target <= 0) return Promise.resolve();
  if (postgresPoolWarmup) return postgresPoolWarmup;
  postgresPoolWarmup = (async () => {
    const clients = [];
    try {
      await Promise.all(Array.from({ length: target }, async () => {
        const client = await postgresPool.connect();
        clients.push(client);
        await client.query('select 1');
      }));
    } catch (error) {
      console.warn(`Postgres pool warm-up skipped: ${error.message || error}`);
    } finally {
      while (clients.length) clients.pop().release();
      postgresPoolWarmup = null;
    }
  })();
  return postgresPoolWarmup;
}

function sqlIdentifier(value, fallback) {
  const identifier = String(value || fallback);
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw statusError(500, `Invalid SQL identifier: ${identifier}`);
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function connectMongoStorage() {
  if (mongoStateCollection) return mongoStateCollection;
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch {
    throw statusError(500, 'DATABASE_URL is set for MongoDB, but the mongodb package is not installed. Run npm install and restart the backend.');
  }
  mongoClient = new MongoClient(DATABASE_URL);
  await mongoClient.connect();
  mongoStateCollection = mongoClient.db(DATABASE_NAME).collection(MONGO_STATE_COLLECTION);
  return mongoStateCollection;
}

async function getPostgresPool() {
  if (postgresPool) return postgresPool;
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    throw statusError(500, 'DATABASE_URL is set for PostgreSQL/Neon, but the pg package is not installed. Run npm install and restart the backend.');
  }
  postgresPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    max: POSTGRES_POOL_MAX,
    idleTimeoutMillis: POSTGRES_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30000
  });
  wrapPostgresPoolQuery(postgresPool);
  postgresPool.on('error', error => {
    console.error(`Postgres idle connection error: ${error.message || error}`);
  });
  postgresPool.on('connect', client => {
    client.on('error', error => {
      console.error(`Postgres client connection error: ${error.message || error}`);
    });
  });
  warmPostgresPool().catch(() => null);
  return postgresPool;
}

function postgresConnectionLost(error) {
  const code = String(error?.code || '');
  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', '57P01', '08000', '08003', '08006'].includes(code)) return true;
  return /Connection terminated unexpectedly|ECONNRESET|Connection ended unexpectedly|Client has encountered a connection error|read ECONNRESET|socket hang up|connection timeout/i.test(String(error?.message || error || ''));
}

function wrapPostgresPoolQuery(pool) {
  if (!pool || pool.__kbcQueryWrapped) return pool;
  const rawQuery = pool.query.bind(pool);
  pool.__kbcQueryWrapped = true;
  pool.query = async function queryWithReconnect(sql, params, callback) {
    if (typeof params === 'function' || typeof callback === 'function') return rawQuery(sql, params, callback);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await rawQuery(sql, params);
      } catch (error) {
        lastError = error;
        if (!postgresConnectionLost(error) || attempt > 0 || pool !== postgresPool) throw error;
        console.error(`Postgres pool query connection lost; reconnecting: ${error.message || error}`);
        await resetPostgresPool();
        await getPostgresPool();
        return postgresPool.query(sql, params);
      }
    }
    throw lastError;
  };
  return pool;
}

async function resetPostgresPool() {
  const pool = postgresPool;
  postgresPool = null;
  postgresPoolWarmup = null;
  postgresSchemaReady = false;
  postgresUserSchemaReady = false;
  if (pool) {
    try {
      await pool.end();
    } catch {}
  }
}

async function postgresQuery(sql, params = [], attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await getPostgresPool();
    try {
      return await postgresPool.query(sql, params);
    } catch (error) {
      lastError = error;
      if (!postgresConnectionLost(error) || attempt >= attempts - 1) throw error;
      console.error(`Postgres query connection lost; reconnecting: ${error.message || error}`);
      await resetPostgresPool();
    }
  }
  throw lastError;
}

async function connectPostgresStorage(trace = null) {
  await getPostgresPool();
  if (String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') {
    await refreshLeadSoftDelete(trace, { force: true });
    postgresSchemaReady = true;
    postgresUserSchemaReady = true;
    return postgresPool;
  }
  await ensurePostgresUserSchema(trace);
  if (postgresSchemaReady) {
    postgresSchemaReady = true;
    return postgresPool;
  }
  const table = sqlIdentifier(POSTGRES_STATE_TABLE, 'app_state');
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const loginEventsTable = sqlIdentifier(POSTGRES_LOGIN_EVENTS_TABLE, 'app_login_events');
  const passwordResetsTable = sqlIdentifier(POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
  await tracedPostgresPoolQuery(trace, 'schema_app_state_table', `
    create table if not exists ${table} (
      id text primary key,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_users_table_duplicate', `
    create table if not exists ${usersTable} (
      id text primary key,
      name text not null,
      email text not null unique,
      role text not null default 'sales',
      password_hash text not null,
      temporary_password text,
      invited_at timestamptz,
      password_changed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_login_events_table', `
    create table if not exists ${loginEventsTable} (
      id bigserial primary key,
      user_id text references ${usersTable}(id) on delete set null,
      name text,
      email text not null,
      ip_address text,
      user_agent text,
      logged_in_at timestamptz not null default now()
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_password_resets_table', `
    create table if not exists ${passwordResetsTable} (
      id bigserial primary key,
      user_id text references ${usersTable}(id) on delete cascade,
      email text not null,
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    )
  `);
  await createPostgresAppTables(trace);
  await refreshLeadSoftDelete(trace, { force: true });
  postgresSchemaReady = true;
  return postgresPool;
}

async function ensurePostgresUserSchema(trace = null) {
  if (!postgresPool) return;
  if (postgresUserSchemaReady) return;
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const sessionsTable = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
  await tracedPostgresPoolQuery(trace, 'schema_users_table', `
    create table if not exists ${usersTable} (
      id text primary key,
      name text not null,
      email text not null unique,
      role text not null default 'sales',
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_users_temporary_password_column', `alter table ${usersTable} add column if not exists temporary_password text`);
  // Temporary passwords are no longer stored as plain text: clear the ones older versions saved.
  await tracedPostgresPoolQuery(trace, 'schema_users_clear_temporary_passwords', `update ${usersTable} set temporary_password = null where temporary_password is not null`);
  await tracedPostgresPoolQuery(trace, 'schema_users_invited_at_column', `alter table ${usersTable} add column if not exists invited_at timestamptz`);
  await tracedPostgresPoolQuery(trace, 'schema_users_password_changed_at_column', `alter table ${usersTable} add column if not exists password_changed_at timestamptz`);
  await tracedPostgresPoolQuery(trace, 'schema_sessions_table', `
    create table if not exists ${sessionsTable} (
      id text primary key,
      user_id text not null,
      token_hash text,
      gmail_state text,
      eventbrite_state text,
      zoho_state text,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_sessions_token_hash_column', `alter table ${sessionsTable} add column if not exists token_hash text`);
  await tracedPostgresPoolQuery(trace, 'schema_sessions_zoho_state_column', `alter table ${sessionsTable} add column if not exists zoho_state text`);
  await tracedPostgresPoolQuery(trace, 'schema_sessions_user_id_index', `create index if not exists ${sqlIdentifier(`${POSTGRES_SESSIONS_TABLE}_user_id_idx`, 'app_sessions_user_id_idx')} on ${sessionsTable} (user_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_sessions_expires_at_index', `create index if not exists ${sqlIdentifier(`${POSTGRES_SESSIONS_TABLE}_expires_at_idx`, 'app_sessions_expires_at_idx')} on ${sessionsTable} (expires_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_sessions_token_hash_index', `create unique index if not exists ${sqlIdentifier(`${POSTGRES_SESSIONS_TABLE}_token_hash_idx`, 'app_sessions_token_hash_idx')} on ${sessionsTable} (token_hash) where token_hash is not null`);
  postgresUserSchemaReady = true;
}

// Leads merged by the de-duplication tool keep their row with deleted_at set. Production should
// set LEAD_SOFT_DELETE_ENABLED=true after the migration, so normal requests never query
// information_schema. When schema setup is explicitly enabled, the capability is detected once.
let leadSoftDelete = {
  enabled: false,
  checkedAt: LEAD_SOFT_DELETE_CONFIG === 'false' ? Number.POSITIVE_INFINITY : 0,
  pending: null
};
function refreshLeadSoftDelete(trace = null, { force = false } = {}) {
  if (!postgresPool) return leadSoftDelete.enabled;
  if (LEAD_SOFT_DELETE_CONFIG === 'false') return false;
  if (!force && String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') return leadSoftDelete.enabled;
  if (!force && leadSoftDelete.checkedAt) return leadSoftDelete.enabled;
  leadSoftDelete.pending ||= tracedPostgresPoolQuery(trace, 'storage_lead_soft_delete_column',
    `select exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'app_leads' and column_name = 'deleted_at') as enabled`
  ).then(result => {
    leadSoftDelete = { enabled: Boolean(result.rows?.[0]?.enabled), checkedAt: Date.now(), pending: null };
    return leadSoftDelete.enabled;
  }).catch(() => {
    leadSoftDelete = { ...leadSoftDelete, checkedAt: Date.now(), pending: null };
    return leadSoftDelete.enabled;
  });
  return leadSoftDelete.pending;
}

function activeLeadCondition(alias = '') {
  return leadSoftDelete.enabled ? `${alias ? `${alias}.` : ''}deleted_at is null` : 'true';
}

async function ensureStorage(trace = null) {
  if (!DATABASE_URL) return null;
  if (usesPostgresStorage()) {
    storageReady ||= connectPostgresStorage(trace);
    return storageReady;
  }
  if (!usesMongoStorage()) throw statusError(500, 'Unsupported DATABASE_URL. Use a PostgreSQL/Neon URL that starts with postgresql:// or a MongoDB URL that starts with mongodb:// or mongodb+srv://.');
  storageReady ||= connectMongoStorage();
  return storageReady;
}

async function ensureUserStorage(trace = null) {
  if (!DATABASE_URL) return null;
  if (usesPostgresStorage()) {
    await getPostgresPool();
    if (String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') {
      postgresUserSchemaReady = true;
      return postgresPool;
    }
    await ensurePostgresUserSchema(trace);
    return postgresPool;
  }
  return ensureStorage(trace);
}

async function createPostgresAppTables(trace = null) {
  await tracedPostgresPoolQuery(trace, 'schema_workspace_table', `
    create table if not exists app_workspace (
      id text primary key,
      demo boolean not null default false,
      stages jsonb not null default '[]'::jsonb,
      sources jsonb not null default '[]'::jsonb,
      gmail jsonb not null default '{}'::jsonb,
      eventbrite jsonb not null default '{}'::jsonb,
      meta jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_programmes_table', `create table if not exists app_programmes (id text primary key, name text not null, level text, data jsonb not null default '{}'::jsonb)`);
  await tracedPostgresPoolQuery(trace, 'schema_intakes_table', `create table if not exists app_intakes (id text primary key, programme_id text, name text not null, data jsonb not null default '{}'::jsonb)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_table', `
    create table if not exists app_leads (
      id text primary key,
      person_id text,
      first_name text,
      last_name text,
      email text,
      employer text,
      phone text,
      city text,
      programme_id text,
      programme text,
      level text,
      owner_id text,
      owner text,
      stage text,
      priority text,
      source_first_touch text,
      source_lead_capture text,
      contact_permission text,
      created_at timestamptz,
      next_action_at timestamptz,
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_table', `
    create table if not exists app_tasks (
      id text primary key,
      title text,
      lead_id text,
      kind text,
      status text,
      due_at timestamptz,
      completed_at timestamptz,
      priority text,
      owner_id text,
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_emails_table', `
    create table if not exists app_emails (
      id text primary key,
      lead_id text,
      first_name text,
      last_name text,
      email text,
      subject text,
      body text,
      owner text,
      response_at timestamptz,
      response_note text,
      due_at timestamptz,
      received_at timestamptz,
      gmail_message_id text unique,
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_applications_table', `
    create table if not exists app_applications (
      id text primary key,
      lead_id text,
      first_name text,
      last_name text,
      programme text,
      intake text,
      status text,
      manager text,
      member text,
      created_at timestamptz,
      contract jsonb,
      requirements jsonb,
      learner jsonb,
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_events_table', `
    create table if not exists app_events (
      id text primary key,
      name text,
      start_at timestamptz,
      location text,
      campaign text,
      capacity int,
      registrations int,
      attendance int,
      attendees jsonb,
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_audit_table', `
    create table if not exists app_audit (
      id text primary key,
      occurred_at timestamptz,
      actor text,
      action text,
      entity text,
      entity_id text,
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_attribution_table', `
    create table if not exists app_attribution (
      id bigserial primary key,
      lead_id text,
      email text,
      programme text,
      data jsonb not null,
      created_at timestamptz not null default now()
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_document_templates_table', `
    create table if not exists app_document_templates (
      key text primary key,
      title text not null,
      filename text not null,
      content_type text not null,
      content bytea not null,
      updated_at timestamptz not null default now()
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_table', monitoringSnapshotSchemaSql());
  await tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_expires_index', monitoringSnapshotExpiresIndexSql());
  await ensureZohoRecordsTable(postgresPool, trace);
  await tracedPostgresPoolQuery(trace, 'schema_leads_stage_index', `create index if not exists app_leads_stage_idx on app_leads(stage)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_owner_id_index', `create index if not exists app_leads_owner_id_idx on app_leads(owner_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_created_at_index', `create index if not exists app_leads_created_at_idx on app_leads(created_at)`);
  // Serves the Leads list keyset pagination (ORDER BY created_at DESC, id DESC).
  await tracedPostgresPoolQuery(trace, 'schema_leads_cursor_index', `create index if not exists idx_app_leads_cursor on app_leads(created_at desc, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_lead_id_index', `create index if not exists app_tasks_lead_id_idx on app_tasks(lead_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_status_index', `create index if not exists app_tasks_status_idx on app_tasks(status)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_due_at_index', `create index if not exists app_tasks_due_at_idx on app_tasks(due_at)`);
  // Planner lists open tasks by due date and done tasks by completion (GET /api/tasks).
  await tracedPostgresPoolQuery(trace, 'schema_tasks_status_due_index', `create index if not exists app_tasks_status_due_idx on app_tasks(status, due_at, id)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_owner_status_due_index', `create index if not exists app_tasks_owner_status_due_idx on app_tasks(owner_id, status, due_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_applications_lead_id_index', `create index if not exists app_applications_lead_id_idx on app_applications(lead_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_applications_status_index', `create index if not exists app_applications_status_idx on app_applications(status)`);
  await tracedPostgresPoolQuery(trace, 'schema_applications_created_at_index', `create index if not exists app_applications_created_at_idx on app_applications(created_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_emails_received_at_index', `create index if not exists app_emails_received_at_idx on app_emails(received_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_events_start_cursor_index', `create index if not exists app_events_start_cursor_idx on app_events(start_at desc nulls last, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_programme_id_index', `create index if not exists app_leads_programme_id_idx on app_leads(programme_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_source_capture_index', `create index if not exists app_leads_source_capture_idx on app_leads(source_lead_capture)`);
  await tracedPostgresPoolQuery(trace, 'schema_audit_occurred_at_index', `create index if not exists app_audit_occurred_at_idx on app_audit(occurred_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_audit_entity_id_index', `create index if not exists app_audit_entity_id_idx on app_audit(entity_id)`);
  await ensureIntegrationJobsTable(postgresPool, trace);
  await seedDocumentTemplatesFromDisk();
}

// Schema DDL only needs to run once per process; the Zoho worker and status polls call
// these helpers on every page, so repeat calls reuse the first run.
let zohoRecordsTableReady = null;
let integrationJobsTableReady = null;

function ensureZohoRecordsTable(client = postgresPool, trace = null) {
  if (!client) return Promise.resolve();
  zohoRecordsTableReady ||= createZohoRecordsTable(client, trace).catch(error => {
    zohoRecordsTableReady = null;
    throw error;
  });
  return zohoRecordsTableReady;
}

async function createZohoRecordsTable(client, trace = null) {
  const q = client === postgresPool
    ? (label, sql, params = []) => tracedPostgresPoolQuery(trace, label, sql, params)
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

function ensureIntegrationJobsTable(client = postgresPool, trace = null) {
  if (!client) return Promise.resolve();
  integrationJobsTableReady ||= createIntegrationJobsTable(client, trace).catch(error => {
    integrationJobsTableReady = null;
    throw error;
  });
  return integrationJobsTableReady;
}

async function createIntegrationJobsTable(client, trace = null) {
  const q = client === postgresPool
    ? (label, sql, params = []) => tracedPostgresPoolQuery(trace, label, sql, params)
    : (label, sql, params = []) => client.query(sql, params);
  await q('schema_integration_jobs_table', `
    create table if not exists integration_jobs (
      id text primary key,
      provider text not null,
      connection_id text not null,
      type text not null,
      status text not null default 'queued',
      current_module text,
      current_page integer not null default 1,
      next_page_token text,
      cursor text,
      records_scanned integer not null default 0,
      records_added integer not null default 0,
      records_updated integer not null default 0,
      records_failed integer not null default 0,
      modules_total integer not null default 0,
      modules_completed integer not null default 0,
      started_at timestamptz,
      last_progress_at timestamptz,
      completed_at timestamptz,
      attempts integer not null default 0,
      last_error text,
      retry_after_at timestamptz,
      created_by text,
      state jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await q('schema_integration_jobs_locked_by_column', `alter table integration_jobs add column if not exists locked_by text`);
  await q('schema_integration_jobs_locked_until_column', `alter table integration_jobs add column if not exists locked_until timestamptz`);
  await q('schema_integration_jobs_provider_status_index', `create index if not exists integration_jobs_provider_status_idx on integration_jobs(provider, type, status, updated_at desc)`);
  await q('schema_integration_jobs_retry_index', `create index if not exists integration_jobs_retry_idx on integration_jobs(provider, retry_after_at) where status in ('queued', 'running')`);
  await q('schema_integration_jobs_active_zoho_index', `create unique index if not exists integration_jobs_active_zoho_idx on integration_jobs(provider, type, connection_id) where provider = 'zoho' and status in ('queued', 'running')`);
}

async function loadDb() {
  if (dbCache && Date.now() - dbCacheLoadedAt < DB_CACHE_TTL_MS) return recalculate(cloneDb(dbCache));
  dbCache = null;
  dbCacheLoadedAt = Date.now();
  await ensureStorage();
  if (postgresPool) {
    const normalized = await loadPostgresTables();
    if (normalized) {
      rememberPostgresLoadedIds(normalized);
      await removeLegacyPostgresDeveloperUsers();
      const data = recalculate(await hydratePostgresUsers(normalized));
      if (ensureConfiguredDeveloperUser(data)) await persistDeveloperBootstrap(data);
      dbCache = cloneDb(data);
      return data;
    }
    const table = sqlIdentifier(POSTGRES_STATE_TABLE, 'app_state');
    const legacy = await postgresPool.query(`select data from ${table} where id = $1`, ['main']);
    const seeded = legacy.rows[0]?.data ? recalculate(legacy.rows[0].data) : seedDatabase();
    await saveDb(seeded);
    await removeLegacyPostgresDeveloperUsers();
    const data = recalculate(await hydratePostgresUsers(seeded));
    if (ensureConfiguredDeveloperUser(data)) await persistDeveloperBootstrap(data);
    dbCache = cloneDb(data);
    return data;
  }
  if (mongoStateCollection) {
    const record = await mongoStateCollection.findOne({ _id: 'main' });
    if (!record?.data) {
      const seeded = seedDatabase();
      removeLegacyDeveloperUsers(seeded);
      ensureConfiguredDeveloperUser(seeded);
      await saveDb(seeded);
      dbCache = cloneDb(seeded);
      return seeded;
    }
    const data = recalculate(record.data);
    const removedLegacy = removeLegacyDeveloperUsers(data);
    const ensuredDeveloper = ensureConfiguredDeveloperUser(data);
    const changed = removedLegacy || ensuredDeveloper;
    if (changed) await persistDeveloperBootstrap(data);
    dbCache = cloneDb(data);
    return data;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) await saveDb(seedDatabase());
  const data = recalculate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  const removedLegacy = removeLegacyDeveloperUsers(data);
  const ensuredDeveloper = ensureConfiguredDeveloperUser(data);
  const changed = removedLegacy || ensuredDeveloper;
  if (changed) await persistDeveloperBootstrap(data);
  dbCache = cloneDb(data);
  return data;
}

async function saveDb(db) {
  if (db && (db.__partial || db.__partial_load)) throw statusError(500, 'Refusing to save a partially loaded workspace. Load the full workspace first.');
  await ensureStorage();
  const data = recalculate(db);
  if (postgresPool) {
    await upsertPostgresUsers(data.users);
    await savePostgresTables(data);
    dbCache = cloneDb(data);
    monitoringState.last_save_at = new Date().toISOString();
    return;
  }
  if (mongoStateCollection) {
    await mongoStateCollection.updateOne(
      { _id: 'main' },
      { $set: { data, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
      { upsert: true }
    );
    dbCache = cloneDb(data);
    monitoringState.last_save_at = new Date().toISOString();
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  dbCache = cloneDb(data);
  monitoringState.last_save_at = new Date().toISOString();
}

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

const jsonValue = value => JSON.stringify(value ?? null);
const dateValue = value => value ? new Date(value).toISOString() : null;
function workspaceMetaState(db = {}) {
  return {
    ...(db.meta || {}),
    apollo: db.apollo || db.meta?.apollo || { imported_person_ids: [] },
    zoom: db.zoom || db.meta?.zoom || { imported_meeting_ids: [] },
    zoho: db.zoho || db.meta?.zoho || { imported_record_ids: [] }
  };
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

function mergeZoomState(currentZoom = {}, nextZoom = {}) {
  const currentCalls = Array.isArray(currentZoom.calls) ? currentZoom.calls : [];
  const nextCalls = Array.isArray(nextZoom.calls) ? nextZoom.calls : [];
  if (!currentCalls.length && !nextCalls.length) return { ...currentZoom, ...nextZoom };
  const byId = new Map();
  for (const call of currentCalls) {
    if (call?.id) byId.set(call.id, call);
  }
  for (const call of nextCalls) {
    if (call?.id) byId.set(call.id, { ...(byId.get(call.id) || {}), ...call });
  }
  const limit = Math.max(currentCalls.length, nextCalls.length, Number(process.env.ZOOM_MAX_CALLS || 5000));
  return {
    ...currentZoom,
    ...nextZoom,
    calls: [...byId.values()]
      .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))
      .slice(0, limit)
  };
}

async function workspaceMetaForSave(client, db = {}, options = {}) {
  let meta = workspaceMetaState(db);
  const shouldReadCurrentMeta = options.preserveMeta || options.preserveApollo || options.preserveZoom || options.preserveZoho || Array.isArray(meta.zoom?.calls);
  if (shouldReadCurrentMeta) {
    const current = await client.query(`select meta from app_workspace where id = $1`, ['main']);
    const currentMeta = current.rows[0]?.meta || {};
    if (options.preserveMeta) meta = { ...meta, ...currentMeta };
    if (options.preserveApollo) meta.apollo = currentMeta.apollo || meta.apollo || { imported_person_ids: [] };
    meta.zoho = options.preserveZoho
      ? mergeZohoState(meta.zoho || {}, currentMeta.zoho || {})
      : mergeZohoState(currentMeta.zoho || {}, meta.zoho || {});
    if (options.preserveZoom) meta.zoom = currentMeta.zoom || meta.zoom || { imported_meeting_ids: [] };
    else meta.zoom = mergeZoomState(currentMeta.zoom || {}, meta.zoom || {});
  }
  return meta;
}

function dbWithSavedMeta(db = {}, metaState = {}, overrides = {}) {
  return {
    ...db,
    ...overrides,
    meta: metaState,
    apollo: metaState.apollo || db.apollo || { imported_person_ids: [] },
    zoho: metaState.zoho || db.zoho || { imported_record_ids: [] },
    zoom: metaState.zoom || db.zoom || { imported_meeting_ids: [] }
  };
}

function gmailQueryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '2026/01/01';
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function ensureIncrementalStart(container, key) {
  if (!container[key]) container[key] = new Date().toISOString();
  return new Date(container[key]);
}

async function loadPostgresTables(options = {}) {
  await ensureZohoRecordsTable();
  const workspace = await postgresPool.query(`select * from app_workspace where id = $1`, ['main']);
  if (!workspace.rows[0]) return null;
  const seeded = seedDatabase();
  const row = workspace.rows[0];
  const leadLimit = Number(options.leadLimit || 0);
  const taskLimit = Number(options.taskLimit || 0);
  const emailLimit = Number(options.emailLimit || 0);
  const eventLimit = Number(options.eventLimit || 0);
  const auditLimit = Number(options.auditLimit || 0);
  const [
    programmes,
    leads,
    tasks,
    emails,
    applications,
    events,
    intakes,
    audit,
    attribution,
    zohoRecords
  ] = await Promise.all([
    postgresPool.query(`select data from app_programmes order by id`),
    // Merged leads never enter the in-memory workspace, so legacy dedupe/save paths cannot touch them.
    leadLimit > 0
      ? postgresPool.query(`select data from app_leads where ${activeLeadCondition()} order by created_at desc nulls last, id limit $1`, [leadLimit])
      : postgresPool.query(`select data from app_leads where ${activeLeadCondition()} order by created_at nulls last, id`),
    taskLimit > 0
      ? postgresPool.query(`select data from app_tasks order by case when status = 'Open' then 0 else 1 end, due_at nulls last, completed_at desc nulls last, id limit $1`, [taskLimit])
      : postgresPool.query(`select data from app_tasks order by due_at nulls last, id`),
    emailLimit > 0
      ? postgresPool.query(`select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id limit $1`, [emailLimit])
      : postgresPool.query(`select data from app_emails order by received_at desc nulls last, id`),
    options.skipApplications
      ? Promise.resolve({ rows: [] })
      : postgresPool.query(`select data from app_applications order by created_at nulls last, id`),
    eventLimit > 0
      ? postgresPool.query(`select data from app_events order by start_at desc nulls last, id limit $1`, [eventLimit])
      : postgresPool.query(`select data from app_events order by start_at nulls last, id`),
    postgresPool.query(`select data from app_intakes order by id`),
    options.skipAudit
      ? Promise.resolve({ rows: [] })
      : auditLimit > 0
      ? postgresPool.query(`select data from app_audit order by occurred_at desc nulls last, id limit $1`, [auditLimit])
      : postgresPool.query(`select data from app_audit order by occurred_at desc nulls last, id`),
    options.skipAttribution
      ? Promise.resolve({ rows: [] })
      : postgresPool.query(`select data from app_attribution order by id desc`),
    postgresPool.query(`
      select data from (
        select data, module, modified_time, synced_at, key, row_number() over (
          partition by module
          order by modified_time desc nulls last, synced_at desc nulls last, key
        ) as rn
        from app_zoho_records
      ) ranked
      where rn <= 500
      order by data->>'module', modified_time desc nulls last
    `)
  ]);
  const zohoState = row.meta?.zoho || { imported_record_ids: [] };
  zohoState.records ||= {};
  for (const item of zohoRecords.rows.map(row => row.data).filter(Boolean)) {
    const moduleName = item.module || 'Zoho CRM';
    zohoState.records[moduleName] ||= [];
    zohoState.records[moduleName].push(item);
    const recordKey = item.key || `${moduleName}:${item.id || ''}`;
    if (recordKey && !recordKey.endsWith(':')) {
      zohoState.imported_record_ids ||= [];
      if (!zohoState.imported_record_ids.includes(recordKey)) zohoState.imported_record_ids.push(recordKey);
    }
  }
  const db = {
    demo: row.demo,
    users: seeded.users,
    programmes: programmes.rows.map(item => item.data),
    stages: row.stages || seeded.stages,
    sources: row.sources || seeded.sources,
    leads: leads.rows.map(item => item.data),
    tasks: tasks.rows.map(item => item.data),
    emails: emails.rows.map(item => item.data),
    applications: applications.rows.map(item => item.data),
    events: events.rows.map(item => item.data),
    integrations: seeded.integrations,
    intakes: intakes.rows.map(item => item.data),
    audit: audit.rows.map(item => item.data),
    attribution: attribution.rows.map(item => item.data),
    gmail: row.gmail || { connected: false, imported_message_ids: [] },
    eventbrite: row.eventbrite || { connected: false, imported_event_ids: [], imported_attendee_ids: [] },
    apollo: row.meta?.apollo || { imported_person_ids: [] },
    zoho: zohoState,
    zoom: row.meta?.zoom || { imported_meeting_ids: [] },
    meta: row.meta || { imported_lead_ids: [], imported_form_ids: [] }
  };
  return db;
}

const POSTGRES_ID_TABLES = {
  app_programmes: 'programmes',
  app_intakes: 'intakes',
  app_leads: 'leads',
  app_tasks: 'tasks',
  app_emails: 'emails',
  app_applications: 'applications',
  app_events: 'events',
  app_audit: 'audit'
};

function rememberPostgresLoadedIds(db) {
  for (const [table, key] of Object.entries(POSTGRES_ID_TABLES)) {
    postgresLoadedIds.set(table, new Set((db[key] || []).map(item => item?.id).filter(Boolean)));
  }
}

async function deleteMissingIds(client, table, ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  const loaded = postgresLoadedIds.get(table);
  // A full sync never hard-deletes a merged (soft-deleted) lead: it is not in memory by design.
  const keepMerged = table === 'app_leads' ? ` and ${activeLeadCondition()}` : '';
  if (loaded) {
    const wantedSet = new Set(wanted);
    const removed = [...loaded].filter(id => !wantedSet.has(id));
    if (removed.length) await client.query(`delete from ${table} where id = any($1::text[])${keepMerged}`, [removed]);
    postgresLoadedIds.set(table, new Set(wanted));
    return;
  }
  if (wanted.length) {
    await client.query(`delete from ${table} where not (id = any($1::text[]))${keepMerged}`, [wanted]);
  } else {
    await client.query(`delete from ${table} where true${keepMerged}`);
  }
}

async function savePostgresTables(db) {
  if (db && (db.__partial || db.__partial_load)) throw statusError(500, 'Refusing full-table sync for a partially loaded workspace.');
  const programmeRows = importProgrammeRows(db);
  const intakeRows = (db.intakes || []).map(item => ({ id: item.id, programme_id: item.programme_id || null, name: item.name, data: item }));
  const leadRows = importLeadRows(db);
  const taskRows = importTaskRows(db);
  const emailRows = importEmailRows(db);
  const applicationRows = (db.applications || []).map(item => ({
    id: item.id,
    lead_id: item.lead_id || null,
    first_name: item.first_name || null,
    last_name: item.last_name || null,
    programme: item.programme || null,
    intake: item.intake || null,
    status: item.status || null,
    manager: item.manager || null,
    member: item.member || null,
    created_at: item.created_at || null,
    contract: item.contract || null,
    requirements: item.requirements || [],
    learner: item.learner || null,
    data: item
  }));
  const eventRows = importEventRows(db);
  const auditRows = importAuditRows(db);
  const attributionRows = (db.attribution || []).map(item => ({
    lead_id: item.id || item.lead_id || null,
    email: normalizeEmail(item.email),
    programme: item.programme || null,
    data: item
  }));
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const metaState = workspaceMetaState(db);
    await client.query(
      `insert into app_workspace (id, demo, stages, sources, gmail, eventbrite, meta, updated_at)
       values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
       on conflict (id) do update set
         demo = excluded.demo,
         stages = excluded.stages,
         sources = excluded.sources,
         gmail = excluded.gmail,
         eventbrite = excluded.eventbrite,
         meta = excluded.meta,
         updated_at = now()`,
      ['main', Boolean(db.demo), jsonValue(db.stages || []), jsonValue(db.sources || []), jsonValue(db.gmail || {}), jsonValue(db.eventbrite || {}), jsonValue(metaState)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, level text, data jsonb)
       )
       insert into app_programmes (id, name, level, data)
       select id, name, level, data from rows
       on conflict (id) do update set name = excluded.name, level = excluded.level, data = excluded.data`,
      [jsonValue(programmeRows)]
    );
    await deleteMissingIds(client, 'app_programmes', programmeRows.map(item => item.id));
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, programme_id text, name text, data jsonb)
       )
       insert into app_intakes (id, programme_id, name, data)
       select id, programme_id, name, data from rows
       on conflict (id) do update set programme_id = excluded.programme_id, name = excluded.name, data = excluded.data`,
      [jsonValue(intakeRows)]
    );
    await deleteMissingIds(client, 'app_intakes', intakeRows.map(item => item.id));
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
      [jsonValue(leadRows)]
    );
    await deleteMissingIds(client, 'app_leads', leadRows.map(item => item.id));
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, title text, lead_id text, kind text, status text, due_at text, completed_at text, priority text, owner_id text, data jsonb
         )
       )
       insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       select id, title, lead_id, kind, status, due_at::timestamptz, completed_at::timestamptz, priority, owner_id, data from rows
       on conflict (id) do update set
         title = excluded.title, lead_id = excluded.lead_id, kind = excluded.kind, status = excluded.status,
         due_at = excluded.due_at, completed_at = excluded.completed_at, priority = excluded.priority,
         owner_id = excluded.owner_id, data = excluded.data`,
      [jsonValue(taskRows)]
    );
    await deleteMissingIds(client, 'app_tasks', taskRows.map(item => item.id));
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, lead_id text, first_name text, last_name text, email text, subject text, body text, owner text,
           response_at text, response_note text, due_at text, received_at text, gmail_message_id text, data jsonb
         )
       ),
       deduped as (
         select * from (
           select rows.*, row_number() over (
             partition by coalesce(nullif(gmail_message_id, ''), 'id:' || id)
             order by received_at::timestamptz desc nulls last, id
           ) as rn
           from rows
         ) ranked
         where rn = 1
       ),
       incoming_rows as (
         select
           coalesce(existing.id, deduped.id) as id,
           deduped.lead_id, deduped.first_name, deduped.last_name, deduped.email, deduped.subject, deduped.body,
           deduped.owner, deduped.response_at, deduped.response_note, deduped.due_at, deduped.received_at,
           deduped.gmail_message_id, deduped.data
         from deduped
         left join app_emails existing
           on deduped.gmail_message_id is not null
          and deduped.gmail_message_id <> ''
          and existing.gmail_message_id = deduped.gmail_message_id
       ),
       removed_duplicates as (
         delete from app_emails existing
         using incoming_rows incoming
         where incoming.gmail_message_id is not null
           and incoming.gmail_message_id <> ''
           and existing.gmail_message_id = incoming.gmail_message_id
           and existing.id <> incoming.id
         returning existing.id
       )
       insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       select id, lead_id, first_name, last_name, email, subject, body, owner, response_at::timestamptz, response_note, due_at::timestamptz, received_at::timestamptz, nullif(gmail_message_id, ''), data from incoming_rows
       on conflict (id) do update set
         lead_id = excluded.lead_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
         subject = excluded.subject, body = excluded.body, owner = excluded.owner, response_at = excluded.response_at,
         response_note = excluded.response_note, due_at = excluded.due_at, received_at = excluded.received_at,
         gmail_message_id = excluded.gmail_message_id, data = excluded.data`,
      [jsonValue(emailRows)]
    );
    await deleteMissingIds(client, 'app_emails', emailRows.map(item => item.id));
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, lead_id text, first_name text, last_name text, programme text, intake text, status text,
           manager text, member text, created_at text, contract jsonb, requirements jsonb, learner jsonb, data jsonb
         )
       )
       insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
       select id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at::timestamptz, contract, requirements, learner, data from rows
       on conflict (id) do update set
         lead_id = excluded.lead_id, first_name = excluded.first_name, last_name = excluded.last_name,
         programme = excluded.programme, intake = excluded.intake, status = excluded.status, manager = excluded.manager,
         member = excluded.member, created_at = excluded.created_at, contract = excluded.contract,
         requirements = excluded.requirements, learner = excluded.learner, data = excluded.data`,
      [jsonValue(applicationRows)]
    );
    await deleteMissingIds(client, 'app_applications', applicationRows.map(item => item.id));
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, name text, start_at text, location text, campaign text, capacity int, registrations int, attendance int, attendees jsonb, data jsonb
         )
       )
       insert into app_events (id, name, start_at, location, campaign, capacity, registrations, attendance, attendees, data)
       select id, name, start_at::timestamptz, location, campaign, capacity, registrations, attendance, attendees, data from rows
       on conflict (id) do update set
         name = excluded.name, start_at = excluded.start_at, location = excluded.location, campaign = excluded.campaign,
         capacity = excluded.capacity, registrations = excluded.registrations, attendance = excluded.attendance,
         attendees = excluded.attendees, data = excluded.data`,
      [jsonValue(eventRows)]
    );
    await deleteMissingIds(client, 'app_events', eventRows.map(item => item.id));
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, occurred_at text, actor text, action text, entity text, entity_id text, data jsonb
         )
       )
       insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       select id, occurred_at::timestamptz, actor, action, entity, entity_id, data from rows
       on conflict (id) do update set
         occurred_at = excluded.occurred_at, actor = excluded.actor, action = excluded.action,
         entity = excluded.entity, entity_id = excluded.entity_id, data = excluded.data`,
      [jsonValue(auditRows)]
    );
    await deleteMissingIds(client, 'app_audit', auditRows.map(item => item.id));
    if (attributionRows.length) {
      await client.query(
        `with rows as (
           select * from jsonb_to_recordset($1::jsonb) as x(lead_id text, email text, programme text, data jsonb)
         ),
         updated as (
           update app_attribution target
           set data = rows.data
           from rows
           where coalesce(target.lead_id, '') = coalesce(rows.lead_id, '')
             and coalesce(target.email, '') = coalesce(rows.email, '')
             and coalesce(target.programme, '') = coalesce(rows.programme, '')
           returning target.id
         )
         insert into app_attribution (lead_id, email, programme, data)
         select lead_id, email, programme, data from rows
         where not exists (
           select 1 from app_attribution existing
           where coalesce(existing.lead_id, '') = coalesce(rows.lead_id, '')
             and coalesce(existing.email, '') = coalesce(rows.email, '')
             and coalesce(existing.programme, '') = coalesce(rows.programme, '')
         )`,
        [jsonValue(attributionRows)]
      );
      await client.query(
        `with rows as (
           select * from jsonb_to_recordset($1::jsonb) as x(lead_id text, email text, programme text)
         )
         delete from app_attribution target
         where not exists (
           select 1 from rows
           where coalesce(target.lead_id, '') = coalesce(rows.lead_id, '')
             and coalesce(target.email, '') = coalesce(rows.email, '')
             and coalesce(target.programme, '') = coalesce(rows.programme, '')
         )`,
        [jsonValue(attributionRows)]
      );
    } else {
      await client.query(`delete from app_attribution`);
    }
    await upsertZohoRecordRows(client, zohoRecordRows(db));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function importLeadRows(db) {
  return (db.leads || []).map(item => ({
    id: item.id,
    person_id: item.person_id || null,
    first_name: item.first_name || null,
    last_name: item.last_name || null,
    email: normalizeEmail(item.email),
    employer: item.employer || null,
    phone: item.phone || null,
    city: item.city || null,
    programme_id: item.programme_id || null,
    programme: item.programme || null,
    level: item.level || null,
    owner_id: item.owner_id || null,
    owner: item.owner || null,
    stage: item.stage || null,
    priority: item.priority || null,
    source_first_touch: item.source_first_touch || null,
    source_lead_capture: item.source_lead_capture || null,
    contact_permission: item.contact_permission || null,
    created_at: item.created_at || null,
    next_action_at: item.next_action_at || null,
    data: item
  }));
}

function importProgrammeRows(db) {
  ensureProgrammeCatalog(db);
  return (db.programmes || []).map(item => ({
    id: item.id,
    name: item.name,
    level: item.level || null,
    data: item
  }));
}

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

function uniqueEmailRows(rows = []) {
  const preferNewest = (current, existing) => {
    const currentTime = new Date(current.received_at || 0).getTime() || 0;
    const existingTime = new Date(existing?.received_at || 0).getTime() || 0;
    return !existing || currentTime >= existingTime;
  };
  const byGmailOrId = new Map();
  for (const row of rows) {
    const key = row.gmail_message_id ? `gmail:${row.gmail_message_id}` : `id:${row.id}`;
    const existing = byGmailOrId.get(key);
    if (preferNewest(row, existing)) byGmailOrId.set(key, row);
  }
  const byId = new Map();
  for (const row of byGmailOrId.values()) {
    const existing = byId.get(row.id);
    if (preferNewest(row, existing)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function importEmailRows(db) {
  return uniqueEmailRows((db.emails || []).map(item => ({
    id: item.id,
    lead_id: item.lead_id || null,
    first_name: item.first_name || null,
    last_name: item.last_name || null,
    email: normalizeEmail(item.email),
    subject: item.subject || null,
    body: item.body || null,
    owner: item.owner || null,
    response_at: item.response_at || null,
    response_note: item.response_note || null,
    due_at: item.due_at || null,
    received_at: item.received_at || null,
    gmail_message_id: item.gmail_message_id || null,
    data: item
  })));
}

function importEventRows(db) {
  return (db.events || []).map(item => ({
    id: item.id,
    name: item.name || null,
    start_at: item.start_at || null,
    location: item.location || null,
    campaign: item.campaign || null,
    capacity: item.capacity || 0,
    registrations: item.registrations || 0,
    attendance: item.attendance || 0,
    attendees: item.attendees || [],
    data: item
  }));
}

function importAuditRows(db) {
  return (db.audit || []).map(item => ({
    id: item.id,
    occurred_at: item.occurred_at || null,
    actor: item.actor || null,
    action: item.action || null,
    entity: item.entity || null,
    entity_id: item.entity_id || null,
    data: item
  }));
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
    [jsonValue(rows)]
  );
}

async function saveEventImportTables(db, options = {}) {
  if (!postgresPool) return saveDb(db);
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    let gmailState = db.gmail || {};
    if (options.preserveGmail) {
      const current = await client.query(`select gmail from app_workspace where id = $1`, ['main']);
      gmailState = current.rows[0]?.gmail || gmailState;
    }
    const metaState = await workspaceMetaForSave(client, db, options);
    await client.query(
      `insert into app_workspace (id, demo, stages, sources, gmail, eventbrite, meta, updated_at)
       values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
       on conflict (id) do update set
         demo = excluded.demo,
         stages = excluded.stages,
         sources = excluded.sources,
         gmail = excluded.gmail,
         eventbrite = excluded.eventbrite,
         meta = excluded.meta,
         updated_at = now()`,
      ['main', Boolean(db.demo), jsonValue(db.stages || []), jsonValue(db.sources || []), jsonValue(gmailState), jsonValue(db.eventbrite || {}), jsonValue(metaState)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, level text, data jsonb)
       )
       insert into app_programmes (id, name, level, data)
       select id, name, level, data from rows
       on conflict (id) do update set name = excluded.name, level = excluded.level, data = excluded.data`,
      [jsonValue(importProgrammeRows(db))]
    );
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
      [jsonValue(importLeadRows(db))]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, title text, lead_id text, kind text, status text, due_at text, completed_at text, priority text, owner_id text, data jsonb
         )
       )
       insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       select id, title, lead_id, kind, status, due_at::timestamptz, completed_at::timestamptz, priority, owner_id, data from rows
       on conflict (id) do update set
         title = excluded.title, lead_id = excluded.lead_id, kind = excluded.kind, status = excluded.status,
         due_at = excluded.due_at, completed_at = excluded.completed_at, priority = excluded.priority,
         owner_id = excluded.owner_id, data = excluded.data`,
      [jsonValue(importTaskRows(db))]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, name text, start_at text, location text, campaign text, capacity int, registrations int, attendance int, attendees jsonb, data jsonb
         )
       )
       insert into app_events (id, name, start_at, location, campaign, capacity, registrations, attendance, attendees, data)
       select id, name, start_at::timestamptz, location, campaign, capacity, registrations, attendance, attendees, data from rows
       on conflict (id) do update set
         name = excluded.name, start_at = excluded.start_at, location = excluded.location, campaign = excluded.campaign,
         capacity = excluded.capacity, registrations = excluded.registrations, attendance = excluded.attendance,
         attendees = excluded.attendees, data = excluded.data`,
      [jsonValue(importEventRows(db))]
    );
    const deleteEventIds = [...(options.deleteEventIds || [])].filter(Boolean);
    if (deleteEventIds.length) {
      await client.query(`delete from app_events where id = any($1::text[])`, [deleteEventIds]);
    }
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, occurred_at text, actor text, action text, entity text, entity_id text, data jsonb
         )
       )
       insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       select id, occurred_at::timestamptz, actor, action, entity, entity_id, data from rows
       on conflict (id) do update set
         occurred_at = excluded.occurred_at, actor = excluded.actor, action = excluded.action,
         entity = excluded.entity, entity_id = excluded.entity_id, data = excluded.data`,
      [jsonValue(importAuditRows(db))]
    );
    await upsertZohoRecordRows(client, zohoRecordRows(db));
    await client.query('commit');
    dbCache = cloneDb(recalculate(dbWithSavedMeta(db, metaState, { gmail: gmailState })));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function filterImportRows(rows, ids) {
  if (!ids) return rows;
  const wanted = ids instanceof Set ? ids : new Set(ids);
  return rows.filter(row => wanted.has(row.id));
}

async function saveGmailImportTables(db, options = {}) {
  if (!postgresPool) return saveDb(db);
  const leadRows = filterImportRows(importLeadRows(db), options.leadIds);
  const taskRows = filterImportRows(importTaskRows(db), options.taskIds);
  const emailRows = filterImportRows(importEmailRows(db), options.emailIds);
  const auditRows = filterImportRows(importAuditRows(db), options.auditIds);
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    let eventbriteState = db.eventbrite || {};
    if (options.preserveEventbrite) {
      const current = await client.query(`select eventbrite from app_workspace where id = $1`, ['main']);
      eventbriteState = current.rows[0]?.eventbrite || eventbriteState;
    }
    const metaState = await workspaceMetaForSave(client, db, { preserveMeta: true, preserveApollo: true, preserveZoom: true });
    await client.query(
      `insert into app_workspace (id, demo, stages, sources, gmail, eventbrite, meta, updated_at)
       values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
       on conflict (id) do update set
         demo = excluded.demo,
         stages = excluded.stages,
         sources = excluded.sources,
         gmail = excluded.gmail,
         eventbrite = excluded.eventbrite,
         meta = excluded.meta,
         updated_at = now()`,
      ['main', Boolean(db.demo), jsonValue(db.stages || []), jsonValue(db.sources || []), jsonValue(db.gmail || {}), jsonValue(eventbriteState), jsonValue(metaState)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, level text, data jsonb)
       )
       insert into app_programmes (id, name, level, data)
       select id, name, level, data from rows
       on conflict (id) do update set name = excluded.name, level = excluded.level, data = excluded.data`,
      [jsonValue(importProgrammeRows(db))]
    );
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
      [jsonValue(leadRows)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, title text, lead_id text, kind text, status text, due_at text, completed_at text, priority text, owner_id text, data jsonb
         )
       )
       insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       select id, title, lead_id, kind, status, due_at::timestamptz, completed_at::timestamptz, priority, owner_id, data from rows
       on conflict (id) do update set
         title = excluded.title, lead_id = excluded.lead_id, kind = excluded.kind, status = excluded.status,
         due_at = excluded.due_at, completed_at = excluded.completed_at, priority = excluded.priority,
         owner_id = excluded.owner_id, data = excluded.data`,
      [jsonValue(taskRows)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, lead_id text, first_name text, last_name text, email text, subject text, body text, owner text,
           response_at text, response_note text, due_at text, received_at text, gmail_message_id text, data jsonb
         )
       ),
       deduped as (
         select * from (
           select rows.*, row_number() over (
             partition by coalesce(nullif(gmail_message_id, ''), 'id:' || id)
             order by received_at::timestamptz desc nulls last, id
           ) as rn
           from rows
         ) ranked
         where rn = 1
       ),
       incoming_rows as (
         select
           coalesce(existing.id, deduped.id) as id,
           deduped.lead_id, deduped.first_name, deduped.last_name, deduped.email, deduped.subject, deduped.body,
           deduped.owner, deduped.response_at, deduped.response_note, deduped.due_at, deduped.received_at,
           deduped.gmail_message_id, deduped.data
         from deduped
         left join app_emails existing
           on deduped.gmail_message_id is not null
          and deduped.gmail_message_id <> ''
          and existing.gmail_message_id = deduped.gmail_message_id
       ),
       removed_duplicates as (
         delete from app_emails existing
         using incoming_rows incoming
         where incoming.gmail_message_id is not null
           and incoming.gmail_message_id <> ''
           and existing.gmail_message_id = incoming.gmail_message_id
           and existing.id <> incoming.id
         returning existing.id
       )
       insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       select id, lead_id, first_name, last_name, email, subject, body, owner, response_at::timestamptz, response_note, due_at::timestamptz, received_at::timestamptz, nullif(gmail_message_id, ''), data from incoming_rows
       on conflict (id) do update set
         lead_id = excluded.lead_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
         subject = excluded.subject, body = excluded.body, owner = excluded.owner, response_at = excluded.response_at,
         response_note = excluded.response_note, due_at = excluded.due_at, received_at = excluded.received_at,
         gmail_message_id = excluded.gmail_message_id, data = excluded.data`,
      [jsonValue(emailRows)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, occurred_at text, actor text, action text, entity text, entity_id text, data jsonb
         )
       )
       insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       select id, occurred_at::timestamptz, actor, action, entity, entity_id, data from rows
       on conflict (id) do update set
         occurred_at = excluded.occurred_at, actor = excluded.actor, action = excluded.action,
         entity = excluded.entity, entity_id = excluded.entity_id, data = excluded.data`,
      [jsonValue(auditRows)]
    );
    await client.query('commit');
    dbCache = cloneDb(recalculate(dbWithSavedMeta(db, metaState, { eventbrite: eventbriteState })));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertPostgresUsers(users = []) {
  if (!postgresPool) return;
  const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  for (const user of users) {
    if (!user?.email || !user?.password_hash) continue;
    await postgresPool.query(
      `
        insert into ${table} (id, name, email, role, password_hash, invited_at, password_changed_at, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, now(), now())
        on conflict (email) do update
        set name = excluded.name,
            role = excluded.role,
            password_hash = excluded.password_hash,
            invited_at = coalesce(${table}.invited_at, excluded.invited_at),
            password_changed_at = excluded.password_changed_at,
            updated_at = now()
      `,
      [user.id, user.name, normalizeEmail(user.email), user.role || 'sales', user.password_hash, dateValue(user.invited_at), dateValue(user.password_changed_at)]
    );
  }
}

async function hydratePostgresUsers(db) {
  if (!postgresPool) return db;
  const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const count = await postgresPool.query(`select count(*)::int as count from ${table}`);
  if (!count.rows[0]?.count && db.users?.length) await upsertPostgresUsers(db.users);
  const result = await postgresPool.query(`select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} order by created_at, id`);
  if (result.rows.length) db.users = result.rows;
  return db;
}

function configuredDeveloperUserRecord() {
  const config = developerBootstrapConfig();
  if (!config.email || !config.password) return null;
  return {
    id: 'developer-user',
    name: config.name,
    email: config.email,
    role: normalizeWorkspaceRole(config.role) || 'admin',
    password_hash: hashPassword(config.password),
    invited_at: new Date().toISOString(),
    password_changed_at: null
  };
}

async function findLoginUser(email) {
  await ensureUserStorage();
  if (postgresPool) {
    const developerUser = configuredDeveloperUserRecord();
    if (developerUser) await upsertPostgresUsers([developerUser]);
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const result = await postgresQuery(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} where email = $1 limit 1`,
      [normalizeEmail(email)]
    );
    return result.rows[0] || null;
  }
  const db = await loadDb();
  return db.users.find(item => normalizeEmail(item.email) === normalizeEmail(email)) || null;
}

async function forceConfiguredDeveloperLogin(email, password) {
  if (!isDeveloperEmail(email)) return null;
  const configuredPassword = configuredDeveloperPassword();
  if (!configuredPassword || !safeEqualText(password, configuredPassword)) return null;
  const developerUser = configuredDeveloperUserRecord();
  if (!developerUser) return null;
  await ensureUserStorage();
  if (postgresPool) {
    await upsertPostgresUsers([developerUser]);
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const result = await postgresQuery(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} where email = $1 limit 1`,
      [normalizeEmail(email)]
    );
    return result.rows[0] || developerUser;
  }
  const db = await loadDb();
  const existing = db.users.find(item => normalizeEmail(item.email) === normalizeEmail(email));
  if (existing) Object.assign(existing, developerUser, { id: existing.id });
  else db.users.push(developerUser);
  await saveDb(db);
  return existing || developerUser;
}

async function findUserById(id) {
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const result = await postgresQuery(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} where id = $1 limit 1`,
      [id]
    );
    return result.rows[0] || null;
  }
  const db = await loadDb();
  return db.users.find(item => item.id === id) || null;
}

async function createSession(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL);
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(
      `insert into ${table} (id, user_id, token_hash, expires_at, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [sid, user.id, tokenHash(sid), expiresAt.toISOString()]
    );
  } else {
    memorySessions.set(sid, { user_id: user.id, expires_at: expiresAt.getTime(), updated_at: Date.now() });
  }
  return sid;
}

async function getSession(sid) {
  if (!sid) return null;
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    const result = await postgresQuery(
      `select id, user_id, gmail_state, eventbrite_state, zoho_state, expires_at, updated_at from ${table} where id = $1 or token_hash = $2 limit 1`,
      [sid, tokenHash(sid)]
    );
    const session = result.rows[0];
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await postgresQuery(`delete from ${table} where id = $1`, [sid]);
      return null;
    }
    return session;
  }
  const session = memorySessions.get(sid);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    memorySessions.delete(sid);
    return null;
  }
  return { id: sid, ...session };
}

async function touchSession(sid) {
  const expiresAt = new Date(Date.now() + SESSION_TTL);
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(`update ${table} set expires_at = $2, updated_at = now() where id = $1`, [sid, expiresAt.toISOString()]);
  } else {
    const session = memorySessions.get(sid);
    if (session) {
      session.expires_at = expiresAt.getTime();
      session.updated_at = Date.now();
    }
  }
}

async function patchSession(sid, fields = {}) {
  if (!sid) throw statusError(401, 'Sign in to continue.');
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(
      `update ${table}
       set gmail_state = coalesce($2, gmail_state),
           eventbrite_state = coalesce($3, eventbrite_state),
           zoho_state = coalesce($4, zoho_state),
           updated_at = now()
       where id = $1`,
      [sid, fields.gmail_state ?? null, fields.eventbrite_state ?? null, fields.zoho_state ?? null]
    );
  } else {
    const session = memorySessions.get(sid);
    if (!session) throw statusError(401, 'Sign in to continue.');
    Object.assign(session, fields);
  }
}

async function deleteSession(sid) {
  if (!sid) return;
  sessionAuthCacheEpoch += 1;
  postgresSessionUserCache.delete(tokenHash(sid));
  postgresSessionUserLookups.delete(tokenHash(sid));
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(`delete from ${table} where id = $1`, [sid]);
    return;
  }
  memorySessions.delete(sid);
}

function clearCachedSessionUserForUser(userId) {
  if (!userId) return;
  sessionAuthCacheEpoch += 1;
  for (const [key, entry] of postgresSessionUserCache.entries()) {
    if (entry.userId === userId) postgresSessionUserCache.delete(key);
  }
  for (const [key, lookup] of postgresSessionUserLookups.entries()) {
    if (lookup?.userId === userId) postgresSessionUserLookups.delete(key);
  }
}

async function currentSessionUser(req, trace = null) {
  const cookieStarted = performance.now();
  const sid = parseCookies(req).sid;
  perfAdd(trace, 'cookie_parse', performance.now() - cookieStarted);
  if (!sid) throw statusError(401, 'Sign in to continue.');
  await perfPhase(trace, 'auth_storage', () => ensureUserStorage(trace));
  if (postgresPool) {
    const sessionsTable = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const sidHash = tokenHash(sid);
    const cached = postgresSessionUserCache.get(sidHash);
    if (cached && cached.expiresAt > Date.now()) {
      perfCount(trace, 'session_cache_hits');
      perfAdd(trace, 'auth_session_cache', 0);
      return { ...cached.user };
    }
    if (cached) postgresSessionUserCache.delete(sidHash);
    let joined = true;
    let lookup = postgresSessionUserLookups.get(sidHash);
    if (!lookup) {
      joined = false;
      perfCount(trace, 'session_cache_misses');
      perfCount(trace, 'session_lookup_started');
      const cacheEpoch = sessionAuthCacheEpoch;
      lookup = (async () => {
        const authStart = performance.now();
        const result = await timedPostgresQuery(
          trace,
          'auth_session_lookup',
          `select
             s.id as session_id,
             s.expires_at,
             s.updated_at as session_updated_at,
             u.id, u.name, u.email, u.role, u.password_hash, u.invited_at, u.password_changed_at
           from ${sessionsTable} s
           join ${usersTable} u on u.id = s.user_id
           where (s.id = $1 or s.token_hash = $2)
             and s.expires_at > now()
           limit 1`,
          [sid, sidHash]
        );
        const row = result.rows[0];
        if (!row) throw statusError(401, 'Sign in to continue.');
        const updatedAt = new Date(row.session_updated_at || 0).getTime();
        if (!updatedAt || Date.now() - updatedAt > SESSION_TOUCH_INTERVAL_MS) {
          await timedPostgresQuery(
            trace,
            'auth_session_touch',
            `update ${sessionsTable} set expires_at = $2, updated_at = now(), token_hash = coalesce(token_hash, $3) where id = $1`,
            [row.session_id, new Date(Date.now() + SESSION_TTL).toISOString(), sidHash]
          );
        }
        const { session_id, expires_at, session_updated_at, ...user } = row;
        user.__auth_ms = performance.now() - authStart;
        if (SESSION_AUTH_CACHE_MS > 0 && cacheEpoch === sessionAuthCacheEpoch) {
          const sessionExpiry = new Date(expires_at || 0).getTime() || 0;
          postgresSessionUserCache.set(sidHash, {
            user: { ...user },
            userId: user.id,
            expiresAt: Math.min(Date.now() + SESSION_AUTH_CACHE_MS, sessionExpiry)
          });
        }
        return user;
      })();
      postgresSessionUserLookups.set(sidHash, lookup);
      lookup.then(
        () => postgresSessionUserLookups.delete(sidHash),
        () => postgresSessionUserLookups.delete(sidHash)
      );
    }
    if (joined) {
      perfCount(trace, 'auth_session_joined');
      perfCount(trace, 'session_lookup_joined');
    }
    const user = joined
      ? await perfPhase(trace, 'auth_session_join', () => lookup)
      : await lookup;
    return { ...user };
  }
  const session = await perfPhase(trace, 'auth_session_lookup', () => getSession(sid));
  if (!session) throw statusError(401, 'Sign in to continue.');
  const user = await perfPhase(trace, 'auth_user_lookup', () => findUserById(session.user_id));
  if (!user) throw statusError(401, 'Sign in to continue.');
  if (!session.updated_at || Date.now() - Number(session.updated_at || 0) > SESSION_TOUCH_INTERVAL_MS) await perfPhase(trace, 'auth_session_touch', () => touchSession(sid));
  return user;
}

async function recordPostgresLogin(user, req) {
  if (!postgresPool || !user) return;
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const loginEventsTable = sqlIdentifier(POSTGRES_LOGIN_EVENTS_TABLE, 'app_login_events');
  await postgresQuery(
    `
      insert into ${loginEventsTable} (user_id, name, email, ip_address, user_agent)
      values ($1, $2, $3, $4, $5)
    `,
    [user.id, user.name, normalizeEmail(user.email), requestIp(req), String(req.headers['user-agent'] || '').slice(0, 500)]
  );
  await postgresQuery(`update ${usersTable} set last_login_at = now(), updated_at = now() where id = $1`, [user.id]);
}

async function clearUserSessions(userId) {
  clearCachedSessionUserForUser(userId);
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(`delete from ${table} where user_id = $1`, [userId]);
    return;
  }
  for (const [sid, session] of memorySessions.entries()) {
    if (session.user_id === userId) memorySessions.delete(sid);
  }
}

// Password guessing is slowed down in memory. Each key (email + address, address, email or
// user) may fail a limited number of times inside one window, then gets 429 until the window
// ends. Counts belong to this process and a restart clears them.
const AUTH_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_THROTTLE_MAX_KEYS = 20000;
const LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS = 5;
const LOGIN_FAILURES_PER_ADDRESS = 20;
// Stops one account being guessed from many addresses.
const LOGIN_FAILURES_PER_EMAIL = 20;
const PASSWORD_FORGOT_REQUESTS_PER_ADDRESS = 5;
const PASSWORD_FORGOT_REQUESTS_PER_EMAIL = 3;
const PASSWORD_RESET_ATTEMPTS_PER_ADDRESS = 10;
const PASSWORD_CHANGE_FAILURES_PER_USER = 5;
const authThrottle = new Map();

function authThrottleEntry(key, now = Date.now()) {
  const entry = authThrottle.get(key);
  if (!entry) return null;
  if (entry.resetAt > now) return entry;
  authThrottle.delete(key);
  return null;
}

// limits is a list of [key, allowed count]. Throws 429 when any key has used its allowance.
function assertAuthThrottle(limits, now = Date.now()) {
  let retryMs = 0;
  for (const [key, allowed] of limits) {
    const entry = authThrottleEntry(key, now);
    if (entry && entry.count >= allowed) retryMs = Math.max(retryMs, entry.resetAt - now);
  }
  if (!retryMs) return;
  const minutes = Math.max(1, Math.ceil(retryMs / 60000));
  const error = statusError(429, `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  error.headers = { 'Retry-After': String(Math.ceil(retryMs / 1000)) };
  throw error;
}

function recordAuthThrottle(limits, now = Date.now()) {
  for (const [key] of limits) {
    const entry = authThrottleEntry(key, now);
    if (entry) entry.count += 1;
    else authThrottle.set(key, { count: 1, resetAt: now + AUTH_THROTTLE_WINDOW_MS });
  }
  if (authThrottle.size <= AUTH_THROTTLE_MAX_KEYS) return;
  for (const [key, entry] of authThrottle) {
    if (entry.resetAt <= now) authThrottle.delete(key);
  }
  // Still full of live keys: drop the oldest so the map cannot grow without limit.
  for (const key of authThrottle.keys()) {
    if (authThrottle.size <= AUTH_THROTTLE_MAX_KEYS) break;
    authThrottle.delete(key);
  }
}

function loginThrottleLimits(req, email) {
  const address = requestIp(req);
  return [
    [`login:${email}|${address}`, LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS],
    [`login-address:${address}`, LOGIN_FAILURES_PER_ADDRESS],
    [`login-email:${email}`, LOGIN_FAILURES_PER_EMAIL]
  ];
}

function safeEqualText(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

// POST /api/password. The session user is a copy, so the password is checked and written
// against the stored user. Every session of that user is signed out afterwards.
async function changeOwnPassword(user, body) {
  if (isDeveloperEmail(user.email) && developerPasswordConfigured()) {
    throw statusError(400, 'The developer account password is set by DEV_PANEL_PASSWORD on the server. Change it there.');
  }
  const currentPassword = String(body.current_password || '');
  const newPassword = String(body.new_password || '');
  if (newPassword.length < PASSWORD_MIN_LENGTH) throw statusError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (newPassword.length > PASSWORD_MAX_LENGTH) throw statusError(400, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  const limits = [[`password-change:${user.id}`, PASSWORD_CHANGE_FAILURES_PER_USER]];
  assertAuthThrottle(limits);
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const stored = await postgresQuery(`select password_hash from ${table} where id = $1 limit 1`, [user.id]);
    if (!verifyPassword(currentPassword, stored.rows[0]?.password_hash)) {
      recordAuthThrottle(limits);
      throw statusError(400, 'Current password is incorrect.');
    }
    await postgresQuery(
      `update ${table} set password_hash = $2, temporary_password = null, password_changed_at = now(), updated_at = now() where id = $1`,
      [user.id, hashPassword(newPassword)]
    );
    await clearUserSessions(user.id);
    authThrottle.delete(limits[0][0]);
    dbCache = null;
    return { ok: true };
  }
  const db = await loadDb();
  const target = db.users.find(item => item.id === user.id);
  if (!target || !verifyPassword(currentPassword, target.password_hash)) {
    recordAuthThrottle(limits);
    throw statusError(400, 'Current password is incorrect.');
  }
  target.password_hash = hashPassword(newPassword);
  target.password_changed_at = new Date().toISOString();
  addAudit(db, target, 'Password changed', 'user', target.email);
  await saveDb(db);
  await clearUserSessions(target.id);
  authThrottle.delete(limits[0][0]);
  return { ok: true };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function resetUrl(req, token) {
  return `${originFor(req)}/#/reset-password?token=${encodeURIComponent(token)}`;
}

function mailFromAddress(db) {
  return process.env.MAIL_FROM || process.env.GMAIL_SMTP_USER || db.gmail?.email || 'no-reply@kentbusinesscollege.local';
}

function mailFromName() {
  return process.env.MAIL_FROM_NAME || 'Kent Business College';
}

function encodeMailAddress(name, email) {
  return `"${String(name).replace(/"/g, '\\"')}" <${email}>`;
}

function rawEmail({ from, to, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit'
  ];
  return `${headers.join('\r\n')}\r\n\r\n${text}`;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sendGmailApiMail(db, message) {
  if (!gmailConfigured() || !db.gmail?.connected) throw new Error('Gmail API sending is not connected.');
  const accessToken = await gmailAccessToken(db);
  await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64Url(message) })
  });
}

function gmailSendScopeError(error) {
  return /insufficient authentication scopes|insufficient.*scope|gmail\.send/i.test(String(error?.message || ''));
}

function emailDeliveryError(apiError, smtpError) {
  if (gmailSendScopeError(apiError) && /smtp.*not configured/i.test(String(smtpError?.message || ''))) {
    return new Error('Gmail needs to be reconnected with send permission. Open Settings, connect Gmail again, and approve Gmail send access. Or configure GMAIL_SMTP_USER and GMAIL_SMTP_PASS in .env for SMTP fallback.');
  }
  return new Error(`${apiError.message} ${smtpError.message}`);
}

function smtpConfigured() {
  return Boolean(process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_PASS);
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve({ code: Number(last.slice(0, 3)), text: buffer });
      }
    };
    const onError = error => {
      socket.off('data', onData);
      reject(error);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function smtpCommand(socket, command, expected = [250]) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  if (!expected.includes(response.code)) throw new Error(`SMTP error ${response.code}: ${response.text.trim()}`);
  return response;
}

async function sendSmtpMail({ fromEmail, fromName, to, subject, text }) {
  if (!smtpConfigured()) throw new Error('Gmail SMTP is not configured.');
  const socket = tls.connect(465, process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com', { servername: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com' });
  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
  try {
    await smtpCommand(socket, '', [220]);
    await smtpCommand(socket, `EHLO ${process.env.SMTP_HELO || 'localhost'}`);
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(process.env.GMAIL_SMTP_USER).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(process.env.GMAIL_SMTP_PASS).toString('base64'), [235]);
    await smtpCommand(socket, `MAIL FROM:<${fromEmail}>`);
    await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);
    const message = rawEmail({ from: encodeMailAddress(fromName, fromEmail), to, subject, text }).replace(/^\./gm, '..');
    await smtpCommand(socket, `${message}\r\n.`, [250]);
    await smtpCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

async function sendPasswordResetMail(db, req, user, token) {
  const link = resetUrl(req, token);
  const fromEmail = mailFromAddress(db);
  const fromName = mailFromName();
  const subject = 'Reset your Kent Business College password';
  const text = [
    `Hi ${user.name || 'there'},`,
    '',
    'Use this link to reset your Kent Business College password:',
    link,
    '',
    'This link expires in 30 minutes. If you did not request this, you can ignore this email.'
  ].join('\n');
  const message = rawEmail({ from: encodeMailAddress(fromName, fromEmail), to: user.email, subject, text });
  try {
    await sendGmailApiMail(db, message);
  } catch (apiError) {
    await sendSmtpMail({ fromEmail, fromName, to: user.email, subject, text }).catch(smtpError => {
      throw emailDeliveryError(apiError, smtpError);
    });
  }
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, temporary_password, __auth_ms, ...safe } = user;
  return safe;
}

function permissions(role) {
  const canonicalRole = canonicalWorkspaceRole(role);
  return {
    sales: ['sales', 'manager', 'admissions', 'qa', 'director', 'admin'].includes(canonicalRole),
    review: ['manager', 'admissions', 'qa', 'director', 'admin'].includes(canonicalRole),
    admin: ['admin', 'director'].includes(canonicalRole)
  };
}

function permissionsForUser(user) {
  const developer = canUseDeveloperDashboard(null, user);
  if (developer) return { sales: true, review: true, admin: true, developer: true };
  const canonicalRole = canonicalWorkspaceRole(user?.role);
  if (canonicalRole === 'manager' || canonicalRole === 'admin') return { sales: true, review: true, admin: false, developer: false };
  return { sales: true, review: false, admin: false, developer: false };
}

function canonicalWorkspaceRole(role) {
  const key = String(role || 'member').trim().toLowerCase();
  const roles = {
    developer: 'admin',
    dev: 'admin',
    admin: 'admin',
    director: 'admin',
    monitor: 'manager',
    minitor: 'manager',
    manager: 'manager',
    admissions: 'manager',
    qa: 'manager',
    member: 'sales',
    sales: 'sales'
  };
  return roles[key] || key;
}

function normalizeWorkspaceRole(role) {
  const canonical = canonicalWorkspaceRole(role);
  return ['admin', 'manager', 'sales'].includes(canonical) ? canonical : '';
}

function workspaceRoleLabel(role) {
  const canonical = canonicalWorkspaceRole(role);
  if (canonical === 'admin') return 'Developer';
  if (canonical === 'manager') return 'Monitor';
  return 'Member';
}

function isConfiguredDeveloperUser(user) {
  return Boolean(user && isDeveloperEmail(user.email));
}

function visibleWorkspaceRoleKey(user) {
  if (isConfiguredDeveloperUser(user)) return 'developer';
  return canonicalWorkspaceRole(user?.role) === 'sales' ? 'member' : 'monitor';
}

function fullName(item) {
  return `${item.first_name} ${item.last_name}`;
}

function nextId(prefix, groups) {
  const values = groups.flat().filter(Boolean);
  const max = values.reduce((highest, item) => {
    const id = typeof item === 'string' ? item : item.id;
    const match = String(id || '').match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${prefix}-${max + 1}`;
}

function numericHash(value, attempt = 0) {
  const input = `${String(value || '').trim().toLowerCase()}#${attempt}`;
  const hex = crypto.createHash('sha256').update(input).digest('hex').slice(0, 15);
  return String((BigInt(`0x${hex}`) % 900000000000n) + 100000000000n);
}

function emailLeadId(email, attempt = 0) {
  return numericHash(normalizeEmail(email), attempt);
}

function splitQuotedEmailBody(body) {
  const lines = String(body || '').split(/\r?\n/);
  const parts = [];
  let current = [];
  lines.forEach((line, index) => {
    const divider = /^\s*[-_=]{6,}\s*$/.test(line);
    const nextHasHeader = lines.slice(index + 1, index + 7).some(next => /^\s*(From|Sent|To|Subject|Date):\s+/i.test(next));
    if (divider && current.some(item => item.trim()) && nextHasHeader) {
      parts.push(current.join('\n').trim());
      current = [];
      return;
    }
    current.push(line);
  });
  if (current.some(item => item.trim())) parts.push(current.join('\n').trim());
  return parts.length ? parts : [String(body || '').trim()];
}

function companyMailboxEmails(db) {
  return [db.gmail?.email, process.env.MAIL_FROM, process.env.GMAIL_SMTP_USER, process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com']
    .filter(Boolean)
    .map(email => normalizeEmail(email));
}

function isCompanySender(db, email) {
  const sender = normalizeEmail(email.email);
  return companyMailboxEmails(db).includes(sender) || /@(kentbusinesscollege\.org|pathway\.demo)$/i.test(sender);
}

function emailIsInboundExternal(db, email) {
  return email.direction !== 'outbound' && !isCompanySender(db, email);
}

function emailIsTrashed(email) {
  return Boolean(email?.trashed_at || email?.dashboard_folder === 'trash' || (email?.gmail_labels || []).includes('TRASH'));
}

function emailNeedsResponse(db, email) {
  return !emailIsTrashed(email) && emailIsInboundExternal(db, email) && !email.response_at;
}

function uniqueEmailLabelValues(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function emailIsUnread(email) {
  return (email.gmail_labels || []).includes('UNREAD') || (email.gmail_label_names || []).includes('Unread') || email.is_read === false;
}

function emailDueAt(email) {
  const received = new Date(email.received_at || email.date || 0);
  return Number.isNaN(received.getTime()) ? email.due_at : new Date(received.getTime() + EMAIL_RESPONSE_SLA_MS).toISOString();
}

function emailServerLabelTexts(email) {
  if (emailIsTrashed(email)) return ['Trash'];
  const gmailLabels = uniqueEmailLabelValues([
    ...(email.gmail_label_names || []),
    ...(email.gmail_labels || []).map(label => GMAIL_SYSTEM_LABELS[label] || '')
  ]).filter(label => !/^category_/i.test(label) && !/^Label_[A-Za-z0-9_-]+$/i.test(label) && label !== 'Trash');
  if (gmailLabels.length) return gmailLabels;
  const text = [email.subject, email.body, email.snippet].join(' ').toLowerCase();
  const labels = [];
  if (/zoho.*contracts?|contracts?.*zoho/.test(text)) {
    labels.push('Enrolled');
    labels.push('Zoho');
  } else if (/zoho|zoho crm/.test(text)) {
    labels.push('Zoho');
  }
  if (/eventbrite|attendee|attendance|webinar|open day|booking|bookings/.test(text)) labels.push('Events');
  if (/contract|agreement|sign|commitment/.test(text)) labels.push('Contract Matter');
  if (/das|digital apprenticeship service/.test(text)) labels.push('DAS Matter');
  if (/aptem|lrs|learning/.test(text)) labels.push('Aptem Matter');
  if (!labels.length) labels.push(email.response_at ? 'Resolved' : 'Inbox');
  return labels;
}

function parseEmailFilterDay(value, end = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const display = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const date = iso
    ? new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`)
    : display
      ? new Date(`${display[3]}-${display[2]}-${display[1]}T00:00:00.000Z`)
      : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (end) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function emailFilterDateValue(email, filters) {
  return filters.dateField === 'due' ? emailDueAt(email) : (email.received_at || email.date || email.created_at);
}

function emailMatchesFilters(db, email, filters) {
  const status = filters.status || 'All';
  const trashed = emailIsTrashed(email);
  if (status === 'Trash' && !trashed) return false;
  if (status !== 'Trash' && trashed) return false;
  if (status === 'Sent' && email.direction !== 'outbound') return false;
  if (!['Sent', 'All', 'Trash'].includes(status) && email.direction === 'outbound') return false;
  const needsResponse = emailNeedsResponse(db, email);
  if (status === 'Unanswered' && !needsResponse) return false;
  if (status === 'Unread' && !(needsResponse && emailIsUnread(email))) return false;
  if (status === 'Seen, no reply' && !(needsResponse && !emailIsUnread(email))) return false;
  if (status === 'Resolved' && needsResponse) return false;
  const due = new Date(emailDueAt(email));
  if (status === 'Overdue' && !(needsResponse && !Number.isNaN(due.getTime()) && due < new Date())) return false;
  const labels = emailServerLabelTexts(email);
  if (filters.label && filters.label !== 'All' && !labels.includes(filters.label)) return false;
  const dayStart = parseEmailFilterDay(filters.day);
  if (dayStart) {
    const dayEnd = parseEmailFilterDay(filters.day, true);
    const date = new Date(emailFilterDateValue(email, filters) || 0);
    if (Number.isNaN(date.getTime()) || date < dayStart || date > dayEnd) return false;
  }
  const query = String(filters.search || '').trim().toLowerCase();
  if (query) {
    const haystack = [email.first_name, email.last_name, email.email, email.from, email.subject, email.body, email.snippet, email.owner, ...labels].join(' ').toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function compareEmailsForFilters(a, b, filters) {
  const dateA = new Date(emailFilterDateValue(a, filters) || 0);
  const dateB = new Date(emailFilterDateValue(b, filters) || 0);
  if (filters.sort === 'oldest') return dateA - dateB || String(a.id).localeCompare(String(b.id));
  if (filters.sort === 'name') return `${a.first_name || ''} ${a.last_name || ''}`.localeCompare(`${b.first_name || ''} ${b.last_name || ''}`) || dateB - dateA;
  if (filters.sort === 'name-desc') return `${b.first_name || ''} ${b.last_name || ''}`.localeCompare(`${a.first_name || ''} ${a.last_name || ''}`) || dateB - dateA;
  if (filters.sort === 'due-soon') return new Date(emailDueAt(a) || 0) - new Date(emailDueAt(b) || 0) || dateB - dateA;
  return dateB - dateA || String(a.id).localeCompare(String(b.id));
}

function isExcludedLeadSender(email, firstName = '', lastName = '') {
  const address = normalizeEmail(email);
  const name = `${firstName} ${lastName}`.trim().toLowerCase();
  return address.startsWith('alice@') || address.includes('alicepearce@') || /\balice\b/.test(name);
}

function addLeadSource(lead, source, detail = {}) {
  if (!source) return;
  lead.source_history ||= [];
  if (!lead.source_history.some(item => item.source === source && item.provider_id === detail.provider_id)) {
    lead.source_history.push({ source, provider_id: detail.provider_id || '', captured_at: detail.captured_at || new Date().toISOString(), ...detail });
  }
}

function normalizeProgrammeText(value = '') {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ensureProgrammeCatalog(db) {
  db.programmes ||= [];
  const demoProgrammes = new Set(['p1:Digital Marketing', 'p2:Business Administration', 'p3:Software Development']);
  db.programmes = db.programmes.filter(item => !demoProgrammes.has(`${item.id}:${item.name}`));
  for (const programme of PROGRAMME_CATALOG) {
    const existing = db.programmes.find(item => item.id === programme.id || normalizeProgrammeText(item.name) === normalizeProgrammeText(programme.name));
    if (existing) Object.assign(existing, { ...programme, ...existing, id: programme.id, name: programme.name, level: programme.level });
    else db.programmes.push({ ...programme });
  }
  return db.programmes;
}

function programmeById(db, id) {
  ensureProgrammeCatalog(db);
  return db.programmes.find(item => item.id === id) || null;
}

function unknownProgramme(db) {
  return programmeById(db, 'pr-unknown') || PROGRAMME_CATALOG[PROGRAMME_CATALOG.length - 1];
}

function programmeForText(db, text = '') {
  ensureProgrammeCatalog(db);
  const value = normalizeProgrammeText(text);
  if (!value) return unknownProgramme(db);
  if (/marketing manager|level 6.*marketing|marketing.*level 6/.test(value)) return programmeById(db, 'pr-marketing-manager-l6');
  if (/cim.*(diploma|level 6)|diploma.*marketing/.test(value)) return programmeById(db, 'pr-cim-l6');
  if (/marketing executive|level 4.*marketing executive/.test(value)) return programmeById(db, 'pr-marketing-exec-l4');
  if (/cim.*(certificate|level 4)|professional and digital marketing|digital marketing certificate/.test(value)) return programmeById(db, 'pr-cim-l4');
  if (/strategic sales/.test(value)) return programmeById(db, 'pr-strategic-sales-dm');
  if (/\bpmo\b/.test(value)) return programmeById(db, 'pr-pmo-apm');
  if (/project control/.test(value)) return programmeById(db, 'pr-project-control-l6');
  if (/chpp|chartered project professional|apm chartered/.test(value)) return programmeById(db, 'pr-apm-chpp');
  if (/pmp|project management|ai dashboards|ai in projects/.test(value)) return programmeById(db, 'pr-pmp-ai');
  if (/d2n2|skills bootcamp|bootcamp/.test(value)) return programmeById(db, 'pr-skills-bootcamp');
  if (/ipc|masterclass|stephen jenner|portfolio/.test(value)) return programmeById(db, 'pr-ipc-masterclass');
  if (/networking/.test(value)) return programmeById(db, 'pr-business-networking');
  if (/recruitment|upskill|employer|talent/.test(value)) return programmeById(db, 'pr-funded-recruitment');
  return unknownProgramme(db);
}

function isPlaceholderProgramme(value = {}) {
  const name = normalizeProgrammeText(value.programme || value.name);
  return !value.programme_id ||
    value.programme_id === 'p1' ||
    value.programme_id === 'pr-unknown' ||
    (name === 'digital marketing' && String(value.level || '').toLowerCase() === 'level 3') ||
    name === 'programme not identified';
}

function mergeLeadData(target, incoming) {
  if (incoming.programme_id && (!target.programme_id || (isPlaceholderProgramme(target) && !isPlaceholderProgramme(incoming)))) {
    target.programme_id = incoming.programme_id;
    target.programme = incoming.programme;
    target.level = incoming.level;
  }
  for (const key of ['first_name', 'last_name', 'email', 'employer', 'phone', 'city', 'owner_id', 'owner', 'priority', 'contact_permission']) {
    if (!target[key] && incoming[key]) target[key] = incoming[key];
  }
  for (const key of ['eventbrite_attendee_id', 'meta_lead_id', 'meta_form_id', 'meta_form_name', 'apollo_person_id', 'zoho_record_id', 'zoho_module']) {
    if (incoming[key] && !target[key]) target[key] = incoming[key];
  }
  if (incoming.created_at && (!target.created_at || new Date(incoming.created_at) < new Date(target.created_at))) {
    target.created_at = incoming.created_at;
    target.source_first_touch = incoming.source_first_touch || target.source_first_touch;
  }
  if (incoming.source_lead_capture) target.source_lead_capture = incoming.source_lead_capture;
  addLeadSource(target, incoming.source_lead_capture || incoming.source_first_touch, {
    provider_id: incoming.gmail_message_id || incoming.eventbrite_attendee_id || incoming.meta_lead_id || incoming.apollo_person_id || incoming.zoho_record_id || '',
    captured_at: incoming.created_at
  });
  target.full_name = fullName(target);
  return target;
}

function findMatchingLead(db, incoming) {
  const email = normalizeEmail(incoming.email);
  if (incoming.id) {
    const byId = db.leads.find(item => item.id === incoming.id);
    if (byId) return byId;
  }
  if (incoming.meta_lead_id) {
    const byMeta = db.leads.find(item => item.meta_lead_id === incoming.meta_lead_id);
    if (byMeta) return byMeta;
  }
  if (incoming.eventbrite_attendee_id) {
    const byEventbrite = db.leads.find(item => item.eventbrite_attendee_id === incoming.eventbrite_attendee_id);
    if (byEventbrite) return byEventbrite;
  }
  if (incoming.apollo_person_id) {
    const byApollo = db.leads.find(item => item.apollo_person_id === incoming.apollo_person_id);
    if (byApollo) return byApollo;
  }
  if (incoming.zoho_record_id) {
    const byZoho = db.leads.find(item => item.zoho_record_id === incoming.zoho_record_id);
    if (byZoho) return byZoho;
  }
  if (email) return db.leads.find(item => normalizeEmail(item.email) === email) || null;
  return null;
}

function leadIdForEmail(db, email, ignoreLead = null) {
  const normalized = normalizeEmail(email);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = emailLeadId(normalized, attempt);
    const existing = db.leads.find(item => item !== ignoreLead && item.id === id && normalizeEmail(item.email) !== normalized);
    if (!existing) return id;
  }
  return emailLeadId(`${normalized}:${Date.now()}`);
}

function ensureLeadRecord(db, user, incoming, options = {}) {
  const email = normalizeEmail(incoming.email);
  if (isExcludedLeadSender(email, incoming.first_name, incoming.last_name)) return { lead: null, created: false, excluded: true };
  const programme = programmeById(db, incoming.programme_id) || programmeForText(db, [incoming.programme, incoming.level, incoming.programme_text].filter(Boolean).join(' '));
  const owner = db.users.find(item => item.id === incoming.owner_id) || user || db.users[0];
  const normalized = {
    id: incoming.id,
    first_name: incoming.first_name || nameParts('', email).first_name,
    last_name: incoming.last_name || nameParts('', email).last_name,
    full_name: `${incoming.first_name || nameParts('', email).first_name} ${incoming.last_name || nameParts('', email).last_name}`,
    programme: programme?.name || incoming.programme || 'Programme not identified',
    programme_id: programme?.id || incoming.programme_id || 'pr-unknown',
    email,
    employer: incoming.employer || '',
    phone: incoming.phone || '',
    city: incoming.city || '',
    owner: owner?.name || incoming.owner || 'Sales',
    owner_id: owner?.id || incoming.owner_id || 'local-user',
    stage: incoming.stage || 'New lead',
    priority: incoming.priority || 'P2',
    source_first_touch: incoming.source_first_touch || incoming.source_lead_capture || 'Email',
    source_lead_capture: incoming.source_lead_capture || incoming.source_first_touch || 'Email',
    contact_permission: incoming.contact_permission || 'Unknown',
    level: programme?.level || incoming.level || 'Needs review',
    person_id: incoming.person_id,
    created_at: incoming.created_at || new Date().toISOString(),
    next_action_at: incoming.next_action_at || null,
    eventbrite_attendee_id: incoming.eventbrite_attendee_id,
    meta_lead_id: incoming.meta_lead_id,
    meta_form_id: incoming.meta_form_id,
    meta_form_name: incoming.meta_form_name,
    apollo_person_id: incoming.apollo_person_id,
    zoho_record_id: incoming.zoho_record_id,
    zoho_module: incoming.zoho_module,
    gmail_message_id: incoming.gmail_message_id
  };
  const existing = findMatchingLead(db, normalized);
  if (existing) return { lead: mergeLeadData(existing, normalized), created: false, excluded: false };
  const id = leadIdForEmail(db, email);
  const lead = {
    ...normalized,
    id,
    person_id: id
  };
  addLeadSource(lead, lead.source_lead_capture, {
    provider_id: lead.gmail_message_id || lead.eventbrite_attendee_id || lead.meta_lead_id || lead.apollo_person_id || lead.zoho_record_id || '',
    captured_at: lead.created_at
  });
  delete lead.gmail_message_id;
  db.leads.push(lead);
  if (options.taskTitle && !db.tasks.some(task => task.lead_id === lead.id && task.title === options.taskTitle && task.status === 'Open')) {
    db.tasks.push({
      id: nextId('T', [db.tasks]),
      title: options.taskTitle,
      lead_id: lead.id,
      kind: options.taskKind || 'Follow-up',
      status: 'Open',
      created_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 86400000).toISOString(),
      priority: lead.priority,
      owner_id: lead.owner_id
    });
  }
  return { lead, created: true, excluded: false };
}

function ensureLeadForEmailSender(db, user, email) {
  const address = normalizeEmail(email.email);
  if (!address || !emailIsInboundExternal(db, email)) return null;
  const result = ensureLeadRecord(db, user, {
    first_name: email.first_name,
    last_name: email.last_name,
    email: address,
    source_first_touch: 'Email',
    source_lead_capture: 'Email',
    created_at: email.received_at,
    gmail_message_id: email.gmail_message_id
  });
  if (result.lead) email.lead_id = result.lead.id;
  return result.lead;
}

function promoteEmailSendersToLeads(db, user) {
  let created = 0, linked = 0;
  for (const email of db.emails || []) {
    const beforeLeadId = email.lead_id;
    const beforeCount = db.leads.length;
    const lead = ensureLeadForEmailSender(db, user, email);
    if (!lead) continue;
    if (db.leads.length > beforeCount) created += 1;
    else if (!beforeLeadId && email.lead_id) linked += 1;
  }
  if (created || linked) addAudit(db, user, 'Email senders promoted to leads', 'integration', 'Gmail', `${created} created, ${linked} linked`);
  return { created, linked };
}

function relinkLeadReferences(db, fromId, toId) {
  for (const collection of [db.tasks || [], db.emails || [], db.applications || []]) {
    collection.forEach(item => {
      if (item.lead_id === fromId) item.lead_id = toId;
    });
  }
  for (const event of db.events || []) {
    (event.attendees || []).forEach(attendee => {
      if (attendee.lead_id === fromId) attendee.lead_id = toId;
    });
  }
  for (const item of db.audit || []) {
    if (item.entity === 'lead' && item.entity_id === fromId) item.entity_id = toId;
  }
  for (const item of db.attribution || []) {
    if (item.id === fromId) item.id = toId;
    if (item.lead_id === fromId) item.lead_id = toId;
  }
}

function cleanupExcludedLeads(db) {
  const excludedIds = new Set();
  db.leads = (db.leads || []).filter(lead => {
    const excluded = isExcludedLeadSender(lead.email, lead.first_name, lead.last_name);
    if (excluded) excludedIds.add(lead.id);
    return !excluded;
  });
  if (!excludedIds.size) return 0;
  for (const email of db.emails || []) {
    if (excludedIds.has(email.lead_id)) email.lead_id = '';
  }
  for (const event of db.events || []) {
    (event.attendees || []).forEach(attendee => {
      if (excludedIds.has(attendee.lead_id)) attendee.lead_id = '';
    });
  }
  db.tasks = (db.tasks || []).filter(task => !excludedIds.has(task.lead_id));
  db.applications = (db.applications || []).filter(app => !excludedIds.has(app.lead_id));
  db.attribution = (db.attribution || []).filter(item => !excludedIds.has(item.id) && !excludedIds.has(item.lead_id));
  return excludedIds.size;
}

function dedupeLeadRecords(db, user) {
  const removedExcluded = cleanupExcludedLeads(db);
  const byEmail = new Map();
  const duplicates = new Set();
  let migrated = 0;
  let merged = 0;
  for (const lead of db.leads || []) {
    const email = normalizeEmail(lead.email);
    const identity = email || `${lead.id || lead.person_id || fullName(lead)}@lead.local`;
    const id = leadIdForEmail(db, identity, lead);
    if (lead.id !== id) {
      if (lead.id) relinkLeadReferences(db, lead.id, id);
      lead.id = id;
      migrated += 1;
    }
    if (lead.person_id !== id) {
      lead.person_id = id;
      migrated += 1;
    }
    if (!email) {
      lead.full_name = fullName(lead);
      continue;
    }
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, lead);
      continue;
    }
    mergeLeadData(existing, lead);
    relinkLeadReferences(db, lead.id, existing.id);
    duplicates.add(lead);
    merged += 1;
  }
  if (duplicates.size) db.leads = db.leads.filter(lead => !duplicates.has(lead));
  for (const email of db.emails || []) {
    if (email.lead_id && db.leads.some(lead => lead.id === email.lead_id)) continue;
    const lead = db.leads.find(item => normalizeEmail(item.email) === normalizeEmail(email.email));
    if (lead && !isExcludedLeadSender(email.email, email.first_name, email.last_name)) email.lead_id = lead.id;
  }
  if (removedExcluded || merged || migrated) addAudit(db, user, 'Lead identity cleanup', 'lead', 'dedupe', `${merged} duplicate lead${merged === 1 ? '' : 's'} merged, ${migrated} ID field${migrated === 1 ? '' : 's'} migrated, ${removedExcluded} excluded`);
  return { merged, migrated, removed_excluded: removedExcluded };
}

function validLeadIdSet(db) {
  return new Set((db.leads || []).map(lead => lead.id).filter(Boolean));
}

function leadByContact(db, { email = '', phone = '' } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    const byEmail = (db.leads || []).find(lead => normalizeEmail(lead.email) === normalizedEmail);
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = (db.leads || []).find(lead => samePhone(lead.phone, phone));
    if (byPhone) return byPhone;
  }
  return null;
}

function eventSourceName(event = {}, attendee = {}) {
  if (event.zoom_meeting_id || event.zoom_meeting_uuid || attendee.zoom_source || String(event.location || '').toLowerCase() === 'zoom') return 'Zoom';
  if (event.eventbrite_event_id || attendee.eventbrite_attendee_id) return 'Eventbrite';
  return 'Event';
}

function leadInputFromAttendee(db, event = {}, attendee = {}) {
  const source = eventSourceName(event, attendee);
  const email = normalizeEmail(attendee.email);
  const fallbackName = [attendee.first_name, attendee.last_name].filter(Boolean).join(' ') || attendee.name || `${source} attendee`;
  const parts = nameParts(fallbackName, email || `${attendee.id || numericHash(fallbackName)}@${source.toLowerCase()}.local`);
  const programme = programmeForEvent(db, event.name || event.description || event.campaign || '');
  return {
    first_name: attendee.first_name || parts.first_name || source,
    last_name: attendee.last_name || parts.last_name || 'Attendee',
    programme_id: programme.id,
    email: email || `${attendee.id || numericHash(`${event.id || event.name}:${fallbackName}`)}@${source.toLowerCase()}.local`,
    employer: attendee.employer || attendee.company || '',
    phone: attendee.phone || '',
    city: attendee.city || '',
    stage: 'New lead',
    priority: 'P2',
    source_first_touch: source,
    source_lead_capture: source,
    contact_permission: attendee.contact_permission || 'Unknown',
    created_at: attendee.created_at || attendee.attended_at || event.start_at || event.created_at || new Date().toISOString(),
    eventbrite_attendee_id: attendee.eventbrite_attendee_id || ''
  };
}

function reconcileImportedData(db, user, options = {}) {
  db.leads ||= [];
  db.emails ||= [];
  db.events ||= [];
  db.zoom ||= {};
  db.zoom.calls ||= [];
  const existingLeadIds = validLeadIdSet(db);
  const summary = { leads_created: 0, leads_updated: 0, emails_linked: 0, attendees_linked: 0, calls_linked: 0, unlinked_attendees: 0, unlinked_calls: 0 };

  for (const email of db.emails || []) {
    const beforeLeadId = email.lead_id;
    const beforeCount = db.leads.length;
    const lead = ensureLeadForEmailSender(db, user, email);
    if (!lead) continue;
    if (db.leads.length > beforeCount) summary.leads_created += 1;
    if (!beforeLeadId && email.lead_id) summary.emails_linked += 1;
  }

  for (const event of db.events || []) {
    for (const attendee of event.attendees || []) {
      if (attendee.lead_id && existingLeadIds.has(attendee.lead_id)) {
        const lead = db.leads.find(item => item.id === attendee.lead_id);
        addLeadSource(lead, eventSourceName(event, attendee), {
          provider_id: attendee.eventbrite_attendee_id || attendee.zoom_participant_id || attendee.id || event.id || '',
          captured_at: attendee.created_at || attendee.attended_at || event.start_at
        });
        continue;
      }
      const contactLead = leadByContact(db, attendee);
      if (contactLead) {
        attendee.lead_id = contactLead.id;
        addLeadSource(contactLead, eventSourceName(event, attendee), {
          provider_id: attendee.eventbrite_attendee_id || attendee.zoom_participant_id || attendee.id || event.id || '',
          captured_at: attendee.created_at || attendee.attended_at || event.start_at
        });
        summary.attendees_linked += 1;
        continue;
      }
      const canCreateLead = normalizeEmail(attendee.email) || attendee.phone || attendee.first_name || attendee.last_name || attendee.name;
      if (!canCreateLead) {
        summary.unlinked_attendees += 1;
        continue;
      }
      const beforeCount = db.leads.length;
      const result = ensureLeadRecord(db, user, leadInputFromAttendee(db, event, attendee), {
        taskTitle: `Follow up after ${event.name || eventSourceName(event, attendee)}`,
        taskKind: 'Follow-up'
      });
      if (result.lead) {
        attendee.lead_id = result.lead.id;
        attendee.first_name ||= result.lead.first_name;
        attendee.last_name ||= result.lead.last_name;
        attendee.email ||= result.lead.email;
        attendee.phone ||= result.lead.phone;
        if (db.leads.length > beforeCount) summary.leads_created += 1;
        else summary.leads_updated += 1;
        summary.attendees_linked += 1;
      } else {
        summary.unlinked_attendees += 1;
      }
    }
  }

  for (const [index, storedCall] of (db.zoom.calls || []).entries()) {
    const call = hydrateZoomStoredCall(db, storedCall);
    db.zoom.calls[index] = call;
    if (call.lead_id && existingLeadIds.has(call.lead_id)) continue;
    const match = zoomCallLeadMatch(db, call);
    const lead = match.lead || leadByContact(db, { phone: call.caller_number }) || leadByContact(db, { phone: call.callee_number });
    if (lead) {
      call.lead_id = lead.id;
      call.lead_name = fullName(lead);
      call.matched_side ||= match.side || (samePhone(lead.phone, call.caller_number) ? 'caller' : samePhone(lead.phone, call.callee_number) ? 'callee' : '');
      call.matched_number ||= match.number || call.caller_number || call.callee_number || '';
      call.matched_source ||= 'CRM lead phone';
      addLeadSource(lead, 'Zoom Call', {
        provider_id: call.zoom_call_history_uuid || call.zoom_call_id || call.id || '',
        captured_at: call.started_at,
        phone: call.matched_number || '',
        direction: call.direction || '',
        matched_side: call.matched_side || '',
        account: call.zoom_account_label || call.zoom_account_id || '',
        owner: call.owner_name || ''
      });
      summary.calls_linked += 1;
    } else {
      summary.unlinked_calls += 1;
    }
  }

  const deduped = dedupeLeadRecords(db, user);
  summary.leads_merged = deduped.merged;
  summary.ids_migrated = deduped.migrated;
  const changed = summary.leads_created || summary.emails_linked || summary.attendees_linked || summary.calls_linked || summary.leads_merged || summary.ids_migrated;
  if (options.audit !== false && changed) {
    addAudit(db, user, 'Imported data reconciled', 'integration', 'all', `${summary.leads_created} leads created, ${summary.emails_linked} emails linked, ${summary.attendees_linked} attendees linked, ${summary.calls_linked} calls linked`);
  }
  return summary;
}

function scheduleIdentityCleanup(db, user) {
  if (identityCleanupRunning) return;
  identityCleanupRunning = true;
  const snapshot = cloneDb(db);
  const actor = user ? { ...user } : null;
  setImmediate(async () => {
    try {
      const promoted = promoteEmailSendersToLeads(snapshot, actor);
      const reconciled = reconcileImportedData(snapshot, actor, { audit: false });
      const deduped = dedupeLeadRecords(snapshot, actor);
      if (promoted.created || promoted.linked || reconciled.leads_created || reconciled.emails_linked || reconciled.attendees_linked || reconciled.calls_linked || deduped.merged || deduped.migrated || deduped.removed_excluded) await saveDb(snapshot);
    } catch (error) {
      console.error(`Lead identity cleanup failed: ${error.message}`);
    } finally {
      identityCleanupRunning = false;
    }
  });
}

function runIdentityCleanupInMemory(db, user) {
  // A bootstrap payload only contains the first page of every table. Writing it back
  // would delete every record outside that page, so partial workspaces are never saved.
  if (db && (db.__partial || db.__partial_load)) return false;
  const promoted = promoteEmailSendersToLeads(db, user);
  const reconciled = reconcileImportedData(db, user, { audit: false });
  const deduped = dedupeLeadRecords(db, user);
  const changed = Boolean(promoted.created || promoted.linked || reconciled.leads_created || reconciled.emails_linked || reconciled.attendees_linked || reconciled.calls_linked || deduped.merged || deduped.migrated || deduped.removed_excluded);
  if (changed) {
    dbCache = cloneDb(recalculate(db));
    scheduleIdentityCleanup(db, user);
  }
  return changed;
}

function recalculate(db) {
  db.users ||= initialUsers();
  // Temporary passwords are no longer stored as plain text: drop the ones older versions saved.
  for (const user of db.users) delete user.temporary_password;
  db.owners = db.users.map(publicUser);
  ensureProgrammeCatalog(db);
  db.sources ||= seedDatabase().sources;
  db.leads ||= [];
  db.tasks ||= [];
  db.emails ||= [];
  db.applications ||= [];
  db.events ||= [];
  db.audit ||= [];
  db.attribution ||= [];
  db.gmail ||= { connected: false, imported_message_ids: [] };
  db.eventbrite ||= { connected: false, imported_event_ids: [], imported_attendee_ids: [] };
  db.meta ||= { imported_lead_ids: [], imported_form_ids: [] };
  db.apollo ||= { imported_person_ids: [] };
  db.zoho ||= db.meta.zoho || { imported_record_ids: [] };
  db.zoom ||= db.meta.zoom || { imported_meeting_ids: [] };
  db.meta.apollo = db.apollo;
  db.meta.zoho = db.zoho;
  db.meta.zoom = db.zoom;
  if (!db.sources.includes('Meta')) db.sources.push('Meta');
  if (!db.sources.includes('Email')) db.sources.push('Email');
  if (!db.sources.includes('Apollo')) db.sources.push('Apollo');
  if (!db.sources.includes('Zoho CRM')) db.sources.push('Zoho CRM');
  const programmeById = new Map(db.programmes.map(item => [item.id, item]));
  const ownerById = new Map(db.users.map(item => [item.id, item]));
  const leadById = new Map(db.leads.map(lead => [lead.id, lead]));
  const openTaskByLead = new Map();
  for (const task of db.tasks) {
    if (task.status !== 'Open' || !task.lead_id) continue;
    const current = openTaskByLead.get(task.lead_id);
    if (!current || new Date(task.due_at || 0) < new Date(current.due_at || 0)) openTaskByLead.set(task.lead_id, task);
  }
  db.leads.forEach(lead => {
    const programme = programmeById.get(lead.programme_id);
    const owner = ownerById.get(lead.owner_id) || db.users[0];
    lead.full_name = fullName(lead);
    lead.programme = programme?.name || lead.programme;
    lead.level = programme?.level || lead.level;
    lead.owner = owner?.name || lead.owner;
    const open = openTaskByLead.get(lead.id);
    lead.next_action_at = open?.due_at || null;
  });
  db.tasks.forEach(task => {
    const lead = leadById.get(task.lead_id);
    if (lead) {
      task.first_name = lead.first_name;
      task.last_name = lead.last_name;
    }
  });
  const inactiveStages = new Set(['Enrolled', 'Lost', 'Not Eligible']);
  const sourceStats = new Map();
  let active = 0;
  for (const lead of uniqueLeadsByIdentity(db.leads)) {
    if (!inactiveStages.has(lead.stage)) active += 1;
    const source = lead.source_first_touch;
    if (!source) continue;
    const row = sourceStats.get(source) || { source, leads: 0, enrolled: 0 };
    row.leads += 1;
    if (lead.stage === 'Enrolled') row.enrolled += 1;
    sourceStats.set(source, row);
    for (const item of lead.source_history || []) {
      if (item.source && !db.sources.includes(item.source)) db.sources.push(item.source);
    }
  }
  db.stats = {
    active,
    applications: db.applications.length,
    enrolled: db.applications.filter(app => app.learner).length,
    overdue: db.tasks.filter(task => task.status === 'Open' && new Date(task.due_at) < new Date()).length,
    unanswered: db.emails.filter(email => emailNeedsResponse(db, email)).length
  };
  db.source_counts = [...new Set([...db.sources, ...sourceStats.keys()])]
    .map(source => sourceStats.get(source) || { source, leads: 0, enrolled: 0 })
    .filter(row => row.leads || row.enrolled);
  db.integrations = integrationStatuses(db);
  return db;
}

// Connection status per provider, from configuration and the stored integration state.
function integrationStatuses(db) {
  db.gmail ||= {};
  db.eventbrite ||= {};
  db.zoho ||= {};
  const gmailReady = gmailConfigured();
  const gmailNeedsReconnect = Boolean(db.gmail.reconnect_required || db.gmail.last_error);
  const gmailStatus = db.gmail.connected && !gmailNeedsReconnect ? 'Connected' : gmailReady ? 'Ready to connect' : 'Needs credentials';
  const gmailDetail = gmailNeedsReconnect ? 'Gmail access expired. Reconnect the mailbox from Settings.' : db.gmail.connected ? `Mailbox sync connected${db.gmail.email ? ` for ${db.gmail.email}` : ''}.` : gmailReady ? 'OAuth credentials are configured. Connect a mailbox from Settings.' : 'Add Gmail OAuth credentials to enable mailbox sync.';
  const eventbriteReady = eventbriteConfigured();
  const eventbriteTokenReady = eventbritePrivateTokenConfigured();
  const eventbriteConnected = db.eventbrite.connected || eventbriteTokenReady;
  const eventbriteStatus = eventbriteConnected ? 'Connected' : eventbriteReady ? 'Ready to connect' : 'Needs credentials';
  const eventbriteDetail = eventbriteConnected ? `Eventbrite sync connected${db.eventbrite.name ? ` for ${db.eventbrite.name}` : eventbriteTokenReady ? ' by private token' : ''}.` : eventbriteReady ? 'OAuth credentials are configured. Connect Eventbrite from Settings.' : 'Add Eventbrite credentials to enable event sync.';
  const metaReady = metaConfigured();
  const metaStatus = metaReady ? 'Connected' : 'Needs credentials';
  const metaDetail = metaReady ? `Meta Lead Ads sync is configured for the configured page.` : 'Add Meta Lead Ads credentials to enable lead sync.';
  const apolloReady = apolloConfigured();
  const apolloStatus = apolloReady ? 'Connected' : 'Needs credentials';
  const apolloDetail = apolloReady ? 'Apollo people search is configured.' : 'Add Apollo credentials to enable prospect sync.';
  const zohoStatusState = zohoConnectionDiagnostics({ headers: {}, socket: {} }, db);
  const zohoReady = zohoStatusState.configured;
  const zohoConnected = zohoStatusState.connected;
  const zohoStatus = zohoConnected ? 'Connected' : zohoStatusState.reauthorizationRequired ? 'Reconnect required' : zohoReady ? 'Ready to connect' : 'Needs credentials';
  const zohoDetail = zohoConnected ? `Zoho CRM sync connected${db.zoho.email ? ` for ${db.zoho.email}` : ''}.` : zohoStatusState.reauthorizationRequired ? 'Zoho authorization is not durable. Reconnect Zoho and approve offline access.' : zohoReady ? 'OAuth credentials are configured. Connect Zoho CRM from Settings.' : 'Add Zoho CRM OAuth credentials to enable module sync.';
  const zoomReady = zoomConfigured();
  const zoomStatus = zoomReady ? 'Connected' : 'Needs credentials';
  const zoomAccountCount = zoomAccounts().length;
  const zoomDetail = zoomReady ? `Zoom meetings sync is configured for ${zoomSyncAllUsers() ? 'all users' : 'the configured user'} across ${zoomAccountCount} account${zoomAccountCount === 1 ? '' : 's'}.` : 'Add Zoom credentials to enable meeting sync.';
  return [
    { name: 'Gmail', status: gmailStatus, detail: gmailDetail },
    { name: 'Eventbrite', status: eventbriteStatus, detail: eventbriteDetail },
    { name: 'Zoom', status: zoomStatus, detail: zoomDetail },
    { name: 'Meta', status: metaStatus, detail: metaDetail },
    { name: 'Apollo', status: apolloStatus, detail: apolloDetail },
    { name: 'Zoho CRM', status: zohoStatus, detail: zohoDetail }
  ];
}

// Credential fields that must never reach a browser payload.
const INTEGRATION_SECRET_FIELDS = ['access_token', 'refresh_token', 'id_token', 'client_secret', 'private_token', 'api_key', 'token', 'password', 'password_hash', 'temporary_password', 'database_url', 'session_secret'];
const INTEGRATION_SECRET_FIELD_SET = new Set(INTEGRATION_SECRET_FIELDS);

function withoutIntegrationSecrets(state) {
  if (!state || typeof state !== 'object') return state;
  if (Array.isArray(state)) return state.map(item => withoutIntegrationSecrets(item));
  const safe = {};
  for (const [key, value] of Object.entries(state)) {
    if (INTEGRATION_SECRET_FIELD_SET.has(String(key).toLowerCase())) continue;
    safe[key] = withoutIntegrationSecrets(value);
  }
  return safe;
}

function bootstrap(db, user) {
  const copy = JSON.parse(JSON.stringify(recalculate(db)));
  delete copy.users;
  delete copy.__partial;
  delete copy.__partial_load;
  copy.user = publicUser(user);
  copy.permissions = permissionsForUser(user);
  copy.demoUser = user.email;
  copy.gmail = withoutIntegrationSecrets(copy.gmail);
  copy.eventbrite = withoutIntegrationSecrets(copy.eventbrite);
  copy.meta = withoutIntegrationSecrets(copy.meta);
  copy.apollo = withoutIntegrationSecrets(copy.apollo);
  copy.zoho = withoutIntegrationSecrets(copy.zoho);
  copy.zoom = withoutIntegrationSecrets(copy.zoom);
  if (copy.zoom?.calls) {
    copy.zoom.call_total = copy.zoom.calls.length;
    copy.zoom.calls = [];
    copy.zoom.call_paging = {
      loaded: 0,
      total: copy.zoom.call_total,
      limit: 50,
      has_more: copy.zoom.call_total > 0,
      next_offset: 0
    };
    copy.zoom.numbers = [];
    copy.zoom.number_paging = {
      loaded: 0,
      total: 0,
      limit: 50,
      has_more: copy.zoom.call_total > 0,
      next_offset: 0
    };
  }
  return copy;
}

function emailSnippetValue(email) {
  return String(email.snippet || email.body || '').replace(/\s+/g, ' ').trim().slice(0, 260);
}

function publicEmailSummary(email) {
  return {
    id: email.id,
    from: email.from || email.email || '',
    first_name: email.first_name || '',
    last_name: email.last_name || '',
    email: email.email || email.from || '',
    lead_id: email.lead_id || '',
    subject: email.subject || '(No subject)',
    date: email.date || email.received_at || email.created_at || '',
    received_at: email.received_at || email.date || '',
    snippet: emailSnippetValue(email),
    is_read: !(email.gmail_labels || []).includes('UNREAD'),
    owner: email.owner || '',
    direction: email.direction || 'inbound',
    response_at: email.response_at || null,
    response_note: email.response_note || '',
    due_at: email.due_at || null,
    gmail_message_id: email.gmail_message_id || '',
    gmail_thread_id: email.gmail_thread_id || '',
    gmail_labels: email.gmail_labels || [],
    gmail_label_names: email.gmail_label_names || [],
    dashboard_folder: email.dashboard_folder || '',
    trashed_at: email.trashed_at || '',
    trash_reason: email.trash_reason || ''
  };
}

function publicEmailDetail(email) {
  const detail = {
    ...publicEmailSummary(email),
    body: String(email.body || email.snippet || ''),
    response_note: email.response_note || ''
  };
  delete detail.html;
  delete detail.html_body;
  delete detail.body_html;
  delete detail.attachments;
  return detail;
}

function emailSummaryDataSql() {
  return `
    jsonb_build_object(
      'id', id,
      'lead_id', coalesce(lead_id, ''),
      'first_name', coalesce(first_name, ''),
      'last_name', coalesce(last_name, ''),
      'email', coalesce(email, ''),
      'from', coalesce(email, ''),
      'subject', coalesce(subject, '(No subject)'),
      'owner', coalesce(owner, ''),
      'date', received_at,
      'received_at', received_at,
      'created_at', received_at,
      'direction', coalesce(data->>'direction', 'inbound'),
      'response_at', response_at,
      'response_note', coalesce(response_note, ''),
      'due_at', due_at,
      'gmail_message_id', coalesce(gmail_message_id, ''),
      'gmail_thread_id', coalesce(data->>'gmail_thread_id', ''),
      'gmail_labels', coalesce(data->'gmail_labels', '[]'::jsonb),
      'gmail_label_names', coalesce(data->'gmail_label_names', '[]'::jsonb),
      'dashboard_folder', coalesce(data->>'dashboard_folder', ''),
      'trashed_at', coalesce(data->>'trashed_at', ''),
      'trash_reason', coalesce(data->>'trash_reason', ''),
      'is_read', coalesce(data->'is_read', 'true'::jsonb),
      'snippet', left(coalesce(data->>'snippet', ''), 260)
    )
  `;
}

function encodeEmailCursor(email) {
  if (!email?.id) return '';
  return Buffer.from(JSON.stringify({
    received_at: email.received_at || email.date || null,
    id: email.id
  })).toString('base64url');
}

function decodeEmailCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    // Filtered inbox pages (SQL path) use an offset cursor.
    if (Number.isInteger(value?.offset) && value.offset >= 0) return { offset: value.offset };
    if (!value?.id) return null;
    return {
      id: String(value.id),
      received_at: value.received_at ? new Date(value.received_at) : null
    };
  } catch {
    throw statusError(400, 'Invalid email cursor.');
  }
}

function encodePageCursor(value) {
  if (!value || typeof value !== 'object') return '';
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePageCursor(cursor, label = 'cursor') {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    throw statusError(400, `Invalid ${label}.`);
  }
}

function escapeSqlLike(value) {
  return String(value || '').replace(/[\\%_]/g, char => `\\${char}`);
}

function parseOptionalIsoDate(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw statusError(400, `Invalid ${label}.`);
  return new Date(time).toISOString();
}

function filterLocalLeads(leads = [], filters = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  return leads.filter(lead => {
    if (filters.stage && String(lead.stage || '') !== filters.stage) return false;
    if (filters.owner_id && String(lead.owner_id || '') !== filters.owner_id) return false;
    if (filters.programme_id && String(lead.programme_id || '') !== filters.programme_id) return false;
    if (search) {
      const haystack = [
        lead.first_name,
        lead.last_name,
        lead.full_name,
        lead.email,
        lead.phone,
        lead.employer,
        lead.programme,
        lead.stage,
        lead.owner
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

const LEAD_PAGE_DEFAULT_LIMIT = 100;
const LEAD_PAGE_MAX_LIMIT = 200;

// Sorts the Leads list accepts. Column names cannot be bound as $n parameters, so only
// these fixed expressions ever reach the SQL text. created_at DESC, id DESC is served by
// idx_app_leads_cursor. app_leads has no updated_at or last-activity column to sort on.
const LEAD_SORTS = {
  created_at: { sql: 'created_at', cast: 'timestamptz' },
  name: { sql: `lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))`, cast: 'text' }
};

// Only what the Leads table and board render. The full record (notes, source history
// details, integration payloads) comes from GET /api/leads/:id.
const LEAD_LIST_COLUMNS = `
  id, person_id, first_name, last_name, email, employer, phone, city,
  programme_id, programme, level, owner_id, owner, stage, priority,
  source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at,
  data->>'zoho_record_id' as zoho_record_id,
  data->>'zoho_module' as zoho_module,
  (
    select coalesce(jsonb_agg(jsonb_build_object('source', s.source)), '[]'::jsonb)
    from (
      select distinct e->>'source' as source
      from jsonb_array_elements(case when jsonb_typeof(data->'source_history') = 'array' then data->'source_history' else '[]'::jsonb end) e
      where e->>'source' is not null
    ) s
  ) as source_history`;

function leadListRow(row) {
  const { sort_key: sortKey, ...lead } = row;
  return {
    ...lead,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    next_action_at: row.next_action_at ? new Date(row.next_action_at).toISOString() : null,
    full_name: [row.first_name, row.last_name].filter(Boolean).join(' ')
  };
}

// Cursors are opaque base64url JSON: { sort, dir, value, id }. value is the last row's
// sort key exactly as Postgres returned it as text (created_at keeps its microseconds),
// so the next page starts precisely after that row.
function encodeLeadCursor(sortKey, id, sort = 'created_at', dir = 'desc') {
  if (!id) return '';
  return Buffer.from(JSON.stringify({ sort, dir, value: sortKey ?? null, id: String(id) })).toString('base64url');
}

const LEAD_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

function decodeLeadCursor(cursor, sort = 'created_at', dir = 'desc') {
  if (!cursor) return null;
  let value;
  try {
    value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw statusError(400, 'Invalid lead cursor.');
  }
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 200) {
    throw statusError(400, 'Invalid lead cursor.');
  }
  // Cursors issued before sorting existed carry only { created_at, id }.
  const cursorSort = value.sort || 'created_at';
  const cursorDir = value.dir || 'desc';
  const cursorValue = value.sort ? value.value : value.created_at;
  if (cursorSort !== sort || cursorDir !== dir) throw statusError(400, 'Lead cursor does not match the requested sort.');
  if (cursorValue !== null && cursorValue !== undefined && typeof cursorValue !== 'string') throw statusError(400, 'Invalid lead cursor.');
  if (sort === 'created_at' && cursorValue && !LEAD_CURSOR_TIMESTAMP.test(cursorValue)) throw statusError(400, 'Invalid lead cursor.');
  if (typeof cursorValue === 'string' && cursorValue.length > 400) throw statusError(400, 'Invalid lead cursor.');
  return { id: value.id, value: cursorValue ?? null };
}

function leadPageOptions(options = {}) {
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, LEAD_PAGE_MAX_LIMIT)) : LEAD_PAGE_DEFAULT_LIMIT;
  const sort = String(options.sort || 'created_at').trim();
  if (!LEAD_SORTS[sort]) throw statusError(400, `Unsupported lead sort. Use one of: ${Object.keys(LEAD_SORTS).join(', ')}.`);
  const dir = String(options.dir || (sort === 'name' ? 'asc' : 'desc')).trim().toLowerCase();
  if (!['asc', 'desc'].includes(dir)) throw statusError(400, 'Lead sort direction must be asc or desc.');
  const parseDate = (input, label) => {
    const text = String(input || '').trim();
    if (!text) return null;
    const time = Date.parse(text);
    if (!Number.isFinite(time)) throw statusError(400, `Invalid ${label} date.`);
    return new Date(time).toISOString();
  };
  const all = value => {
    const text = String(value || '').trim();
    return /^all( \w+)?$/i.test(text) ? '' : text.slice(0, 200);
  };
  return {
    limit,
    sort,
    dir,
    cursor: decodeLeadCursor(options.cursor, sort, dir),
    includeTotal: !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase()),
    filters: {
      search: String(options.search || '').trim().slice(0, 200),
      stage: all(options.stage),
      owner_id: all(options.owner_id || options.ownerId),
      programme_id: all(options.programme_id || options.programmeId),
      lead_source: all(options.lead_source || options.source),
      created_from: parseDate(options.created_from, 'created_from'),
      created_to: parseDate(options.created_to, 'created_to')
    }
  };
}

// WHERE conditions for the filters, appended to a shared values array so the $n numbers
// always line up with whichever optional filters are present.
function leadFilterConditions(filters, values) {
  const conditions = [];
  const bind = value => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.search) {
    // Every word must match one of the searchable fields. User-typed % and _ are escaped
    // so they match literally.
    const terms = filters.search.split(/\s+/).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      const p = bind(`%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`);
      conditions.push(`(first_name ilike ${p} or last_name ilike ${p} or email ilike ${p} or phone ilike ${p} or employer ilike ${p})`);
    }
  }
  if (filters.stage) conditions.push(`stage = ${bind(filters.stage)}`);
  if (filters.owner_id) conditions.push(`owner_id = ${bind(filters.owner_id)}`);
  if (filters.programme_id) conditions.push(`programme_id = ${bind(filters.programme_id)}`);
  if (filters.lead_source) {
    const p = bind(filters.lead_source);
    conditions.push(`(source_first_touch = ${p} or source_lead_capture = ${p} or data->'source_history' @> jsonb_build_array(jsonb_build_object('source', ${p}::text)))`);
  }
  if (filters.created_from) conditions.push(`created_at >= ${bind(filters.created_from)}::timestamptz`);
  if (filters.created_to) conditions.push(`created_at < ${bind(filters.created_to)}::timestamptz`);
  return conditions;
}

// Keyset condition for "rows after the cursor" in ORDER BY <key> <dir>, id <dir>.
// Postgres puts NULLs first for DESC and last for ASC, so a NULL key is handled explicitly.
function leadCursorCondition(sortDef, dir, cursor, values) {
  const bind = value => {
    values.push(value);
    return `$${values.length}`;
  };
  const key = sortDef.sql;
  const id = bind(cursor.id);
  if (cursor.value === null) {
    return dir === 'desc'
      ? `((${key} is null and id < ${id}) or ${key} is not null)`
      : `(${key} is null and id > ${id})`;
  }
  const value = `${bind(cursor.value)}::${sortDef.cast}`;
  return dir === 'desc'
    ? `((${key}, id) < (${value}, ${id}))`
    : `((${key}, id) > (${value}, ${id}) or ${key} is null)`;
}

function buildLeadPageQuery(options = {}) {
  const { limit, sort, dir, cursor, includeTotal, filters } = leadPageOptions(options);
  const sortDef = LEAD_SORTS[sort];
  const filterValues = [];
  const filterConditions = leadFilterConditions(filters, filterValues);
  if (leadSoftDelete.enabled) filterConditions.push(activeLeadCondition());
  const values = filterValues.slice();
  const conditions = filterConditions.slice();
  if (cursor) conditions.push(leadCursorCondition(sortDef, dir, cursor, values));
  values.push(limit + 1);
  const filterWhere = filterConditions.length ? `where ${filterConditions.join(' and ')}` : '';
  const listSql = `
    select ${LEAD_LIST_COLUMNS}, (${sortDef.sql})::text as sort_key
    from app_leads
    ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
    order by ${sortDef.sql} ${dir}, id ${dir}
    limit $${values.length}`;
  const combinedSql = includeTotal ? `
    with
    stage_counts as (
      select coalesce(jsonb_object_agg(coalesce(stage, ''), total), '{}'::jsonb) as counts
      from (select stage, count(*)::int as total from app_leads ${filterWhere} group by stage) s
    ),
    page as (
      select ${LEAD_LIST_COLUMNS}, (${sortDef.sql})::text as sort_key, ${sortDef.sql} as sort_value
      from app_leads
      ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
      order by ${sortDef.sql} ${dir}, id ${dir}
      limit $${values.length}
    )
    select page.*, (select counts from stage_counts) as stage_counts
    from page
    order by sort_value ${dir}, id ${dir}` : listSql;
  return {
    limit,
    sort,
    dir,
    cursor,
    includeTotal,
    filters,
    label: includeTotal ? 'leads_page_with_counts' : 'leads_page',
    sql: combinedSql,
    values
  };
}

function explainPlanSummary(planJson) {
  const root = Array.isArray(planJson) ? planJson[0] : planJson;
  const plan = root?.Plan || {};
  return {
    planning_time_ms: Number(root?.['Planning Time'] || 0),
    execution_time_ms: Number(root?.['Execution Time'] || 0),
    node_type: plan['Node Type'] || '',
    relation_name: plan['Relation Name'] || '',
    index_name: plan['Index Name'] || '',
    actual_rows: Number(plan['Actual Rows'] || 0),
    shared_hit_blocks: Number(plan['Shared Hit Blocks'] || 0),
    shared_read_blocks: Number(plan['Shared Read Blocks'] || 0)
  };
}

async function explainPostgresQuery(label, sql, values = []) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) throw statusError(400, 'PostgreSQL storage is not configured.');
  const started = performance.now();
  const result = await postgresPool.query(`explain (analyze, buffers, format json) ${sql}`, values);
  const observedMs = performance.now() - started;
  const planJson = result.rows[0]?.['QUERY PLAN'];
  return {
    label,
    observed_ms: Number(observedMs.toFixed(1)),
    ...explainPlanSummary(planJson),
    sql: sqlSummary(sql)
  };
}

async function explainBootstrapAndLeads(options = {}) {
  await ensureStorage();
  const bootstrap = bootstrapPayloadQuery();
  const leads = buildLeadPageQuery({ limit: options.limit || 100, include_total: options.include_total || 'false' });
  const [bootstrapExplain, leadsExplain] = await Promise.all([
    explainPostgresQuery(bootstrap.label, bootstrap.sql, bootstrap.values),
    explainPostgresQuery(leads.label, leads.sql, leads.values)
  ]);
  return { bootstrap: bootstrapExplain, leads: leadsExplain };
}

async function explainTracedPage(label, run) {
  const trace = createPerfTrace(label);
  const started = performance.now();
  const payload = await run(trace);
  const appMs = performance.now() - started;
  const queryStages = trace.stages.filter(stage => stage.name.endsWith('_query') && stage.sql_full);
  const explains = [];
  for (const stage of queryStages) {
    explains.push(await explainPostgresQuery(stage.query_name || stage.name.replace(/_query$/, ''), stage.sql_full, stage.params || []));
  }
  return {
    app_duration_ms: Number(appMs.toFixed(1)),
    returned_rows: Array.isArray(payload?.items) ? payload.items.length : Array.isArray(payload?.emails) ? payload.emails.length : Array.isArray(payload?.applications) ? payload.applications.length : 0,
    postgres_query_count: queryStages.length,
    queries: explains
  };
}

async function explainRemainingPageQueries(options = {}) {
  await ensureStorage();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const bounds = {
    today_start: start.toISOString(),
    tomorrow_start: new Date(start.getTime() + 86400000).toISOString()
  };
  return {
    leads_reference: await explainPostgresQuery('leads_page', buildLeadPageQuery({ limit: options.leads_limit || 100 }).sql, buildLeadPageQuery({ limit: options.leads_limit || 100 }).values),
    emails: await explainTracedPage('/api/emails?status=Unanswered&limit=50', trace => loadEmailPage({ status: 'Unanswered', limit: '50' }, trace)),
    tasks: await explainTracedPage('/api/tasks?status=open&bucket=overdue&limit=80&include_counts=true', trace => loadTaskPage({ status: 'open', bucket: 'overdue', limit: '80', include_counts: 'true', ...bounds }, trace)),
    applications: await explainTracedPage('/api/applications?limit=50', trace => loadApplicationListDb({ limit: '50' }, trace)),
    meetings: await explainTracedPage('/api/meetings?limit=50', trace => loadZoomEventPageDb({ limit: '50' }, trace)),
    contacts: await explainTracedPage('/api/contacts?limit=100', trace => loadContactPage({ limit: '100' }, trace))
  };
}

async function loadLeadPage(options = {}, trace = null) {
  const parsed = leadPageOptions(options);
  await perfPhase(trace, 'leads_storage', () => ensureStorage());
  if (!postgresPool || !usesPostgresStorage()) {
    const { limit, sort, dir, cursor, filters } = parsed;
    const db = await loadDb();
    const rows = filterLocalLeads(db.leads || [], filters)
      .sort((a, b) => {
        const timeDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
        return timeDiff || String(b.id).localeCompare(String(a.id));
      });
    const cursorIndex = cursor ? rows.findIndex(item => item.id === cursor.id) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const items = rows.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < rows.length;
    const last = items[items.length - 1];
    const nextCursor = hasMore ? encodeLeadCursor(last?.created_at || null, last?.id, sort, dir) : '';
    return { items, nextCursor, hasMore, total: rows.length, stage_counts: null, limit, sort, dir };
  }
  const query = buildLeadPageQuery(options);
  const list = await perfPhase(trace, 'leads_sql', () => timedPostgresQuery(trace, query.label, query.sql, query.values));
  return perfPhase(trace, 'mapping', async () => {
    const pageRows = list.rows.slice(0, query.limit);
    const items = pageRows.map(leadListRow);
    const hasMore = list.rows.length > query.limit;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore ? encodeLeadCursor(last.sort_key, last.id, query.sort, query.dir) : '';
    const stageCounts = query.includeTotal ? (list.rows[0]?.stage_counts || {}) : null;
    const total = stageCounts ? Object.values(stageCounts).reduce((sum, value) => sum + value, 0) : null;
    return { items, nextCursor, hasMore, total, stage_counts: stageCounts, limit: query.limit, sort: query.sort, dir: query.dir };
  });
}

// Lead detail reads only this lead and the rows linked to it.
async function loadLeadDetailDb(leadId, mergedFrom = null) {
  await refreshLeadSoftDelete();
  const row = (await postgresPool.query(`select data${leadSoftDelete.enabled ? ', merged_into_id' : ''} from app_leads where id = $1`, [leadId])).rows[0];
  // A merged duplicate opens its master (old links and bookmarks keep working).
  if (row?.merged_into_id && !mergedFrom) return { ...(await loadLeadDetailDb(row.merged_into_id, leadId)), merged_from: leadId };
  const lead = row?.data;
  if (!lead) throw statusError(404, 'Lead not found.');
  const [tasks, emails, applications, audit] = await Promise.all([
    postgresPool.query(`select data from app_tasks where lead_id = $1 order by coalesce(completed_at, due_at) desc nulls last limit 200`, [leadId]),
    postgresPool.query(
      `select jsonb_build_object(
         'lead_id', lead_id, 'subject', data->'subject', 'received_at', received_at, 'owner', data->'owner',
         'direction', data->'direction', 'response_at', response_at, 'gmail_labels', data->'gmail_labels',
         'dashboard_folder', data->'dashboard_folder', 'trashed_at', data->'trashed_at'
       ) as data
       from app_emails where lead_id = $1 order by received_at desc nulls last limit 200`,
      [leadId]
    ),
    postgresPool.query(`select data from app_applications where lead_id = $1`, [leadId]),
    postgresPool.query(`select data from app_audit where entity_id = $1 order by occurred_at desc nulls last limit 200`, [leadId])
  ]);
  const related = {
    tasks: tasks.rows.map(row => row.data).filter(Boolean),
    emails: emails.rows.map(row => row.data).filter(Boolean),
    applications: applications.rows.map(row => row.data).filter(Boolean),
    audit: audit.rows.map(row => row.data).filter(Boolean)
  };
  return { lead, timeline: timeline(related, lead), tasks: related.tasks };
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
  if (!['open', 'done', 'all'].includes(status)) throw statusError(400, 'Task status must be open, done or all.');
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  const cursor = decodePageCursor(options.cursor, 'task cursor');
  const bucket = String(options.bucket || '').trim().toLowerCase();
  if (bucket && (status !== 'open' || !['overdue', 'today', 'upcoming'].includes(bucket))) throw statusError(400, 'Task bucket must be overdue, today or upcoming (open tasks only).');
  const search = String(options.search || '').trim().slice(0, 200);
  const ownerId = String(options.owner_id || '').trim();
  const leadId = String(options.lead_id || '').trim();
  const dueBefore = parseOptionalIsoDate(options.due_before, 'due_before');
  const dueAfter = parseOptionalIsoDate(options.due_after, 'due_after');
  const bounds = parseDayBounds(options);
  const includeCounts = !options.cursor && ['1', 'true'].includes(String(options.include_counts || '').toLowerCase());
  if (bucket && !bounds.provided) throw statusError(400, 'A task bucket needs today_start and tomorrow_start.');
  const { todayStart, tomorrowStart } = bounds.provided ? bounds : {};
  await perfPhase(trace, 'tasks_storage', () => ensureStorage());
  if (!postgresPool || !usesPostgresStorage()) {
    const db = await loadDb();
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
    const nextCursor = start + items.length < rows.length ? encodePageCursor({ id: items[items.length - 1]?.id || '' }) : '';
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
    timedPostgresQuery(trace, 'tasks_page',
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
    includeCounts && bounds.provided ? loadTaskBucketCounts(postgresPool, bounds, trace) : Promise.resolve(null)
  ]);
  return perfPhase(trace, 'mapping', async () => {
    const rows = list.rows.slice(0, limit);
    const leads = new Map();
    for (const row of rows) if (row.lead?.id) leads.set(row.lead.id, row.lead);
    const last = rows[rows.length - 1];
    const nextCursor = list.rows.length > limit && last?.task?.id ? encodePageCursor({ sort_at: last.sort_at || null, id: last.task.id }) : '';
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

function eventListDataSql() {
  return `
    jsonb_build_object(
      'id', e.id,
      'name', coalesce(e.name, e.data->>'name', 'Event'),
      'title', coalesce(e.name, e.data->>'title', e.data->>'name', 'Event'),
      'start_at', e.start_at,
      'location', coalesce(e.location, e.data->>'location', ''),
      'campaign', coalesce(e.campaign, e.data->>'campaign', ''),
      'capacity', coalesce(e.capacity, nullif(e.data->>'capacity', '')::int, 0),
      'registrations', greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)),
      'attendance', coalesce(e.attendance, a.attended, 0),
      'attendee_count', coalesce(a.attendee_count, 0),
      'description', coalesce(e.data->>'description', ''),
      'status', coalesce(e.data->>'status', 'live'),
      'meeting_link', coalesce(e.data->>'meeting_link', e.data->>'zoom_link', ''),
      'zoom_link', coalesce(e.data->>'zoom_link', e.data->>'meeting_link', ''),
      'zoom_meeting_id', coalesce(e.data->>'zoom_meeting_id', ''),
      'zoom_meeting_uuid', coalesce(e.data->>'zoom_meeting_uuid', ''),
      'zoom_host_id', coalesce(e.data->>'zoom_host_id', ''),
      'zoom_host_label', coalesce(e.data->>'zoom_host_label', ''),
      'zoom_account_id', coalesce(e.data->>'zoom_account_id', ''),
      'zoom_account_label', coalesce(e.data->>'zoom_account_label', ''),
      'zoom_list_type', coalesce(e.data->>'zoom_list_type', e.data->>'status', ''),
      'metrics', jsonb_build_object(
        'booked', greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)),
        'confirmed', coalesce(a.confirmed, 0),
        'attended', coalesce(a.attended, 0),
        'declined', coalesce(a.declined, 0),
        'noAnswer', coalesce(a.no_answer, 0),
        'pending', greatest(0, greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)) - coalesce(a.confirmed, 0) - coalesce(a.attended, 0) - coalesce(a.declined, 0)),
        'capacity', coalesce(e.capacity, nullif(e.data->>'capacity', '')::int, greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)))
      )
    )
  `;
}

const EVENT_ATTENDEE_STATS_SQL = `
  left join lateral (
    select
      count(*)::int as attendee_count,
      count(*) filter (where coalesce(x.value->>'attended_at', '') <> '' or lower(coalesce(x.value->>'status', '')) ~ 'attended|present|checked')::int as attended,
      count(*) filter (where coalesce(x.value->>'attended_at', '') = '' and lower(coalesce(x.value->>'status', '')) ~ 'confirm|confirmed')::int as confirmed,
      count(*) filter (where lower(coalesce(x.value->>'status', '')) ~ 'declined|cancel|no show|absent')::int as declined,
      count(*) filter (where lower(coalesce(x.value->>'status', '')) ~ 'no answer|not reached')::int as no_answer
    from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) x
  ) a on true`;

async function loadEventDetailDb(id, trace = null) {
  await perfPhase(trace, 'events_storage', () => ensureStorage());
  if (!postgresPool || !usesPostgresStorage()) {
    const event = (await loadDb()).events.find(item => String(item.id) === String(id));
    if (!event) throw statusError(404, 'Event not found.');
    return { event };
  }
  const result = await timedPostgresQuery(trace, 'event_detail', `select data from app_events where id = $1 limit 1`, [String(id)]);
  const event = result.rows[0]?.data;
  if (!event) throw statusError(404, 'Event not found.');
  return { event };
}

// Events are loaded as bounded summaries. Attendees stay off the hot list path and are fetched
// only for a single event detail dialog.
async function loadEventPage(options = {}, trace = null) {
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
  const upcomingOnly = ['1', 'true'].includes(String(options.upcoming || '').toLowerCase());
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const cursor = decodePageCursor(options.cursor, 'event cursor');
  await perfPhase(trace, 'events_storage', () => ensureStorage());
  if (!postgresPool || !usesPostgresStorage()) {
    const db = await loadDb();
    const events = (db.events || [])
      .filter(event => !upcomingOnly || new Date(event.start_at || 0) >= new Date())
      .sort((a, b) => new Date(b.start_at || 0) - new Date(a.start_at || 0));
    const start = cursor?.id ? Math.max(0, events.findIndex(item => item.id === cursor.id) + 1) : 0;
    const page = events.slice(start, start + limit);
    const nextCursor = start + page.length < events.length ? encodePageCursor({ start_at: page[page.length - 1]?.start_at || null, id: page[page.length - 1]?.id || '' }) : '';
    return { items: page, total: includeTotal ? events.length : null, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
  }
  const conditions = [];
  const values = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  if (upcomingOnly) conditions.push(`start_at >= now()`);
  if (cursor?.id) {
    const idParam = bind(String(cursor.id || ''));
    if (cursor.start_at) {
      const startParam = bind(cursor.start_at);
      conditions.push(upcomingOnly
        ? `(start_at > ${startParam}::timestamptz or (start_at = ${startParam}::timestamptz and id > ${idParam}) or start_at is null)`
        : `(start_at < ${startParam}::timestamptz or (start_at = ${startParam}::timestamptz and id < ${idParam}) or start_at is null)`);
    } else {
      conditions.push(upcomingOnly ? `(start_at is null and id > ${idParam})` : `(start_at is null and id < ${idParam})`);
    }
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const order = upcomingOnly ? `start_at asc nulls last, id` : `start_at desc nulls last, id`;
  const [list, count] = await Promise.all([
    timedPostgresQuery(trace, 'events_page', `select ${eventListDataSql()} as data, e.start_at from app_events e ${EVENT_ATTENDEE_STATS_SQL} ${where} order by ${order} limit $${values.length + 1}`, [...values, limit + 1]),
    includeTotal ? timedPostgresQuery(trace, 'events_count', `select count(*)::int as total from app_events ${upcomingOnly ? 'where start_at >= now()' : ''}`) : Promise.resolve(null)
  ]);
  return perfPhase(trace, 'mapping', async () => {
    const rows = list.rows.slice(0, limit).map(row => row.data).filter(Boolean);
    const last = list.rows.slice(0, limit).at(-1);
    const nextCursor = list.rows.length > limit && last?.data?.id ? encodePageCursor({ start_at: last.start_at || last.data.start_at || null, id: last.data.id }) : '';
    return { items: rows, total: count ? Number(count.rows[0]?.total || 0) : null, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
  });
}

function leadIdentityKey(lead) {
  return String(lead?.zoho_record_id || lead?.crm_lead_id || lead?.id || '').trim().toLowerCase();
}

function uniqueLeadsByIdentity(leads = []) {
  const seen = new Set();
  return leads.filter(lead => {
    const key = leadIdentityKey(lead);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dashboardLeadIdentitySql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `coalesce(nullif(${prefix}data->>'zoho_record_id', ''), nullif(${prefix}data->>'crm_lead_id', ''), nullif(${prefix}data->>'id', ''), ${prefix}id)`;
}

function dashboardDistinctLeadRowsSql(alias = '') {
  const keySql = dashboardLeadIdentitySql(alias);
  const prefix = alias ? `${alias}.` : '';
  return `
    select distinct on (${keySql})
      ${keySql} as lead_key,
      ${prefix}id,
      coalesce(${prefix}stage, ${prefix}data->>'stage', '') as stage,
      ${prefix}created_at
    from app_leads ${alias}
    where ${activeLeadCondition(alias)}
    order by ${keySql}, coalesce(${prefix}created_at, 'epoch'::timestamptz) desc, ${prefix}id desc
  `;
}

function dashboardSummaryFromDb(db) {
  const leads = uniqueLeadsByIdentity(db.leads || []);
  const tasks = db.tasks || [];
  const emails = (db.emails || []).filter(email => !emailIsTrashed(email));
  const applications = db.applications || [];
  const events = db.events || [];
  const now = Date.now();
  const openTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open');
  return {
    generated_at: new Date().toISOString(),
    leads: {
      total: leads.length,
      new: leads.filter(lead => /new/.test(String(lead.stage || '').toLowerCase())).length,
      qualified: leads.filter(lead => /qualified/.test(String(lead.stage || '').toLowerCase())).length,
      active: leads.filter(lead => !['Enrolled', 'Lost', 'Not Eligible'].includes(lead.stage)).length
    },
    tasks: {
      open: openTasks.length,
      overdue: openTasks.filter(task => {
        const due = new Date(task.due_at || 0).getTime();
        return due && due < now;
      }).length,
      done: tasks.filter(task => String(task.status || '').toLowerCase() === 'done').length
    },
    emails: {
      total: emails.length,
      unread: emails.filter(emailIsUnread).length,
      unanswered: emails.filter(email => emailIsInboundExternal(db, email) && !email.response_at).length,
      overdue: emails.filter(email => !email.response_at && new Date(email.due_at || 0).getTime() < now).length
    },
    applications: {
      total: applications.length,
      new: applications.filter(application => /new|draft|pending|submitted/i.test(String(application.status || ''))).length,
      enrolled: applications.filter(application => application.learner).length
    },
    events: {
      total: events.length,
      upcoming: events.filter(event => new Date(event.start_at || 0).getTime() >= now).length,
      zoom: events.filter(event => event.zoom_meeting_id || event.zoom_meeting_uuid || String(event.location || '').toLowerCase() === 'zoom').length
    }
  };
}

async function loadDashboardSummaryDb() {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) return dashboardSummaryFromDb(await loadDb());
  const notTrashedSql = `
    not (
      coalesce(data->'gmail_labels', '[]'::jsonb) ? 'TRASH'
      or coalesce(data->>'dashboard_folder', '') = 'trash'
      or data ? 'trashed_at'
    )
  `;
  const [leads, tasks, emails, applications, events] = await Promise.all([
    postgresPool.query(`
      select
        count(*)::int as total,
        count(*) filter (where lower(coalesce(stage, '')) like '%new%')::int as new,
        count(*) filter (where lower(coalesce(stage, '')) like '%qualified%')::int as qualified,
        count(*) filter (where lower(coalesce(stage, '')) not in ('enrolled', 'lost', 'not eligible'))::int as active
      from (${dashboardDistinctLeadRowsSql()}) distinct_leads
    `),
    postgresPool.query(`
      select
        count(*) filter (where lower(coalesce(status, data->>'status', '')) = 'open')::int as open,
        count(*) filter (
          where lower(coalesce(status, data->>'status', '')) = 'open'
            and due_at is not null
            and due_at < now()
        )::int as overdue,
        count(*) filter (where lower(coalesce(status, data->>'status', '')) = 'done')::int as done
      from app_tasks
    `),
    postgresPool.query(`
      select
        count(*) filter (where ${notTrashedSql})::int as total,
        count(*) filter (
          where ${notTrashedSql}
            and (
              coalesce(data->'gmail_labels', '[]'::jsonb) ? 'UNREAD'
              or coalesce(data->'gmail_label_names', '[]'::jsonb) ? 'Unread'
              or coalesce(data->>'is_read', '') = 'false'
            )
        )::int as unread,
        count(*) filter (
          where ${notTrashedSql}
            and response_at is null
            and lower(coalesce(data->>'direction', 'inbound')) <> 'outbound'
        )::int as unanswered,
        count(*) filter (
          where ${notTrashedSql}
            and response_at is null
            and due_at is not null
            and due_at < now()
        )::int as overdue
      from app_emails
    `),
    postgresPool.query(`
      select
        count(*)::int as total,
        count(*) filter (where lower(coalesce(status, data->>'status', '')) ~ '(new|draft|pending|submitted)')::int as new,
        count(*) filter (where learner is not null)::int as enrolled
      from app_applications
    `),
    postgresPool.query(`
      select
        count(*)::int as total,
        count(*) filter (where start_at >= now())::int as upcoming,
        count(*) filter (
          where lower(coalesce(location, data->>'location', '')) = 'zoom'
             or coalesce(data->>'zoom_meeting_id', '') <> ''
             or coalesce(data->>'zoom_meeting_uuid', '') <> ''
        )::int as zoom
      from app_events
    `)
  ]);
  return {
    generated_at: new Date().toISOString(),
    leads: leads.rows[0],
    tasks: tasks.rows[0],
    emails: emails.rows[0],
    applications: applications.rows[0],
    events: events.rows[0]
  };
}

const DASHBOARD_STAGE_THRESHOLDS = {
  'New lead': 2,
  Contacted: 5,
  Qualified: 7,
  'Application Submitted': 7,
  Eligibility: 5,
  'Ready for Enrolment': 5,
  Enrolled: 30,
  'Not Eligible': 14,
  Lost: 14,
  Deferred: 14
};

function isoDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? '' : `${match[1]}-${match[2]}-${match[3]}`;
}

function parseDashboardFilters(url, user) {
  const permissions = permissionsForUser(user);
  const max = value => String(value || '').trim().slice(0, 160);
  let from = isoDateOnly(url.searchParams.get('from'));
  let to = isoDateOnly(url.searchParams.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  const requestedOwner = max(url.searchParams.get('owner_id'));
  return {
    from,
    to,
    college_id: max(url.searchParams.get('college_id')),
    programme_id: max(url.searchParams.get('programme_id')),
    intake_id: max(url.searchParams.get('intake_id')),
    owner_id: permissions.review || permissions.admin || permissions.developer ? requestedOwner : user.id,
    lead_source: max(url.searchParams.get('lead_source')),
    role_scope: permissions.review || permissions.admin || permissions.developer ? 'team' : 'mine',
    permissions
  };
}

function addDashboardFilterClause(clauses, params, expression, value, operator = '=') {
  if (!expression || value === undefined || value === null || value === '') return;
  params.push(value);
  clauses.push(`${expression} ${operator} $${params.length}`);
}

function addDashboardDateClauses(clauses, params, expression, filters) {
  if (!expression) return;
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`${expression} >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`${expression} < ($${params.length}::date + interval '1 day')`);
  }
}

function safeTimestampExpression(expression) {
  return `(case when nullif((${expression})::text, '') ~ '^\\d{4}-\\d{2}-\\d{2}' then nullif((${expression})::text, '')::timestamptz end)`;
}

function firstTimestampExpression(...expressions) {
  return `coalesce(${expressions.filter(Boolean).map(safeTimestampExpression).join(', ')})`;
}

function jsonArrayMinTimestampExpression(arrayExpression, field) {
  return `(select min(${safeTimestampExpression(`item->>'${field}'`)}) from jsonb_array_elements(case when jsonb_typeof(coalesce(${arrayExpression}, '[]'::jsonb)) = 'array' then coalesce(${arrayExpression}, '[]'::jsonb) else '[]'::jsonb end) item)`;
}

function dashboardLeadDateExpression(alias = 'l') {
  return firstTimestampExpression(
    jsonArrayMinTimestampExpression(`${alias}.data->'source_history'`, 'captured_at'),
    `${alias}.data->>'Created_Time'`,
    `${alias}.data->>'created_time'`,
    `${alias}.data->>'captured_at'`,
    `${alias}.data->>'received_at'`,
    `${alias}.data->>'event_start_at'`,
    `${alias}.created_at`
  );
}

function dashboardApplicationDateExpression(alias = 'a') {
  return firstTimestampExpression(
    `${alias}.learner->>'enrolled_at'`,
    `${alias}.data->'learner'->>'enrolled_at'`,
    `${alias}.data->>'Created_Time'`,
    `${alias}.data->>'created_time'`,
    `${alias}.created_at`
  );
}

function dashboardEventDateExpression(alias = 'ev') {
  return firstTimestampExpression(
    `${alias}.data->>'start_at'`,
    `${alias}.data->>'Start_DateTime'`,
    `${alias}.data->>'event_start_at'`,
    `${alias}.start_at`
  );
}

function dashboardEmailDateExpression(alias = 'e') {
  return firstTimestampExpression(
    `${alias}.data->>'received_at'`,
    `${alias}.data->>'internal_date'`,
    `${alias}.data->>'message_date'`,
    `${alias}.data->>'date'`,
    `${alias}.received_at`
  );
}

function dashboardWhere(filters, fields = {}) {
  const clauses = [];
  const params = [];
  addDashboardDateClauses(clauses, params, fields.date, filters);
  addDashboardFilterClause(clauses, params, fields.college, filters.college_id);
  addDashboardFilterClause(clauses, params, fields.programme, filters.programme_id);
  addDashboardFilterClause(clauses, params, fields.intake, filters.intake_id);
  addDashboardFilterClause(clauses, params, fields.owner, filters.owner_id);
  addDashboardFilterClause(clauses, params, fields.source, filters.lead_source);
  return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

function mergeWhere(baseSql, extraSql) {
  if (!extraSql) return baseSql ? `where ${baseSql}` : '';
  return `where ${[baseSql, extraSql.replace(/^where\s+/i, '')].filter(Boolean).join(' and ')}`;
}

function appendSqlCondition(whereSql, condition) {
  return whereSql ? `${whereSql} and ${condition}` : `where ${condition}`;
}

function leadDashboardWhere(filters, dateExpression = dashboardLeadDateExpression('l')) {
  const where = dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', '')",
    programme: 'coalesce(l.programme_id, l.data->>\'programme_id\', \'\')',
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: 'coalesce(l.owner_id, l.data->>\'owner_id\', \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
  if (leadSoftDelete.enabled) where.sql = appendSqlCondition(where.sql, activeLeadCondition('l'));
  return where;
}

function taskDashboardWhere(filters, dateExpression = 't.due_at') {
  return dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', '')",
    programme: 'coalesce(l.programme_id, l.data->>\'programme_id\', \'\')',
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: 'coalesce(t.owner_id, l.owner_id, \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
}

function applicationDashboardWhere(filters, dateExpression = dashboardApplicationDateExpression('a')) {
  return dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', a.data->>'college_id', '')",
    programme: "coalesce(l.programme_id, a.data->>'programme_id', '')",
    intake: "coalesce(a.data->>'intake_id', '')",
    owner: 'coalesce(l.owner_id, \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
}

function emailDashboardWhere(filters, dateExpression = dashboardEmailDateExpression('e')) {
  return dashboardWhere(filters, {
    date: dateExpression,
    college: "coalesce(l.data->>'college_id', l.data->>'college', '')",
    programme: 'coalesce(l.programme_id, l.data->>\'programme_id\', \'\')',
    intake: "coalesce(l.data->>'intake_id', '')",
    owner: 'coalesce(l.owner_id, \'\')',
    source: "coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other')"
  });
}

function dashboardEmailNotTrashedSql(alias = 'e') {
  return `not (
    coalesce(${alias}.data->'gmail_labels', '[]'::jsonb) ? 'TRASH'
    or coalesce(${alias}.data->>'dashboard_folder', '') = 'trash'
    or ${alias}.data ? 'trashed_at'
  )`;
}

function dashboardEmailUnreadSql(alias = 'e') {
  return `(
    coalesce(${alias}.data->'gmail_labels', '[]'::jsonb) ? 'UNREAD'
    or coalesce(${alias}.data->'gmail_label_names', '[]'::jsonb) ? 'Unread'
    or coalesce(${alias}.data->>'is_read', '') = 'false'
  )`;
}

function dashboardApprenticeshipInterestSql(alias = 'e') {
  return `exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(${alias}.data->'gmail_label_names', '[]'::jsonb)) = 'array'
          then coalesce(${alias}.data->'gmail_label_names', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as label(name)
    where trim(lower(label.name)) in ('apprenticeship intersted', 'apprenticeship interested')
       or trim(lower(label.name)) = 'apprenticeship interests'
       or trim(lower(label.name)) like 'apprenticeship interests/%'
  )`;
}

function dashboardRole(user) {
  const role = canonicalWorkspaceRole(user?.role);
  if (permissionsForUser(user).developer || role === 'admin') return 'admin';
  if (permissionsForUser(user).review || role === 'manager') return 'manager';
  return 'sales';
}

async function loadDashboardCockpitSummaryDb(filters, user) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) {
    const summary = dashboardSummaryFromDb(await loadDb());
    return {
      generated_at: new Date().toISOString(),
      role: dashboardRole(user),
      kpis: [
        { id: 'new_leads_today', label: 'New Leads Today', value: summary.leads.new, route: 'leads' },
        { id: 'leads_requiring_follow_up', label: 'Leads Requiring Follow-up', value: summary.tasks.overdue, route: 'leads' },
        { id: 'open_tasks', label: 'Open Tasks', value: summary.tasks.open, route: 'planner' },
        { id: 'overdue_tasks', label: 'Overdue Tasks', value: summary.tasks.overdue, route: 'planner' },
        { id: 'unread_emails', label: 'Unread Emails', value: summary.emails.unread, route: 'inbox' },
        { id: 'new_applications', label: 'New Applications', value: summary.applications.new, route: 'applications' }
      ],
      attention: []
    };
  }
  const leadWhere = leadDashboardWhere(filters);
  const taskWhere = taskDashboardWhere(filters);
  const emailWhere = emailDashboardWhere(filters);
  const appWhere = applicationDashboardWhere(filters);
  const leadExtra = leadWhere.sql.replace(/^where\s+/i, '');
  const noFollowWhere = mergeWhere(leadExtra, `lower(coalesce(l.stage, l.data->>'stage', '')) not in ('enrolled','lost','not eligible','deferred') and not exists (select 1 from app_tasks t where t.lead_id = l.id and lower(coalesce(t.status, t.data->>'status', '')) = 'open')`);
  const [leadStats, taskStats, emailStats, appStats, attentionLeadStats] = await Promise.all([
    postgresPool.query(`
      select
        count(distinct ${dashboardLeadIdentitySql('l')}) filter (where created_at >= current_date and created_at < current_date + interval '1 day')::int as new_today
      from app_leads l ${leadWhere.sql}
    `, leadWhere.params),
    postgresPool.query(`
      select
        count(*) filter (where lower(coalesce(t.status, t.data->>'status', '')) = 'open')::int as open,
        count(*) filter (where lower(coalesce(t.status, t.data->>'status', '')) = 'open' and t.due_at < now())::int as overdue
      from app_tasks t left join app_leads l on l.id = t.lead_id ${taskWhere.sql}
    `, taskWhere.params),
    postgresPool.query(`
      select
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and ${dashboardEmailUnreadSql('e')})::int as unread
      from app_emails e left join app_leads l on l.id = e.lead_id ${emailWhere.sql}
    `, emailWhere.params),
    postgresPool.query(`
      select
        count(*) filter (where lower(coalesce(a.status, a.data->>'status', '')) in ('in review','draft','submitted','pending','new'))::int as new,
        count(*) filter (where lower(coalesce(a.status, a.data->>'status', '')) in ('in review','submitted','pending','eligible'))::int as needs_review
      from app_applications a left join app_leads l on l.id = a.lead_id ${appWhere.sql}
    `, appWhere.params),
    postgresPool.query(`select count(distinct ${dashboardLeadIdentitySql('l')})::int as no_follow_up from app_leads l ${noFollowWhere}`, leadWhere.params)
  ]);
  const integrationIssues = dashboardIntegrationHealthRows(user).filter(item => ['Warning', 'Error'].includes(item.status)).length;
  const stats = {
    new_leads_today: Number(leadStats.rows[0]?.new_today || 0),
    leads_requiring_follow_up: Number(attentionLeadStats.rows[0]?.no_follow_up || 0),
    open_tasks: Number(taskStats.rows[0]?.open || 0),
    overdue_tasks: Number(taskStats.rows[0]?.overdue || 0),
    unread_emails: Number(emailStats.rows[0]?.unread || 0),
    new_applications: Number(appStats.rows[0]?.new || 0),
    applications_need_review: Number(appStats.rows[0]?.needs_review || 0),
    integration_issues: integrationIssues
  };
  return {
    generated_at: new Date().toISOString(),
    role: dashboardRole(user),
    kpis: [
      { id: 'new_leads_today', label: 'New Leads Today', value: stats.new_leads_today, route: 'leads', icon: 'users' },
      { id: 'leads_requiring_follow_up', label: 'Leads Requiring Follow-up', value: stats.leads_requiring_follow_up, route: 'leads', icon: 'phone' },
      { id: 'open_tasks', label: 'Open Tasks', value: stats.open_tasks, route: 'planner', icon: 'calendar' },
      { id: 'overdue_tasks', label: 'Overdue Tasks', value: stats.overdue_tasks, route: 'planner', icon: 'clock' },
      { id: 'unread_emails', label: 'Unread Emails', value: stats.unread_emails, route: 'inbox', icon: 'mail' },
      { id: 'new_applications', label: 'New Applications', value: stats.new_applications, route: 'applications', icon: 'file' }
    ],
    attention: [
      { id: 'no_follow_up', label: `${stats.leads_requiring_follow_up} leads have no follow-up`, value: stats.leads_requiring_follow_up, route: 'leads', kind: stats.leads_requiring_follow_up ? 'amber' : 'green' },
      { id: 'overdue_tasks', label: `${stats.overdue_tasks} tasks are overdue`, value: stats.overdue_tasks, route: 'planner', kind: stats.overdue_tasks ? 'red' : 'green' },
      { id: 'apps_review', label: `${stats.applications_need_review} applications need review`, value: stats.applications_need_review, route: 'applications', kind: stats.applications_need_review ? 'amber' : 'green' },
      { id: 'unread_emails', label: `${stats.unread_emails} unread emails`, value: stats.unread_emails, route: 'inbox', kind: stats.unread_emails ? 'amber' : 'green' },
      { id: 'integration_issues', label: `${stats.integration_issues} integrations have sync issues`, value: stats.integration_issues, route: 'settings', kind: stats.integration_issues ? 'amber' : 'green' }
    ]
  };
}

function loadDashboardAdminOverviewLocal(db, user) {
  const summary = dashboardSummaryFromDb(db);
  const emails = (db.emails || []).filter(email => !emailIsTrashed(email));
  const tasks = db.tasks || [];
  const leads = uniqueLeadsByIdentity(db.leads || []);
  const applications = db.applications || [];
  const events = db.events || [];
  const outboundEmails = emails.filter(email => String(email.direction || 'inbound').toLowerCase() === 'outbound');
  const responseTimes = emails
    .filter(email => String(email.direction || 'inbound').toLowerCase() !== 'outbound')
    .map(email => {
      const start = new Date(email.received_at || email.created_at || 0).getTime();
      if (!start) return null;
      const recipient = normalizeEmail(email.email);
      const subjectKey = emailSubjectKey(email.subject);
      const threadId = String(email.gmail_thread_id || '').trim();
      const reply = outboundEmails
        .filter(sent => {
          const sentAt = new Date(sent.received_at || sent.created_at || 0).getTime();
          if (!sentAt || sentAt < start) return false;
          if (threadId && String(sent.gmail_thread_id || '').trim() === threadId) return true;
          return recipient && normalizeEmail(sent.email) === recipient && subjectKey && emailSubjectKey(sent.subject) === subjectKey;
        })
        .sort((a, b) => new Date(a.received_at || a.created_at || 0) - new Date(b.received_at || b.created_at || 0))[0];
      const end = new Date(reply?.received_at || reply?.created_at || email.response_at || 0).getTime();
      return end && end >= start ? end - start : null;
    })
    .filter(value => Number.isFinite(value));
  const apprenticeshipInterested = new Set();
  for (const email of emails) {
    if (!gmailEnrolmentLabel(email)) continue;
    apprenticeshipInterested.add(String(email.lead_id || email.email || email.id));
  }
  const sourceRows = [...leads.reduce((map, lead) => {
    const key = lead.source_lead_capture || lead.source_first_touch || 'Other';
    const row = map.get(key) || { source: key, leads: 0, enrolled: 0 };
    row.leads += 1;
    if (isEnrolledStage(lead.stage)) row.enrolled += 1;
    map.set(key, row);
    return map;
  }, new Map()).values()].sort((a, b) => b.leads - a.leads).slice(0, 6);
  const chartRows = (items, labelFn, valueFn = () => 1, limit = 8) => [...items.reduce((map, item) => {
    const label = labelFn(item) || 'Other';
    map.set(label, (map.get(label) || 0) + valueFn(item));
    return map;
  }, new Map()).entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
  const newLeads = summary.leads?.total || leads.length;
  const enrolled = summary.applications?.enrolled || leads.filter(lead => isEnrolledStage(lead.stage)).length;
  const overdueTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open' && new Date(task.due_at || 0).getTime() < Date.now()).length;
  const openTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open').length;
  const todayTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open' && taskDueBucket(task) === 'Today').length;
  const upcomingTasks = tasks.filter(task => String(task.status || '').toLowerCase() === 'open' && taskDueBucket(task) === 'Upcoming').length;
  const unreadEmails = emails.filter(emailIsUnread).length;
  const zoomMeetings = events.filter(event => event.zoom_meeting_id || event.zoom_meeting_uuid || String(event.location || '').toLowerCase() === 'zoom').length;
  const upcomingEvents = events.filter(event => new Date(event.start_at || 0).getTime() >= Date.now()).length;
  const sortedResponseTimes = responseTimes.slice().sort((a, b) => a - b);
  const middle = Math.floor(sortedResponseTimes.length / 2);
  const average = sortedResponseTimes.length
    ? sortedResponseTimes.length % 2
      ? sortedResponseTimes[middle]
      : (sortedResponseTimes[middle - 1] + sortedResponseTimes[middle]) / 2
    : 0;
  return {
    generated_at: new Date().toISOString(),
    role: dashboardRole(user),
    kpis: [
      { id: 'reply_average', label: 'Reply Average', value: Math.round(average), format: 'duration', route: 'inbox', icon: 'clock' },
      { id: 'unanswered_emails', label: 'Unanswered Emails', value: summary.emails?.unanswered || 0, route: 'inbox', icon: 'mail' },
      { id: 'apprenticeship_interested', label: 'Apprenticeship Interested', value: apprenticeshipInterested.size, route: 'inbox', icon: 'spark' },
      { id: 'new_leads', label: 'New Leads', value: newLeads, route: 'leads', icon: 'users' },
      { id: 'enrolled', label: 'Enrolled', value: enrolled, route: 'applications', icon: 'shield' }
    ],
    summary_cards: [
      { label: 'Leads', value: newLeads, detail: `${enrolled} enrolled`, route: 'leads', icon: 'users' },
      { label: 'Inbox', value: emails.length, detail: `${summary.emails?.unanswered || 0} unanswered, ${unreadEmails} unread`, route: 'inbox', icon: 'mail' },
      { label: 'Events & Zoom', value: events.length, detail: `${upcomingEvents} upcoming, ${zoomMeetings} Zoom`, route: 'events', icon: 'calendar' },
      { label: 'Enrolled', value: enrolled, detail: 'Confirmed learner records', route: 'applications', icon: 'shield' }
    ],
    funnel: [
      { label: 'New leads', value: newLeads },
      { label: 'Interested', value: apprenticeshipInterested.size },
      { label: 'Enrolled', value: enrolled }
    ],
    email_health: [
      { label: 'Total messages', value: emails.length },
      { label: 'Unanswered', value: summary.emails?.unanswered || 0 },
      { label: 'Replied', value: responseTimes.length },
      { label: 'Avg reply', value: Math.round(average), display: average ? `${Math.round(average / 3600000)}h` : '0m' }
    ],
    lead_sources: sourceRows,
    charts: [
      { title: 'Lead funnel', type: 'bar', rows: [{ label: 'New leads', value: newLeads }, { label: 'Interested', value: apprenticeshipInterested.size }, { label: 'Enrolled', value: enrolled }] },
      { title: 'Lead stages', type: 'bar', rows: chartRows(leads, lead => lead.stage || 'Unstaged') },
      { title: 'Lead sources', type: 'bar', rows: sourceRows.map(row => ({ label: row.source || 'Other', value: row.leads, display: `${row.leads} / ${row.enrolled} enrolled` })) },
      { title: 'Email health', type: 'pie', rows: [{ label: 'Unanswered', value: summary.emails?.unanswered || 0 }, { label: 'Replied', value: responseTimes.length }, { label: 'Unread', value: unreadEmails }] },
      { title: 'Events & Zoom', type: 'pie', rows: [{ label: 'Events', value: Math.max(0, events.length - zoomMeetings) }, { label: 'Zoom', value: zoomMeetings }, { label: 'Upcoming', value: upcomingEvents }] },
      { title: 'Enrolled by programme', type: 'bar', rows: chartRows(applications.filter(app => app.learner || String(app.status || '').toLowerCase() === 'enrolled'), app => app.programme || 'No programme') }
    ]
  };
}

async function loadDashboardAdminOverviewDb(filters, user) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) return loadDashboardAdminOverviewLocal(await loadDb(), user);
  const leadWhere = leadDashboardWhere(filters);
  const emailWhere = emailDashboardWhere(filters);
  const appWhere = applicationDashboardWhere(filters);
  const eventWhere = dashboardWhere(filters, { date: dashboardEventDateExpression('ev') });
  const enrolledAppWhereSql = appendSqlCondition(appWhere.sql, "(a.learner is not null or lower(coalesce(a.status, a.data->>'status', '')) = 'enrolled')");
  const [leadStats, emailStats, appStats, sourceStats, stageStats, eventStats, enrolledProgrammeStats, qualityStats] = await Promise.all([
    postgresPool.query(`
      select
        count(distinct ${dashboardLeadIdentitySql('l')})::int as new_leads,
        count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled')::int as enrolled_leads
      from app_leads l
      ${leadWhere.sql}
    `, leadWhere.params),
    postgresPool.query(`
      select
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')})::int as total_messages,
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and ${dashboardEmailUnreadSql('e')})::int as unread_messages,
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and lower(coalesce(e.data->>'direction', 'inbound')) = 'outbound')::int as outbound_messages,
        count(*) filter (where ${dashboardEmailNotTrashedSql('e')} and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound')::int as inbound_messages,
        count(*) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
            and e.response_at is null
        )::int as unanswered_emails,
        count(*) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
            and e.response_at is not null
            and e.received_at is not null
            and e.response_at >= e.received_at
        )::int as replied_messages,
        coalesce(percentile_cont(0.5) within group (order by extract(epoch from (e.response_at - e.received_at)) * 1000) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and lower(coalesce(e.data->>'direction', 'inbound')) <> 'outbound'
            and e.response_at is not null
            and e.received_at is not null
            and e.response_at >= e.received_at
        ), 0)::float as reply_average_ms,
        count(distinct coalesce(nullif(e.lead_id, ''), nullif(lower(e.email), ''), e.id)) filter (
          where ${dashboardEmailNotTrashedSql('e')}
            and ${dashboardApprenticeshipInterestSql('e')}
        )::int as apprenticeship_interested
      from app_emails e
      left join app_leads l on l.id = e.lead_id
      ${emailWhere.sql}
    `, emailWhere.params),
    postgresPool.query(`
      select
        count(*)::int as applications,
        count(*) filter (where a.learner is not null or lower(coalesce(a.status, a.data->>'status', '')) = 'enrolled')::int as enrolled
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      ${appWhere.sql}
    `, appWhere.params),
    postgresPool.query(`
      select
        coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other') as source,
        count(distinct ${dashboardLeadIdentitySql('l')})::int as leads,
        count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled')::int as enrolled
      from app_leads l
      ${leadWhere.sql}
      group by source
      order by leads desc, source
      limit 6
    `, leadWhere.params),
    postgresPool.query(`
      select
        coalesce(l.stage, l.data->>'stage', 'Unstaged') as label,
        count(distinct ${dashboardLeadIdentitySql('l')})::int as value
      from app_leads l
      ${leadWhere.sql}
      group by label
      order by value desc, label
      limit 8
    `, leadWhere.params),
    postgresPool.query(`
      select
        count(*)::int as total_events,
        count(*) filter (
          where coalesce(ev.data->>'zoom_meeting_id', '') <> ''
             or coalesce(ev.data->>'zoom_meeting_uuid', '') <> ''
             or lower(coalesce(ev.location, ev.data->>'location', '')) = 'zoom'
        )::int as zoom_meetings,
        count(*) filter (where ev.start_at >= now())::int as upcoming,
        count(*) filter (where ev.start_at < now())::int as past,
        coalesce(sum(coalesce(ev.registrations, 0)), 0)::int as registrations,
        coalesce(sum(coalesce(ev.attendance, 0)), 0)::int as attendance
      from app_events ev
      ${eventWhere.sql}
    `, eventWhere.params),
    postgresPool.query(`
      select
        coalesce(a.programme, l.programme, a.data->>'programme', 'No programme') as label,
        count(distinct coalesce(nullif(a.lead_id, ''), a.id))::int as value
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      ${enrolledAppWhereSql}
      group by label
      order by value desc, label
      limit 8
    `, appWhere.params),
    postgresPool.query(`
      with filtered as (
        select l.*
        from app_leads l
        ${leadWhere.sql}
      )
      select
        count(*) filter (where coalesce(nullif(email, ''), nullif(phone, '')) is null)::int as missing_contact,
        count(*) filter (where coalesce(nullif(programme_id, ''), nullif(programme, ''), nullif(data->>'programme_id', '')) is null)::int as missing_programme,
        count(*) filter (where coalesce(nullif(source_lead_capture, ''), nullif(source_first_touch, ''), nullif(data->>'source_lead_capture', ''), nullif(data->>'source_first_touch', '')) is null)::int as missing_source,
        (select count(*)::int from (
          select lower(email) as email_key
          from filtered
          where coalesce(email, '') <> ''
          group by lower(email)
          having count(*) > 1
        ) duplicate_emails) as duplicate_email_groups
      from filtered l
    `, leadWhere.params)
  ]);
  const leads = leadStats.rows[0] || {};
  const emails = emailStats.rows[0] || {};
  const apps = appStats.rows[0] || {};
  const eventRow = eventStats.rows[0] || {};
  const quality = qualityStats.rows[0] || {};
  const newLeads = Number(leads.new_leads || 0);
  const apprenticeshipInterested = Number(emails.apprenticeship_interested || 0);
  const enrolled = Math.max(Number(apps.enrolled || 0), Number(leads.enrolled_leads || 0));
  const totalMessages = Number(emails.total_messages || 0);
  const unansweredEmails = Number(emails.unanswered_emails || 0);
  const unreadEmails = Number(emails.unread_messages || 0);
  const totalEvents = Number(eventRow.total_events || 0);
  const zoomMeetings = Number(eventRow.zoom_meetings || 0);
  const upcomingEvents = Number(eventRow.upcoming || 0);
  const qualityIssues = Number(quality.missing_contact || 0) + Number(quality.missing_programme || 0) + Number(quality.missing_source || 0) + Number(quality.duplicate_email_groups || 0);
  return {
    generated_at: new Date().toISOString(),
    role: dashboardRole(user),
    kpis: [
      { id: 'reply_average', label: 'Reply Average', value: Math.round(Number(emails.reply_average_ms || 0)), format: 'duration', route: 'inbox', icon: 'clock' },
      { id: 'unanswered_emails', label: 'Unanswered Emails', value: unansweredEmails, route: 'inbox', icon: 'mail' },
      { id: 'apprenticeship_interested', label: 'Apprenticeship Interested', value: apprenticeshipInterested, route: 'inbox', icon: 'spark' },
      { id: 'new_leads', label: 'New Leads', value: newLeads, route: 'leads', icon: 'users' },
      { id: 'enrolled', label: 'Enrolled', value: enrolled, route: 'applications', icon: 'shield' }
    ],
    summary_cards: [
      { label: 'Leads', value: newLeads, detail: `${enrolled} enrolled`, route: 'leads', icon: 'users' },
      { label: 'Inbox', value: totalMessages, detail: `${unansweredEmails} unanswered, ${unreadEmails} unread`, route: 'inbox', icon: 'mail' },
      { label: 'Events & Zoom', value: totalEvents, detail: `${upcomingEvents} upcoming, ${zoomMeetings} Zoom`, route: 'events', icon: 'calendar' },
      { label: 'Enrolled', value: enrolled, detail: 'Confirmed learner records', route: 'applications', icon: 'shield' },
      { label: 'Data quality', value: qualityIssues, detail: 'Missing fields and duplicate email groups', route: 'leads', icon: 'shield' }
    ],
    funnel: [
      { label: 'New leads', value: newLeads },
      { label: 'Interested', value: apprenticeshipInterested },
      { label: 'Enrolled', value: enrolled }
    ],
    email_health: [
      { label: 'Total messages', value: totalMessages },
      { label: 'Unanswered', value: unansweredEmails },
      { label: 'Replied', value: Number(emails.replied_messages || 0) },
      { label: 'Avg reply', value: Math.round(Number(emails.reply_average_ms || 0)), display: Math.round(Number(emails.reply_average_ms || 0)) }
    ],
    lead_sources: sourceStats.rows,
    charts: [
      { title: 'Lead funnel', type: 'bar', rows: [{ label: 'New leads', value: newLeads }, { label: 'Interested', value: apprenticeshipInterested }, { label: 'Enrolled', value: enrolled }] },
      { title: 'Lead stages', type: 'bar', rows: stageStats.rows },
      { title: 'Lead sources', type: 'bar', rows: sourceStats.rows.map(row => ({ label: row.source || 'Other', value: Number(row.leads || 0), display: `${Number(row.leads || 0)} / ${Number(row.enrolled || 0)} enrolled` })) },
      { title: 'Email health', type: 'pie', rows: [{ label: 'Inbound', value: Number(emails.inbound_messages || 0) }, { label: 'Outbound', value: Number(emails.outbound_messages || 0) }, { label: 'Unanswered', value: unansweredEmails }, { label: 'Unread', value: unreadEmails }, { label: 'Replied', value: Number(emails.replied_messages || 0) }] },
      { title: 'Events & Zoom', type: 'pie', rows: [{ label: 'Events', value: Math.max(0, totalEvents - zoomMeetings) }, { label: 'Zoom', value: zoomMeetings }, { label: 'Upcoming', value: upcomingEvents }, { label: 'Past', value: Number(eventRow.past || 0) }] },
      { title: 'Enrolled by programme', type: 'bar', rows: enrolledProgrammeStats.rows },
      { title: 'Data quality', type: 'pie', rows: [{ label: 'Missing contact', value: Number(quality.missing_contact || 0) }, { label: 'Missing programme', value: Number(quality.missing_programme || 0) }, { label: 'Missing source', value: Number(quality.missing_source || 0) }, { label: 'Duplicate emails', value: Number(quality.duplicate_email_groups || 0) }] }
    ]
  };
}

async function loadDashboardPipelineDb(filters) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) return { stages: [], stuck: [] };
  const workspace = await postgresPool.query(`select stages from app_workspace where id = $1`, ['main']);
  const stages = Array.isArray(workspace.rows[0]?.stages) ? workspace.rows[0].stages : [];
  const where = leadDashboardWhere(filters);
  const thresholdCase = stages.length
    ? `case ${stages.map((stage, index) => {
        where.params.push(stage);
        where.params.push(DASHBOARD_STAGE_THRESHOLDS[stage] || 7);
        return `when coalesce(l.stage, l.data->>'stage', '') = $${where.params.length - 1} then $${where.params.length}::int`;
      }).join(' ')} else 7 end`
    : '7';
  const result = await postgresPool.query(`
    select
      coalesce(l.stage, l.data->>'stage', 'Unstaged') as stage,
      count(distinct ${dashboardLeadIdentitySql('l')})::int as count,
      count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) in ('lost','not eligible','deferred'))::int as lost,
      round(avg(extract(epoch from (now() - coalesce(l.next_action_at, l.created_at, now()))) / 86400.0)::numeric, 1)::float as avg_time_in_stage_days,
      count(distinct ${dashboardLeadIdentitySql('l')}) filter (where coalesce(l.created_at, now()) < now() - ((${
        thresholdCase
      })::text || ' days')::interval)::int as stuck
    from app_leads l
    ${where.sql}
    group by coalesce(l.stage, l.data->>'stage', 'Unstaged')
  `, where.params);
  const byStage = new Map(result.rows.map(row => [row.stage, row]));
  const orderedStages = [...stages, ...result.rows.map(row => row.stage).filter(stage => !stages.includes(stage))];
  let previous = null;
  const rows = orderedStages.map(stage => {
    const row = byStage.get(stage) || { stage, count: 0, lost: 0, avg_time_in_stage_days: 0, stuck: 0 };
    const count = Number(row.count || 0);
    const conversion = previous && previous.count ? Math.round((count / previous.count) * 100) : null;
    previous = { stage, count };
    return {
      stage,
      count,
      conversion_from_previous: conversion,
      lost: Number(row.lost || 0),
      avg_time_in_stage_days: Number(row.avg_time_in_stage_days || 0),
      stuck: Number(row.stuck || 0),
      threshold_days: DASHBOARD_STAGE_THRESHOLDS[stage] || 7
    };
  });
  return {
    stages: rows,
    stuck: rows.filter(row => row.stuck > 0).map(row => ({
      stage: row.stage,
      count: row.stuck,
      threshold_days: row.threshold_days,
      label: `${row.stuck} leads have been in ${row.stage} for more than ${row.threshold_days} days`
    }))
  };
}

async function loadDashboardMyWorkDb(filters, user) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) return { items: [] };
  const taskFilters = { ...filters, from: '', to: '' };
  const where = taskDashboardWhere(taskFilters);
  const appWhere = applicationDashboardWhere({ ...filters, from: '', to: '' });
  const params = [...where.params, ...appWhere.params];
  const appOffset = where.params.length;
  const appSql = appWhere.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + appOffset}`);
  const result = await postgresPool.query(`
    with work as (
      select
        t.id,
        'task' as type,
        coalesce(t.kind, 'Follow-up') as kind,
        coalesce(t.title, 'Follow up') as title,
        t.due_at as due_at,
        l.id as lead_id,
        trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) as person,
        l.programme,
        case when t.due_at < now() then 0 when t.due_at < current_date + interval '1 day' then 1 else 2 end as rank
      from app_tasks t
      left join app_leads l on l.id = t.lead_id
      ${appendSqlCondition(where.sql, "lower(coalesce(t.status, t.data->>'status', '')) = 'open'")}
      and (t.due_at is null or t.due_at < current_date + interval '7 days')
      union all
      select
        a.id,
        'application' as type,
        'Review' as kind,
        'Application review' as title,
        coalesce(a.created_at, now()) as due_at,
        l.id as lead_id,
        trim(coalesce(a.first_name, l.first_name, '') || ' ' || coalesce(a.last_name, l.last_name, '')) as person,
        coalesce(a.programme, l.programme) as programme,
        1 as rank
      from app_applications a
      left join app_leads l on l.id = a.lead_id
      ${appendSqlCondition(appSql, "lower(coalesce(a.status, a.data->>'status', '')) in ('in review','submitted','pending','eligible')")}
    )
    select * from work
    order by rank, due_at nulls last, id
    limit 20
  `, params);
  return { items: result.rows };
}

async function loadDashboardPriorityLeadsDb(filters) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) return { leads: [] };
  const where = leadDashboardWhere(filters);
  const result = await postgresPool.query(`
    with signals as (
      select
        l.id,
        trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) as name,
        l.programme,
        l.stage,
        l.priority,
        l.owner,
        max(e.received_at) as recent_email_at,
        count(distinct e.id) filter (where e.received_at >= now() - interval '7 days' and ${dashboardEmailNotTrashedSql('e')})::int as recent_email_count,
        count(distinct t.id) filter (where lower(coalesce(t.status, t.data->>'status', '')) = 'open' and t.due_at < now())::int as overdue_tasks,
        count(distinct a.id) filter (where a.created_at >= now() - interval '14 days')::int as recent_applications,
        count(distinct ev.id) filter (where ev.start_at >= now() - interval '14 days')::int as recent_events
      from app_leads l
      left join app_emails e on e.lead_id = l.id
      left join app_tasks t on t.lead_id = l.id
      left join app_applications a on a.lead_id = l.id
      left join app_events ev on ev.attendees @> jsonb_build_array(jsonb_build_object('lead_id', l.id))
      ${where.sql}
      and lower(coalesce(l.stage, l.data->>'stage', '')) not in ('enrolled','lost','not eligible','deferred')
      group by l.id, l.first_name, l.last_name, l.programme, l.stage, l.priority, l.owner
    )
    select *,
      (recent_email_count * 3 + overdue_tasks * 4 + recent_applications * 5 + recent_events * 2
       + case when priority in ('P0','P1') then 2 else 0 end) as score
    from signals
    where recent_email_count > 0 or overdue_tasks > 0 or recent_applications > 0 or recent_events > 0 or priority in ('P0','P1')
    order by score desc, recent_email_at desc nulls last, id
    limit 10
  `, where.params);
  return {
    leads: result.rows.map(row => {
      const reasons = [];
      if (Number(row.recent_applications || 0)) reasons.push('Application started');
      if (Number(row.overdue_tasks || 0)) reasons.push(`${row.overdue_tasks} overdue follow-up${Number(row.overdue_tasks) === 1 ? '' : 's'}`);
      if (Number(row.recent_email_count || 0)) reasons.push('Recent inbound email');
      if (Number(row.recent_events || 0)) reasons.push('Recent event activity');
      if (['P0', 'P1'].includes(row.priority)) reasons.push(`${row.priority} priority`);
      return { ...row, score: Number(row.score || 0), reasons };
    })
  };
}

async function loadDashboardSourcePerformanceDb(filters) {
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) return { sources: [] };
  const where = leadDashboardWhere(filters);
  const result = await postgresPool.query(`
    select
      coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other') as source,
      count(distinct ${dashboardLeadIdentitySql('l')})::int as leads,
      count(distinct ${dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) in ('qualified','application submitted','eligibility','ready for enrolment','enrolled'))::int as qualified,
      count(distinct a.id)::int as applications,
      count(distinct a.id) filter (where a.learner is not null or lower(coalesce(a.status, a.data->>'status', '')) = 'enrolled')::int as enrolled
    from app_leads l
    left join app_applications a on a.lead_id = l.id
    ${where.sql}
    group by source
    order by leads desc, source
    limit 12
  `, where.params);
  return { sources: result.rows };
}

function dashboardIntegrationRow(name, configured, connected, state, lastSyncAt, retryAction, user) {
  const lastError = state?.last_error || '';
  const status = !configured ? 'Disabled' : lastError ? 'Error' : state?.running ? 'Warning' : connected ? 'Healthy' : 'Warning';
  const permissions = permissionsForUser(user);
  return {
    name,
    status,
    last_successful_sync: lastSyncAt || state?.last_result?.last_sync_at || null,
    last_attempted_sync: state?.last_result?.last_sync_at || state?.next_run_at || lastSyncAt || null,
    message: lastError ? String(lastError).replace(/token|secret|key|password|credential/ig, 'credential').slice(0, 180) : '',
    retry_action: permissions.developer ? retryAction : '',
    retry_allowed: Boolean(permissions.developer && retryAction)
  };
}

function dashboardIntegrationHealthRows(user, workspace = {}) {
  return [
    dashboardIntegrationRow('Gmail', gmailConfigured(), Boolean(workspace.gmail?.connected), gmailAutoSyncState, workspace.gmail?.last_sync_at, 'gmail-sync', user),
    dashboardIntegrationRow('Zoom', zoomConfigured(), zoomConfigured(), zoomAutoSyncState, workspace.meta?.zoom?.last_sync_at, 'zoom-sync', user),
    dashboardIntegrationRow('Eventbrite', eventbriteConfigured() || eventbritePrivateTokenConfigured(), Boolean(workspace.eventbrite?.connected || eventbritePrivateTokenConfigured()), eventAutoSyncState, workspace.eventbrite?.last_sync_at, 'eventbrite-sync', user),
    dashboardIntegrationRow('Meta', metaConfigured(), metaConfigured(), { last_result: { last_sync_at: workspace.meta?.last_sync_at }, last_error: null, running: false }, workspace.meta?.last_sync_at, 'meta-sync', user),
    dashboardIntegrationRow('Apollo', apolloConfigured(), apolloConfigured(), { last_result: { last_sync_at: workspace.meta?.apollo?.last_sync_at }, last_error: null, running: false }, workspace.meta?.apollo?.last_sync_at, 'apollo-sync', user),
    dashboardIntegrationRow('Zoho CRM', zohoConfigured(), Boolean(workspace.meta?.zoho?.connected), { last_result: { last_sync_at: workspace.meta?.zoho?.last_sync_at }, last_error: null, running: false }, workspace.meta?.zoho?.last_sync_at, 'zoho-sync', user)
  ];
}

async function loadDashboardIntegrationsDb(user) {
  await ensureStorage();
  let workspace = {};
  if (postgresPool && usesPostgresStorage()) {
    workspace = (await postgresPool.query(`select gmail, eventbrite, meta from app_workspace where id = $1`, ['main'])).rows[0] || {};
  }
  return { integrations: dashboardIntegrationHealthRows(user, workspace) };
}

async function loadDashboardActivityDb(filters, limit = 15) {
  await ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 15), 20));
  if (!postgresPool || !usesPostgresStorage()) return { activity: loadAuditList(await loadDb(), safeLimit) };
  const where = dashboardWhere(filters, {
    date: 'a.occurred_at'
  });
  if (filters.owner_id) {
    where.params.push(filters.owner_id);
    where.sql = appendSqlCondition(where.sql, `(a.entity <> 'lead' or exists (select 1 from app_leads l where l.id = a.entity_id and l.owner_id = $${where.params.length}))`);
  }
  const result = await postgresPool.query(`
    select
      a.id,
      a.occurred_at,
      a.actor,
      a.action,
      a.entity,
      a.entity_id,
      case when a.entity = 'lead' then 'leads/' || a.entity_id else '' end as route
    from app_audit a
    ${where.sql}
    order by a.occurred_at desc nulls last, a.id
    limit $${where.params.length + 1}
  `, [...where.params, safeLimit]);
  return { activity: result.rows };
}

async function loadDashboardSearchDb(query, user) {
  await ensureStorage();
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, leads: [], emails: [], applications: [], tasks: [] };
  const like = `%${q.toLowerCase()}%`;
  const permissions = permissionsForUser(user);
  const ownerClause = permissions.review || permissions.admin || permissions.developer ? '' : 'and coalesce(l.owner_id, \'\') = $2';
  const params = ownerClause ? [like, user.id] : [like];
  if (!postgresPool || !usesPostgresStorage()) return { query: q, leads: [], emails: [], applications: [], tasks: [] };
  const [leads, emails, applications, tasks] = await Promise.all([
    postgresPool.query(`
      select id, trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) as title, email as detail, 'leads/' || id as route
      from app_leads l
      where ${activeLeadCondition('l')} and (lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) like $1 or lower(coalesce(email, '')) like $1 or lower(coalesce(phone, '')) like $1)
      ${ownerClause}
      order by created_at desc nulls last
      limit 10
    `, params),
    postgresPool.query(`
      select e.id, coalesce(e.subject, 'Email') as title, coalesce(e.email, '') as detail, 'inbox' as route
      from app_emails e left join app_leads l on l.id = e.lead_id
      where ${dashboardEmailNotTrashedSql('e')} and (lower(coalesce(e.email, '')) like $1 or lower(coalesce(e.subject, '')) like $1 or lower(coalesce(e.body, '')) like $1)
      ${ownerClause}
      order by e.received_at desc nulls last
      limit 10
    `, params),
    postgresPool.query(`
      select a.id, trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) as title, coalesce(a.programme, '') || ' · ' || coalesce(a.status, '') as detail, 'applications' as route
      from app_applications a left join app_leads l on l.id = a.lead_id
      where lower(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '') || ' ' || coalesce(a.programme, '') || ' ' || coalesce(a.status, '')) like $1
      ${ownerClause}
      order by a.created_at desc nulls last
      limit 10
    `, params),
    postgresPool.query(`
      select t.id, coalesce(t.title, 'Task') as title, coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '') as detail, 'planner' as route
      from app_tasks t left join app_leads l on l.id = t.lead_id
      where lower(coalesce(t.title, '') || ' ' || coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) like $1
      ${ownerClause}
      order by t.due_at asc nulls last
      limit 10
    `, params)
  ]);
  return { query: q, leads: leads.rows, emails: emails.rows, applications: applications.rows, tasks: tasks.rows };
}

// Bookkeeping lists inside integration state that the browser never needs. They made up most
// of the old bootstrap payload (imported id lists, stored Zoho records, cached Zoom calls).
const BOOTSTRAP_STATE_DROP = {
  gmail: ['imported_message_ids'],
  eventbrite: ['imported_attendee_ids', 'imported_event_ids'],
  zoom: ['calls', 'numbers', 'imported_meeting_ids'],
  zoho: ['records', 'imported_record_ids'],
  apollo: ['imported_person_ids']
};

function slimIntegrationState(name, state) {
  const safe = withoutIntegrationSecrets(state && typeof state === 'object' ? { ...state } : {});
  for (const key of BOOTSTRAP_STATE_DROP[name] || []) delete safe[key];
  return safe;
}

// Startup payload: the signed-in user, permissions, lookups (owners, programmes, intakes,
// stages, sources) and integration status. Records come from their own paginated endpoints
// and dashboard totals from GET /api/dashboard/totals, so bootstrap never scans a record
// table and never runs recalculate()/seedDatabase() (which hash the seeded admin password).
// The empty collections stay so tabs still running an older app.js keep working.
const BOOTSTRAP_EXTRA_SOURCES = ['Meta', 'Email', 'Apollo', 'Zoho CRM'];

function bootstrapCorePayload(db, user, degraded = [], trace = null) {
  const integrations = degraded.includes('integrations')
    ? ['Gmail', 'Eventbrite', 'Zoom', 'Meta', 'Apollo', 'Zoho CRM'].map(name => ({ name, status: 'Unknown', detail: 'Connection status could not be loaded. Reload to try again.' }))
    : integrationStatuses(db);
  const permissionsStarted = performance.now();
  const permissions = permissionsForUser(user);
  perfAdd(trace, 'permissions', performance.now() - permissionsStarted);
  return {
    demo: Boolean(db.demo),
    user: publicUser(user),
    permissions,
    demoUser: user.email,
    owners: (db.users || []).map(publicUser),
    programmes: ensureProgrammeCatalog({ programmes: db.programmes || [] }),
    intakes: db.intakes || [],
    stages: db.stages || DEFAULT_STAGES.slice(),
    sources: [...new Set([...(db.sources || DEFAULT_SOURCES), ...BOOTSTRAP_EXTRA_SOURCES])],
    integrations,
    gmail: slimIntegrationState('gmail', db.gmail),
    eventbrite: slimIntegrationState('eventbrite', db.eventbrite),
    zoom: slimIntegrationState('zoom', db.zoom),
    zoho: slimIntegrationState('zoho', db.zoho),
    apollo: slimIntegrationState('apollo', db.apollo),
    ...(degraded.length ? { degraded } : {}),
    leads: [],
    tasks: [],
    emails: [],
    events: [],
    applications: [],
    audit: [],
    attribution: []
  };
}

function bootstrapPayloadQuery() {
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  return {
    label: 'bootstrap_payload',
    values: ['main'],
    sql: `select demo, stages, sources,
       coalesce(gmail, '{}'::jsonb) - 'imported_message_ids' as gmail,
       coalesce(eventbrite, '{}'::jsonb) - 'imported_attendee_ids' - 'imported_event_ids' as eventbrite,
       coalesce(meta->'zoom', '{}'::jsonb) - 'calls' - 'numbers' - 'imported_meeting_ids' as zoom,
       coalesce(meta->'zoho', '{}'::jsonb) - 'records' - 'imported_record_ids' as zoho,
       coalesce(meta->'apollo', '{}'::jsonb) - 'imported_person_ids' as apollo,
       coalesce((select jsonb_agg(p.data order by p.id) from app_programmes p), '[]'::jsonb) as programmes,
       coalesce((select jsonb_agg(i.data order by i.id) from app_intakes i), '[]'::jsonb) as intakes,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', u.id, 'name', u.name, 'email', u.email, 'role', u.role,
           'invited_at', u.invited_at, 'password_changed_at', u.password_changed_at
         ) order by u.created_at, u.id)
         from ${usersTable} u
       ), '[]'::jsonb) as owners
     from app_workspace
     where id = $1`
  };
}

async function loadBootstrapPayload(user, timings = {}, trace = null) {
  await perfPhase(trace, 'bootstrap_storage', () => ensureStorage(trace));
  if (!postgresPool || !usesPostgresStorage()) {
    // MongoDB mode keeps the whole workspace in one document; there is no smaller read.
    return perfPhase(trace, 'mapping', async () => bootstrapCorePayload(await loadDb(), user, [], trace));
  }
  const started = performance.now();
  const query = bootstrapPayloadQuery();
  // One SQL round trip on one connection. Opening several fresh Neon connections in parallel
  // was the shared cold-request bottleneck for bootstrap and Leads.
  const result = await perfPhase(trace, 'bootstrap_db', () => timedPostgresQuery(
    trace,
    query.label,
    query.sql,
    query.values
  ));
  timings.db = performance.now() - started;
  timings.queries = 1;
  const degraded = [];
  const row = result.rows[0] || {};
  const programmes = Array.isArray(row.programmes) ? row.programmes : [];
  const intakes = Array.isArray(row.intakes) ? row.intakes : [];
  const owners = (Array.isArray(row.owners) ? row.owners : []).filter(item => !isLegacyDeveloperEmail(item.email));
  const db = {
    demo: row.demo,
    users: owners.length ? owners : degraded.includes('owners') ? [user] : initialUsers(),
    programmes,
    stages: row.stages,
    sources: row.sources,
    intakes,
    gmail: row.gmail || { connected: false },
    eventbrite: row.eventbrite || { connected: false },
    apollo: row.apollo || {},
    zoho: row.zoho || {},
    zoom: row.zoom || {},
    meta: { zoho: row.zoho || {}, zoom: row.zoom || {}, apollo: row.apollo || {} }
  };
  return perfPhase(trace, 'mapping', async () => bootstrapCorePayload(db, user, degraded, trace));
}

// Local day boundaries sent by the browser (today_start, tomorrow_start) so "overdue" and
// "today" match what the user sees. Without them the server's UTC day is used.
function parseDayBounds(options = {}) {
  const parse = (input, label) => {
    const text = String(input || '').trim();
    if (!text) return null;
    const time = Date.parse(text);
    if (!Number.isFinite(time)) throw statusError(400, `Invalid ${label}.`);
    return new Date(time).toISOString();
  };
  const todayStart = parse(options.today_start, 'today_start');
  const tomorrowStart = parse(options.tomorrow_start, 'tomorrow_start');
  if (todayStart && tomorrowStart) return { todayStart, tomorrowStart, provided: true };
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return { todayStart: start.toISOString(), tomorrowStart: new Date(start.getTime() + 86400000).toISOString(), provided: false };
}

function monitoringSnapshotSchemaSql() {
  return `
    create table if not exists app_monitoring_snapshot (
      id text primary key,
      today_start timestamptz not null,
      tomorrow_start timestamptz not null,
      data jsonb not null,
      generated_at timestamptz not null,
      refreshed_at timestamptz not null default now(),
      expires_at timestamptz not null,
      last_refresh_attempt_at timestamptz,
      last_refresh_error text,
      last_successful_refresh_at timestamptz,
      refresh_lock_until timestamptz
    )
  `;
}

function monitoringSnapshotExpiresIndexSql() {
  return `create index if not exists app_monitoring_snapshot_expires_idx on app_monitoring_snapshot(expires_at)`;
}

function monitoringSnapshotSchemaAlterSqls() {
  return [
    `alter table app_monitoring_snapshot add column if not exists last_refresh_attempt_at timestamptz`,
    `alter table app_monitoring_snapshot add column if not exists last_refresh_error text`,
    `alter table app_monitoring_snapshot add column if not exists last_successful_refresh_at timestamptz`,
    `alter table app_monitoring_snapshot add column if not exists refresh_lock_until timestamptz`
  ];
}

function monitoringSnapshotKey(bounds) {
  return `main:${bounds.todayStart}:${bounds.tomorrowStart}`;
}

async function ensureMonitoringSnapshotSchema(trace = null) {
  await getPostgresPool();
  await tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_table', monitoringSnapshotSchemaSql());
  for (const [index, sql] of monitoringSnapshotSchemaAlterSqls().entries()) {
    await tracedPostgresPoolQuery(trace, `schema_monitoring_snapshot_column_${index + 1}`, sql);
  }
  await tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_expires_index', monitoringSnapshotExpiresIndexSql());
}

function monitoringSnapshotSchemaMissing(error) {
  return ['42P01', '42703'].includes(String(error?.code || ''));
}

function monitoringSnapshotMeta(state, row = {}, ageMs = null, refreshing = false) {
  return {
    state,
    stale: state === 'STALE',
    refreshing: Boolean(refreshing),
    ageMs: ageMs == null ? null : Math.max(0, Math.round(ageMs)),
    generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : null,
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : null,
    lastRefreshAttemptAt: row.last_refresh_attempt_at ? new Date(row.last_refresh_attempt_at).toISOString() : null,
    lastSuccessfulRefreshAt: row.last_successful_refresh_at ? new Date(row.last_successful_refresh_at).toISOString() : null,
    lastRefreshError: row.last_refresh_error || null
  };
}

function monitoringPayloadWithSnapshotMeta(payload, meta) {
  if (!payload || typeof payload !== 'object') return payload;
  return { ...payload, _snapshot: meta };
}

async function readMonitoringSnapshotState(bounds, trace = null) {
  if (!MONITORING_SNAPSHOT_ENABLED) return { state: 'MISSING', payload: null, meta: monitoringSnapshotMeta('MISSING') };
  const key = monitoringSnapshotKey(bounds);
  const cached = monitoringSnapshotMemoryCache.get(key);
  if (cached && MONITORING_SNAPSHOT_MEMORY_CACHE_MS > 0 && Date.now() - cached.cachedAt <= MONITORING_SNAPSHOT_MEMORY_CACHE_MS) {
    perfAdd(trace, 'monitoring_snapshot_memory_cache', 0, { state: cached.state });
    return cached.value;
  }
  const pending = monitoringSnapshotReadPromises.get(key);
  if (pending) {
    perfAdd(trace, 'monitoring_snapshot_read_join', 0);
    return pending;
  }
  const readPromise = (async () => {
  try {
    const result = await monitoringPostgresQuery(trace, 'monitoring_snapshot_read',
      `select data, generated_at, refreshed_at, expires_at, last_refresh_attempt_at, last_refresh_error, last_successful_refresh_at, refresh_lock_until
       from app_monitoring_snapshot
       where id = $1
       limit 1`,
      [key]
    );
    const row = result.rows[0];
    if (!row?.data) {
      const missing = { state: 'MISSING', payload: null, meta: monitoringSnapshotMeta('MISSING') };
      monitoringSnapshotMemoryCache.set(key, { cachedAt: Date.now(), state: missing.state, value: missing });
      return missing;
    }
    const refreshedAt = row.refreshed_at ? new Date(row.refreshed_at).getTime() : 0;
    const ageMs = refreshedAt ? Date.now() - refreshedAt : Number.POSITIVE_INFINITY;
    const state = ageMs <= MONITORING_SNAPSHOT_TTL_MS ? 'FRESH' : 'STALE';
    const refreshing = row.refresh_lock_until ? new Date(row.refresh_lock_until).getTime() > Date.now() : false;
    const meta = monitoringSnapshotMeta(state, row, Number.isFinite(ageMs) ? ageMs : null, refreshing);
    perfAdd(trace, 'monitoring_snapshot_hit', 0, { state, refreshed_at: row.refreshed_at });
    perfAdd(trace, 'snapshot_age', 0, { state, age_ms: Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0 });
    const value = { state, payload: row.data, meta };
    monitoringSnapshotMemoryCache.set(key, { cachedAt: Date.now(), state, value });
    return value;
  } catch (error) {
    if (monitoringSnapshotSchemaMissing(error)) {
      perfAdd(trace, 'monitoring_snapshot_unavailable', 0, { code: error.code || '' });
      const missing = { state: 'MISSING', payload: null, meta: monitoringSnapshotMeta('MISSING') };
      monitoringSnapshotMemoryCache.set(key, { cachedAt: Date.now(), state: missing.state, value: missing });
      return missing;
    }
    throw error;
  } finally {
    monitoringSnapshotReadPromises.delete(key);
  }
  })();
  monitoringSnapshotReadPromises.set(key, readPromise);
  return readPromise;
}

async function writeMonitoringSnapshot(bounds, payload, trace = null) {
  if (!MONITORING_SNAPSHOT_ENABLED || !payload) return false;
  try {
    const snapshotPayload = { ...payload };
    delete snapshotPayload._snapshot;
    await monitoringPostgresQuery(trace, 'monitoring_snapshot_write',
      `insert into app_monitoring_snapshot (id, today_start, tomorrow_start, data, generated_at, refreshed_at, expires_at, last_successful_refresh_at, last_refresh_error, refresh_lock_until)
       values ($1, $2::timestamptz, $3::timestamptz, $4::jsonb, coalesce(($4::jsonb->>'generated_at')::timestamptz, now()), now(), now() + ($5::int * interval '1 millisecond'), now(), null, null)
       on conflict (id) do update set
         today_start = excluded.today_start,
         tomorrow_start = excluded.tomorrow_start,
         data = excluded.data,
         generated_at = excluded.generated_at,
         refreshed_at = excluded.refreshed_at,
         expires_at = excluded.expires_at,
         last_successful_refresh_at = excluded.last_successful_refresh_at,
         last_refresh_error = null,
         refresh_lock_until = null`,
      [monitoringSnapshotKey(bounds), bounds.todayStart, bounds.tomorrowStart, JSON.stringify(snapshotPayload), MONITORING_SNAPSHOT_TTL_MS]
    );
    monitoringSnapshotMemoryCache.set(monitoringSnapshotKey(bounds), {
      cachedAt: Date.now(),
      state: 'FRESH',
      value: {
        state: 'FRESH',
        payload: snapshotPayload,
        meta: monitoringSnapshotMeta('FRESH', {
          generated_at: snapshotPayload.generated_at || new Date().toISOString(),
          refreshed_at: new Date().toISOString(),
          last_successful_refresh_at: new Date().toISOString()
        }, 0, false)
      }
    });
    return true;
  } catch (error) {
    if (monitoringSnapshotSchemaMissing(error)) {
      perfAdd(trace, 'monitoring_snapshot_write_skipped', 0, { code: error.code || '' });
      return false;
    }
    throw error;
  }
}

async function markMonitoringSnapshotRefreshAttempt(bounds, trace = null) {
  try {
    await monitoringPostgresQuery(trace, 'monitoring_snapshot_refresh_attempt',
      `update app_monitoring_snapshot
       set last_refresh_attempt_at = now(),
           refresh_lock_until = now() + ($2::int * interval '1 millisecond')
       where id = $1`,
      [monitoringSnapshotKey(bounds), MONITORING_SNAPSHOT_REFRESH_LOCK_MS]
    );
  } catch (error) {
    if (!monitoringSnapshotSchemaMissing(error)) throw error;
  }
}

async function markMonitoringSnapshotRefreshFailure(bounds, error, trace = null) {
  const message = safeMonitoringRefreshError(error);
  try {
    await monitoringPostgresQuery(trace, 'monitoring_snapshot_refresh_failure',
      `update app_monitoring_snapshot
       set last_refresh_attempt_at = coalesce(last_refresh_attempt_at, now()),
           last_refresh_error = $2,
           refresh_lock_until = null
       where id = $1`,
      [monitoringSnapshotKey(bounds), message]
    );
  } catch (updateError) {
    if (!monitoringSnapshotSchemaMissing(updateError)) console.error(`Monitoring snapshot failure update skipped: ${safeMonitoringRefreshError(updateError)}`);
  }
}

function safeMonitoringRefreshError(error) {
  const code = error?.code ? ` (${error.code})` : '';
  if (error?.status) return `Monitoring refresh failed${code}.`;
  if (postgresConnectionLost(error)) return 'Monitoring refresh failed due to a transient database connection error.';
  return `Monitoring refresh failed${code}.`;
}

async function acquireMonitoringSnapshotRefreshLock(bounds, wait = false) {
  await getPostgresPool();
  const client = await postgresPool.connect();
  const key = monitoringSnapshotKey(bounds);
  try {
    if (wait) {
      await client.query(`select pg_advisory_lock(hashtext($1))`, [key]);
      return client;
    }
    const result = await client.query(`select pg_try_advisory_lock(hashtext($1)) as locked`, [key]);
    if (result.rows[0]?.locked) return client;
    client.release();
    return null;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseMonitoringSnapshotRefreshLock(client, bounds) {
  if (!client) return;
  try {
    await client.query(`select pg_advisory_unlock(hashtext($1))`, [monitoringSnapshotKey(bounds)]);
  } catch {}
  try { client.release(); } catch {}
}

function scheduleMonitoringSnapshotRefresh(bounds, reason = 'stale', delayMs = 0) {
  if (!MONITORING_SNAPSHOT_ENABLED || !usesPostgresStorage()) return;
  const key = monitoringSnapshotKey(bounds);
  if (activeMonitoringSnapshotRefreshKeys.has(key)) return;
  activeMonitoringSnapshotRefreshKeys.add(key);
  const timer = setTimeout(() => {
    refreshMonitoringSnapshotInBackground(bounds, reason).catch(error => {
      console.error(`Monitoring snapshot refresh skipped: ${safeMonitoringRefreshError(error)}`);
    }).finally(() => {
      activeMonitoringSnapshotRefreshKeys.delete(key);
    });
  }, Math.max(0, delayMs || 250));
  if (timer.unref) timer.unref();
}

async function refreshMonitoringSnapshotInBackground(bounds, reason = 'scheduled') {
  await ensureStorage();
  if (!postgresPool) return false;
  const lock = await acquireMonitoringSnapshotRefreshLock(bounds, false);
  if (!lock) return false;
  const trace = null;
  try {
    await markMonitoringSnapshotRefreshAttempt(bounds, trace);
    await loadDashboardMonitoringDb({
      today_start: bounds.todayStart,
      tomorrow_start: bounds.tomorrowStart,
      force_refresh: true
    }, trace);
    return true;
  } catch (error) {
    await markMonitoringSnapshotRefreshFailure(bounds, error, trace);
    console.error(`Monitoring snapshot refresh failed (${reason}): ${safeMonitoringRefreshError(error)}`);
    return false;
  } finally {
    await releaseMonitoringSnapshotRefreshLock(lock, bounds);
  }
}

async function refreshMonitoringSnapshotForeground(bounds, options = {}, trace = null) {
  const lock = await acquireMonitoringSnapshotRefreshLock(bounds, true);
  try {
    const afterLock = await readMonitoringSnapshotState(bounds, trace);
    if (afterLock.state === 'FRESH') return monitoringPayloadWithSnapshotMeta(afterLock.payload, afterLock.meta);
    if (afterLock.state === 'STALE') {
      scheduleMonitoringSnapshotRefresh(bounds, 'stale-after-missing-lock');
      return monitoringPayloadWithSnapshotMeta(afterLock.payload, { ...afterLock.meta, stale: true, refreshing: true });
    }
    await markMonitoringSnapshotRefreshAttempt(bounds, trace);
    return await loadDashboardMonitoringDb({
      ...options,
      today_start: bounds.todayStart,
      tomorrow_start: bounds.tomorrowStart,
      force_refresh: true
    }, trace);
  } finally {
    await releaseMonitoringSnapshotRefreshLock(lock, bounds);
  }
}

function scheduleMonitoringSnapshotLoop(delayMs = MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS) {
  if (!MONITORING_SNAPSHOT_ENABLED || !MONITORING_SNAPSHOT_PROACTIVE_ENABLED || !usesPostgresStorage()) return;
  if (monitoringSnapshotTimer) clearTimeout(monitoringSnapshotTimer);
  monitoringSnapshotTimer = setTimeout(async () => {
    const bounds = parseDayBounds();
    try {
      const state = await readMonitoringSnapshotState(bounds, null);
      if (state.state !== 'FRESH') await refreshMonitoringSnapshotInBackground(bounds, 'scheduled');
    } catch (error) {
      console.error(`Monitoring snapshot scheduler skipped: ${safeMonitoringRefreshError(error)}`);
    } finally {
      scheduleMonitoringSnapshotLoop();
    }
  }, Math.max(1000, delayMs));
  if (monitoringSnapshotTimer.unref) monitoringSnapshotTimer.unref();
}

function startMonitoringSnapshotScheduler() {
  if (!MONITORING_SNAPSHOT_ENABLED || !MONITORING_SNAPSHOT_PROACTIVE_ENABLED || !usesPostgresStorage()) return;
  setTimeout(async () => {
    try {
      const bounds = parseDayBounds();
      const state = await readMonitoringSnapshotState(bounds, null);
      if (state.state !== 'FRESH') scheduleMonitoringSnapshotRefresh(bounds, 'startup', 250);
    } catch (error) {
      console.error(`Monitoring snapshot startup refresh skipped: ${safeMonitoringRefreshError(error)}`);
    }
  }, 1000).unref?.();
  scheduleMonitoringSnapshotLoop(MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS);
}

// Task counts per planner bucket over every task (not just the rows loaded in the browser).
async function loadTaskBucketCounts(db, bounds, trace = null) {
  const queryFn = trace && db === postgresPool ? (sql, params) => timedPostgresQuery(trace, 'tasks_counts', sql, params) : (sql, params) => db.query(sql, params);
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

async function monitoringPostgresQuery(trace, label, sql, params = []) {
  const acquireStarted = performance.now();
  let client = null;
  const beforeAcquire = postgresPoolStats();
  try {
    client = await postgresPool.connect();
    perfAdd(trace, `${label}_pool_acquire`, performance.now() - acquireStarted, {
      pool_before: beforeAcquire,
      pool_after: postgresPoolStats(),
      query_name: `${label}_pool_acquire`
    });
    await client.query('begin');
    await client.query(`set local statement_timeout = ${MONITORING_STATEMENT_TIMEOUT_MS}`);
    const queryStarted = performance.now();
    const result = await client.query(sql, params);
    await client.query('commit');
    perfAdd(trace, `${label}_query`, performance.now() - queryStarted, {
      rows: result.rowCount ?? result.rows?.length ?? 0,
      sql: sqlSummary(sql),
      sql_full: sql,
      params,
      query_name: label
    });
    perfCount(trace, 'postgres_queries');
    return result;
  } catch (error) {
    if (client) await client.query('rollback').catch(() => null);
    perfAdd(trace, `${label}_error`, performance.now() - acquireStarted, {
      sql: sqlSummary(sql),
      query_name: label,
      code: error?.code || ''
    });
    if (error?.code === '57014') {
      const timeoutError = statusError(503, `Monitoring query timed out: ${label}.`);
      timeoutError.code = 'monitoring_query_timeout';
      timeoutError.query_name = label;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (client) {
      try { client.release(); } catch {}
    }
  }
}

// Workspace-wide totals for the CRM, Leads and Events pages, computed in SQL over every record.
// Kept out of bootstrap because they scan app_leads (~0.3 s of Postgres time).
async function loadDashboardTotalsDb(options = {}) {
  const bounds = parseDayBounds(options);
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) {
    const db = recalculate(await loadDb());
    return { dashboard: dashboardSummaryFromDb(db), stats: db.stats, source_counts: db.source_counts, marketing: await loadMarketingSummary(), stage_counts: [], task_counts: null, applications_in_review: 0 };
  }
  const active = activeLeadCondition();
  const [dashboard, sourceCounts, marketing, stageCounts, taskCounts, review] = await Promise.all([
    loadDashboardSummaryDb(),
    postgresPool.query(
      `select source_first_touch as source, count(*)::int as leads, count(*) filter (where stage = 'Enrolled')::int as enrolled
       from app_leads
       where coalesce(source_first_touch, '') <> '' and ${active}
       group by source_first_touch
       order by leads desc`
    ),
    loadMarketingSummary(),
    postgresPool.query(`select coalesce(stage, '') as stage, count(*)::int as total from app_leads where ${active} group by 1 order by 2 desc`),
    loadTaskBucketCounts(postgresPool, bounds),
    postgresPool.query(`select count(*) filter (where lower(coalesce(status, '')) like '%review%')::int as review from app_applications`)
  ]);
  return {
    dashboard,
    stats: {
      active: Number(dashboard.leads?.active || 0),
      applications: Number(dashboard.applications?.total || 0),
      enrolled: Number(dashboard.applications?.enrolled || 0),
      overdue: Number(taskCounts?.overdue ?? dashboard.tasks?.overdue ?? 0),
      unanswered: Number(dashboard.emails?.unanswered || 0)
    },
    source_counts: sourceCounts.rows,
    stage_counts: stageCounts.rows,
    task_counts: taskCounts,
    applications_in_review: Number(review.rows[0]?.review || 0),
    marketing
  };
}

// Everything the Monitoring page shows, aggregated in SQL (it used to count a 200-row sample).
// Six queries in parallel; the stale-lead list is capped at 8 rows.
async function loadDashboardMonitoringDb(options = {}, trace = null) {
  const bounds = parseDayBounds(options);
  await perfPhase(trace, 'monitoring_storage', () => ensureStorage(trace));
  if (!postgresPool || !usesPostgresStorage()) return null;
  perfAdd(trace, 'external_api', 0, { note: 'none' });
  if (!options.force_refresh && !options.bypass_snapshot) {
    const snapshot = await readMonitoringSnapshotState(bounds, trace);
    if (snapshot.state === 'FRESH') return monitoringPayloadWithSnapshotMeta(snapshot.payload, snapshot.meta);
    if (snapshot.state === 'STALE') {
      scheduleMonitoringSnapshotRefresh(bounds, 'stale');
      return monitoringPayloadWithSnapshotMeta(snapshot.payload, { ...snapshot.meta, stale: true, refreshing: true });
    }
    return refreshMonitoringSnapshotForeground(bounds, options, trace);
  }
  const active = activeLeadCondition();
  const activeLeadL = activeLeadCondition('l');
  const activeLeadD = activeLeadCondition('d');
  const closed = `('Enrolled', 'Lost', 'Not Eligible')`;
  const attendeesSql = `app_events e, jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a`;
  const main = await monitoringPostgresQuery(trace, 'monitoring_main',
    `with
       lead_base as (
         select id, owner_id, owner, coalesce(stage, '') as stage, programme, created_at, email, phone, source_first_touch, priority
         from app_leads
         where ${active}
       ),
       lead_stats as (
         select
           count(*)::int as total,
           count(*) filter (where stage not in ${closed})::int as active,
           count(*) filter (where stage = 'Enrolled')::int as enrolled_stage,
           count(*) filter (where created_at >= $1::timestamptz)::int as today,
           count(*) filter (where created_at >= now() - interval '7 days')::int as last_7_days,
           count(*) filter (where created_at >= now() - interval '30 days')::int as last_30_days,
           count(*) filter (where coalesce(email, '') = '' or coalesce(phone, '') = '')::int as missing_contact,
           count(*) filter (where coalesce(programme, '') = '' or coalesce(source_first_touch, '') = '')::int as missing_core,
           count(*) filter (where stage not in ${closed} and created_at < now() - interval '14 days')::int as stale,
           (select count(*) from app_applications)::int as applications,
           (select count(*) from app_applications where learner is not null)::int as enrolled_learners
         from lead_base
       ),
       stage_rows as (
         select stage, count(*)::int as total
         from lead_base group by 1 order by 2 desc
       ),
       programme_rows as (
         select coalesce(nullif(programme, ''), 'No programme') as label, count(*)::int as value
         from lead_base where stage not in ${closed}
         group by 1 order by 2 desc limit 6
       ),
       week_bounds as (
         select i, $2::timestamptz - make_interval(days => 7 * (8 - i)) as start_at, $2::timestamptz - make_interval(days => 7 * (7 - i)) as end_at
         from generate_series(0, 7) as i
       ),
       week_rows as (
         select w.start_at, count(l.id)::int as total
         from week_bounds w
         left join app_leads l on l.created_at >= w.start_at and l.created_at < w.end_at and ${activeLeadL}
         group by w.i, w.start_at order by w.start_at
       ),
       team_rows as (
         select 'leads' as kind, owner_id, owner, count(*)::int as a, count(*) filter (where stage not in ${closed})::int as b, null::float as c from lead_base group by 2, 3
         union all
         select 'tasks', l.owner_id, l.owner, count(*) filter (where t.status = 'Open')::int, count(*) filter (where t.status = 'Open' and t.due_at < $1::timestamptz)::int, null
           from app_tasks t join lead_base l on l.id = t.lead_id group by 2, 3
         union all
         select 'enrolments', l.owner_id, l.owner, count(distinct l.id)::int, 0, null
           from app_applications a join lead_base l on l.id = a.lead_id where a.learner is not null group by 2, 3
         union all
         select 'responses', l.owner_id, l.owner, count(*)::int, 0, avg(extract(epoch from (e.response_at - e.received_at)) * 1000)::float
           from app_emails e join lead_base l on l.id = e.lead_id
           where e.response_at is not null and e.received_at is not null and e.response_at >= e.received_at group by 2, 3
       ),
       risk_row as (
         select
           (select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) from (
              select l.id, l.first_name, l.last_name, l.programme, coalesce(l.stage, '') as stage, l.created_at
              from app_leads l
              where ${activeLeadL} and coalesce(l.stage, '') not in ${closed} and l.created_at < now() - interval '14 days'
              order by l.created_at asc limit 8) x) as stale,
           (select count(*) from lead_base l where l.priority in ('P0', 'P1') and l.stage not in ${closed}
              and not exists (select 1 from app_tasks t where t.lead_id = l.id and t.status = 'Open'))::int as high_no_action,
           (select count(*) from app_applications a where exists (
              select 1 from jsonb_array_elements(case when jsonb_typeof(a.requirements) = 'array' then a.requirements else '[]'::jsonb end) r
              where coalesce(r->'latest'->>'status', '') <> 'Verified'))::int as missing_evidence,
           (select count(*) from app_applications a where a.learner is null and a.status = 'Eligible' and coalesce(a.contract->>'status', '') <> 'Verified')::int as pending_contracts,
           (select count(*) from ${attendeesSql}
              where coalesce(a->>'lead_id', '') = ''
                 or not exists (select 1 from app_tasks t where t.lead_id = a->>'lead_id' and t.status = 'Open'))::int as attendees_no_follow_up
       ),
       task_counts as (
         select
           count(*) filter (where status = 'Open' and due_at < $1::timestamptz)::int as overdue,
           count(*) filter (where status = 'Open' and due_at >= $1::timestamptz and due_at < $2::timestamptz)::int as today,
           count(*) filter (where status = 'Open' and (due_at >= $2::timestamptz or due_at is null))::int as upcoming,
           count(*) filter (where status = 'Open')::int as open,
           count(*) filter (where status = 'Done')::int as done
         from app_tasks
       ),
       quality_row as (
         select
           (select count(*) from (select lower(trim(d.email)) from app_leads d where ${activeLeadD} and coalesce(trim(d.email), '') <> '' group by 1 having count(*) > 1) g)::int as duplicate_emails,
           (select count(*) from (select lower(trim(phone)) from lead_base where coalesce(trim(phone), '') <> '' group by 1 having count(*) > 1) g)::int as duplicate_phones,
           (select count(*) from ${attendeesSql} where coalesce(a->>'lead_id', '') = '')::int as unlinked_attendees
       )
     select
       (select to_jsonb(lead_stats) from lead_stats) as leads,
       coalesce((select jsonb_agg(to_jsonb(stage_rows)) from stage_rows), '[]'::jsonb) as stage_counts,
       coalesce((select jsonb_agg(to_jsonb(programme_rows)) from programme_rows), '[]'::jsonb) as programme_pressure,
       coalesce((select jsonb_agg(to_jsonb(week_rows)) from week_rows), '[]'::jsonb) as weekly_leads,
       coalesce((select jsonb_agg(to_jsonb(team_rows)) from team_rows), '[]'::jsonb) as team_rows,
       (select to_jsonb(risk_row) from risk_row) as risks,
       (select to_jsonb(task_counts) from task_counts) as task_counts,
       (select to_jsonb(quality_row) from quality_row) as quality`,
    [bounds.todayStart, bounds.tomorrowStart]
  );
  const row = main.rows[0] || {};
  const payload = await perfPhase(trace, 'mapping', async () => {
    const teamRows = new Map();
    for (const teamRow of row.team_rows || []) {
      const key = `${teamRow.owner_id || ''}|${teamRow.owner || ''}`;
      const entry = teamRows.get(key) || { owner_id: teamRow.owner_id || '', owner: teamRow.owner || '', leads: 0, active: 0, open_tasks: 0, overdue: 0, enrolments: 0, responses: 0, avg_response_ms: null };
      if (teamRow.kind === 'leads') Object.assign(entry, { leads: teamRow.a, active: teamRow.b });
      if (teamRow.kind === 'tasks') Object.assign(entry, { open_tasks: teamRow.a, overdue: teamRow.b });
      if (teamRow.kind === 'enrolments') entry.enrolments = teamRow.a;
      if (teamRow.kind === 'responses') Object.assign(entry, { responses: teamRow.a, avg_response_ms: teamRow.c });
      teamRows.set(key, entry);
    }
    const riskRow = row.risks || {};
    const leads = row.leads || {};
    return {
      generated_at: new Date().toISOString(),
      bounds: { today_start: bounds.todayStart, tomorrow_start: bounds.tomorrowStart },
      leads,
      stage_counts: (row.stage_counts || []).map(item => ({ stage: item.stage, total: item.total })),
      programme_pressure: row.programme_pressure || [],
      weekly_leads: (row.weekly_leads || []).map(item => ({ week_start: new Date(item.start_at).toISOString(), total: item.total })),
      team: [...teamRows.values()],
      task_counts: row.task_counts || {},
      risks: {
        stale: riskRow.stale || [],
        stale_total: Number(leads.stale || 0),
        high_no_action: riskRow.high_no_action || 0,
        missing_evidence: riskRow.missing_evidence || 0,
        pending_contracts: riskRow.pending_contracts || 0,
        attendees_no_follow_up: riskRow.attendees_no_follow_up || 0
      },
      quality: { ...(row.quality || {}), missing_contact: leads.missing_contact || 0, missing_core: leads.missing_core || 0, invalid_dates: 0 }
    };
  });
  await writeMonitoringSnapshot(bounds, payload, trace);
  return payload;
}

async function refreshMonitoringSnapshotDb(options = {}, trace = null) {
  const bounds = parseDayBounds(options);
  await perfPhase(trace, 'monitoring_storage', () => ensureStorage(trace));
  if (!postgresPool || !usesPostgresStorage()) return null;
  await ensureMonitoringSnapshotSchema(trace);
  return loadDashboardMonitoringDb({ ...options, today_start: bounds.todayStart, tomorrow_start: bounds.tomorrowStart, force_refresh: true }, trace);
}

// Inbox filters answered in PostgreSQL. The SQL mirrors emailMatchesFilters (trash, direction,
// company sender, needs-response, unread, overdue, day and search) and pages with an offset
// cursor; every row is still checked with emailMatchesFilters, so results match the old
// in-memory path. Label filters, name sorts and searches that could match a label text that
// is derived in JavaScript (for example "Zoho" or "Inbox") keep the in-memory path.
const EMAIL_DERIVED_LABEL_WORDS = ['zoho', 'enrolled', 'events', 'contract matter', 'das matter', 'aptem matter', 'resolved', 'inbox', 'trash'];

function emailFiltersSqlCapable(filters) {
  if (filters.label && filters.label !== 'All') return false;
  if (!['newest', 'oldest', 'due-soon'].includes(filters.sort || 'newest')) return false;
  const query = String(filters.search || '').trim().toLowerCase();
  if (!query) return true;
  const labelWords = [...EMAIL_DERIVED_LABEL_WORDS, ...Object.values(GMAIL_SYSTEM_LABELS).map(label => label.toLowerCase())];
  return !labelWords.some(word => word.includes(query) || query.includes(word));
}

function emailFilterSql(db, filters) {
  const values = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  const sender = `lower(trim(coalesce(email, '')))`;
  const trashed = `(coalesce(data->>'trashed_at', '') <> '' or coalesce(data->>'dashboard_folder', '') = 'trash' or coalesce(data->'gmail_labels', '[]'::jsonb) ? 'TRASH')`;
  const outbound = `coalesce(data->>'direction', '') = 'outbound'`;
  // Bound only when a status uses it: Postgres rejects a parameter no statement references.
  let company = '';
  const needsResponse = () => {
    company ||= `(${sender} = any(${bind(companyMailboxEmails(db))}::text[]) or ${sender} ~ '@(kentbusinesscollege\\.org|pathway\\.demo)$')`;
    return `(not ${trashed} and not ${outbound} and not ${company} and response_at is null)`;
  };
  const unread = `(coalesce(data->'gmail_labels', '[]'::jsonb) ? 'UNREAD' or coalesce(data->'gmail_label_names', '[]'::jsonb) ? 'Unread' or coalesce(data->>'is_read', '') = 'false')`;
  const due = `(coalesce(received_at, 'epoch'::timestamptz) + interval '48 hours')`;
  const received = `received_at`;
  const dateValue = received;
  const status = filters.status || 'All';
  const responseStatuses = new Set(['Unanswered', 'Unread', 'Seen, no reply', 'Overdue']);
  const conditions = [];
  if (status === 'Trash') conditions.push(trashed);
  else if (!responseStatuses.has(status)) conditions.push(`not ${trashed}`);
  if (status === 'Sent') conditions.push(outbound);
  if (!['Sent', 'All', 'Trash'].includes(status) && !responseStatuses.has(status)) conditions.push(`not ${outbound}`);
  if (status === 'Unanswered') conditions.push(needsResponse());
  if (status === 'Unread') conditions.push(`${needsResponse()} and ${unread}`);
  if (status === 'Seen, no reply') conditions.push(`${needsResponse()} and not ${unread}`);
  if (status === 'Resolved') conditions.push(`not ${needsResponse()}`);
  if (status === 'Overdue') conditions.push(`${needsResponse()} and received_at < now() - interval '48 hours'`);
  const dayStart = parseEmailFilterDay(filters.day);
  if (dayStart) {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const filterStart = filters.dateField === 'due' ? new Date(dayStart.getTime() - EMAIL_RESPONSE_SLA_MS) : dayStart;
    const filterEnd = filters.dateField === 'due' ? new Date(dayEnd.getTime() - EMAIL_RESPONSE_SLA_MS) : dayEnd;
    conditions.push(`${received} >= ${bind(filterStart.toISOString())}::timestamptz and ${received} < ${bind(filterEnd.toISOString())}::timestamptz`);
  }
  const query = String(filters.search || '').trim().toLowerCase();
  if (query) {
    // Same fields as the in-memory haystack (the summary carries the 260-character snippet,
    // not the full body), plus Gmail label names.
    const snippet = `left(coalesce(data->>'snippet', ''), 260)`;
    conditions.push(`strpos(lower(concat_ws(' ', first_name, last_name, email, email, subject, ${snippet}, owner, data->>'gmail_label_names')), ${bind(query)}) > 0`);
  }
  const order = filters.sort === 'oldest'
    ? `${received} asc, id asc`
    : filters.sort === 'due-soon'
      ? `${received} asc nulls last, id asc`
      : `${received} desc nulls last, id desc`;
  return { where: conditions.join(' and '), order, values, dateValue, due };
}

function normalizeEmailPageOptions(options = {}) {
  const dateFilter = String(options.date_filter || options.dateFilter || '').trim();
  const dateFieldInput = String(options.date_field || options.dateField || dateFilter || 'received').trim().toLowerCase();
  const dayInput = String(options.day || '').trim() || (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter) ? dateFilter : '');
  return {
    status: String(options.status || '').trim(),
    label: String(options.label || '').trim(),
    search: String(options.search || '').trim(),
    day: dayInput,
    dateField: dateFieldInput === 'due' ? 'due' : 'received',
    sort: String(options.sort || 'newest').trim()
  };
}

function safeEmailRequestParams(options = {}, filters = normalizeEmailPageOptions(options)) {
  return {
    limit: Math.max(1, Math.min(Number(options.limit || 50), 100)),
    cursor_present: Boolean(options.cursor),
    status: filters.status || '',
    label: filters.label || '',
    day: filters.day || '',
    date_field: filters.dateField,
    date_filter: String(options.date_filter || options.dateFilter || ''),
    sort: filters.sort || 'newest',
    include_total: String(options.include_total || ''),
    search_present: Boolean(filters.search),
    search_length: filters.search.length,
    owner_present: Boolean(options.owner || options.owner_id),
    folder: String(options.folder || '')
  };
}

function emailFiltersUseKeyset(filters) {
  return (filters.sort || 'newest') === 'newest' && filters.dateField !== 'due';
}

function buildFilteredEmailPageQuery(db, filters, limit, cursor = null) {
  const { where, order, values, dateValue } = emailFilterSql(db, filters);
  const queryValues = values.slice();
  const conditions = [where];
  const bind = value => { queryValues.push(value); return `$${queryValues.length}`; };
  const useKeyset = emailFiltersUseKeyset(filters) && !Number.isInteger(cursor?.offset);
  if (useKeyset && cursor?.id) {
    const idParam = bind(String(cursor.id || ''));
    if (cursor.received_at) {
      const receivedParam = bind(cursor.received_at.toISOString());
      conditions.push(`(${dateValue} < ${receivedParam}::timestamptz or (${dateValue} = ${receivedParam}::timestamptz and id < ${idParam}) or ${dateValue} is null)`);
    } else {
      conditions.push(`(${dateValue} is null and id < ${idParam})`);
    }
  }
  const pageLimit = useKeyset ? limit + 1 : Math.max(limit * 2, 50);
  const limitParam = bind(pageLimit);
  const offsetSql = useKeyset ? '' : ` offset ${bind(Number(cursor?.offset || 0))}`;
  return {
    sql: `select ${emailSummaryDataSql()} as data from app_emails where ${conditions.join(' and ')} order by ${order} limit ${limitParam}${offsetSql}`,
    values: queryValues,
    where,
    order,
    useKeyset,
    pageLimit
  };
}

async function loadFilteredEmailPageSql(db, filters, limit, cursor, options = {}, trace = null) {
  const filterStarted = performance.now();
  const { where, values } = emailFilterSql(db, filters);
  perfAdd(trace, 'email_filter_query', performance.now() - filterStarted, {
    query_name: 'email_filter_query',
    filters: safeEmailRequestParams(options, filters)
  });
  perfAdd(trace, 'gmail_state_query', 0, { query_name: 'gmail_state', note: 'not_called' });
  const includeTotal = !cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  if (emailFiltersUseKeyset(filters) && !Number.isInteger(cursor?.offset)) {
    perfAdd(trace, 'email_path', 0, { path: 'postgres_fast_keyset' });
    const query = buildFilteredEmailPageQuery(db, filters, limit, cursor);
    const result = await timedPostgresQueryWithStatementTimeout(trace, 'emails_page', query.sql, query.values, EMAIL_LIST_STATEMENT_TIMEOUT_MS);
    const total = includeTotal
      ? Number((await timedPostgresQueryWithStatementTimeout(trace, 'emails_count', `select count(*)::int as total from app_emails where ${where}`, values, EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows[0]?.total || 0)
      : null;
    return perfPhase(trace, 'mapping', async () => {
      const rows = result.rows.map(row => row.data);
      const emails = rows.slice(0, limit).map(publicEmailSummary);
      return {
        emails,
        loaded: emails.length,
        total,
        next_cursor: rows.length > limit ? encodeEmailCursor(emails[emails.length - 1]) : '',
        limit,
        has_more: rows.length > limit
      };
    });
  }
  const { order } = emailFilterSql(db, filters);
  perfAdd(trace, 'email_path', 0, { path: 'postgres_filtered_offset' });
  const start = Number(cursor?.offset || 0);
  const batch = Math.max(limit * 2, 50);
  const emails = [];
  let offset = start;
  let exhausted = false;
  let nextOffset = start;
  let more = false;
  while (emails.length <= limit && !exhausted && !more) {
    const rows = (await timedPostgresQueryWithStatementTimeout(trace, 'emails_page',
      `select ${emailSummaryDataSql()} as data from app_emails where ${where} order by ${order} limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, batch, offset],
      EMAIL_LIST_STATEMENT_TIMEOUT_MS
    )).rows.map(row => row.data);
    exhausted = rows.length < batch;
    for (const row of rows) {
      offset += 1;
      if (!emailMatchesFilters(db, row, filters)) continue;
      if (emails.length < limit) {
        emails.push(row);
        nextOffset = offset;
      } else {
        more = true;
        break;
      }
    }
  }
  const total = includeTotal
    ? Number((await timedPostgresQueryWithStatementTimeout(trace, 'emails_count', `select count(*)::int as total from app_emails where ${where}`, values, EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows[0]?.total || 0)
    : null;
  return perfPhase(trace, 'mapping', async () => ({
    emails: emails.map(publicEmailSummary),
    loaded: start + emails.length,
    total,
    next_cursor: more ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url') : '',
    limit,
    has_more: more
  }));
}

async function loadEmailPage(options = {}, trace = null) {
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const cursor = decodeEmailCursor(options.cursor);
  const filters = normalizeEmailPageOptions(options);
  const hasFilters = Boolean(filters.status || filters.label || filters.search || filters.day || filters.dateField === 'due' || filters.sort !== 'newest');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  await perfPhase(trace, 'emails_storage', () => ensureStorage());
  if (hasFilters) {
    // Hot inbox pages avoid a workspace round trip; company-sender checks use env/admin
    // addresses plus the owned domains. Legacy/local storage still has its db object.
    const db = postgresPool ? {} : await loadDb();
    // engine: 'memory' is an internal switch used by scripts/dashboard-api-db-check.js to compare both paths.
    if (postgresPool && options.engine !== 'memory' && emailFiltersSqlCapable(filters)) return loadFilteredEmailPageSql(db, filters, limit, cursor, options, trace);
    // Label filters, name sorts and searches that could match a derived label text: the
    // original in-memory filter, bounded so one inbox request never loads the whole table.
    perfAdd(trace, 'email_path', 0, {
      path: 'bounded_fallback',
      reason: 'filters_not_sql_capable',
      filters: safeEmailRequestParams(options, filters)
    });
    perfAdd(trace, 'gmail_state_query', 0, { query_name: 'gmail_state', note: 'not_called' });
    const fallbackLimit = Math.min(Math.max(limit * 10, 200), 1000);
    const rows = postgresPool
      ? (await timedPostgresQueryWithStatementTimeout(trace, 'fallback', `select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id limit $1`, [fallbackLimit], EMAIL_LIST_STATEMENT_TIMEOUT_MS)).rows.map(item => item.data)
      : (db.emails || []).slice();
    const filtered = rows
      .filter(email => emailMatchesFilters(db, email, filters))
      .sort((a, b) => compareEmailsForFilters(a, b, filters));
    const cursorIndex = cursor ? filtered.findIndex(item => item.id === cursor.id) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageRows = filtered.slice(startIndex, startIndex + limit);
    return {
      emails: pageRows.map(publicEmailSummary),
      loaded: startIndex + pageRows.length,
      total: filtered.length,
      next_cursor: startIndex + pageRows.length < filtered.length ? encodeEmailCursor(pageRows[pageRows.length - 1]) : '',
      limit,
      has_more: startIndex + pageRows.length < filtered.length
    };
  }
  if (postgresPool) {
    perfAdd(trace, 'email_path', 0, { path: 'postgres_unfiltered_keyset' });
    perfAdd(trace, 'gmail_state_query', 0, { query_name: 'gmail_state', note: 'not_called' });
    const totalPromise = includeTotal
      ? timedPostgresQueryWithStatementTimeout(trace, 'emails_count', `select count(*)::int as total from app_emails`, [], EMAIL_LIST_STATEMENT_TIMEOUT_MS)
      : Promise.resolve(null);
    const result = cursor
      ? await timedPostgresQueryWithStatementTimeout(trace, 'emails_page',
        `select ${emailSummaryDataSql()} as data from app_emails
         where (
           ($2::timestamptz is not null and (received_at < $2::timestamptz or (received_at = $2::timestamptz and id < $3) or received_at is null))
           or ($2::timestamptz is null and received_at is null and id < $3)
         )
         order by received_at desc nulls last, id desc
         limit $1`,
        [limit + 1, cursor.received_at ? cursor.received_at.toISOString() : null, cursor.id],
        EMAIL_LIST_STATEMENT_TIMEOUT_MS
      )
      : await timedPostgresQueryWithStatementTimeout(trace, 'emails_page',
        `select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id desc limit $1`,
        [limit + 1],
        EMAIL_LIST_STATEMENT_TIMEOUT_MS
      );
    const countResult = await totalPromise;
    return perfPhase(trace, 'mapping', async () => {
      const rows = result.rows.map(item => item.data);
      const emails = rows.slice(0, limit).map(publicEmailSummary);
      return {
        emails,
        total: countResult ? Number(countResult.rows[0]?.total || 0) : null,
        loaded: emails.length,
        next_cursor: rows.length > limit ? encodeEmailCursor(emails[emails.length - 1]) : '',
        limit,
        has_more: rows.length > limit
      };
    });
  }
  const db = await loadDb();
  const rows = (db.emails || [])
    .slice()
    .sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0) || String(b.id || '').localeCompare(String(a.id || '')));
  const cursorIndex = cursor ? rows.findIndex(item => item.id === cursor.id) : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const emails = rows.slice(startIndex, startIndex + limit).map(publicEmailSummary);
  return {
    emails,
    total: rows.length,
    loaded: emails.length,
    next_cursor: startIndex + emails.length < rows.length ? encodeEmailCursor(emails[emails.length - 1]) : '',
    limit,
    has_more: startIndex + emails.length < rows.length
  };
}

function emailDetailThread(baseEmail, emails = []) {
  const baseThreadId = String(baseEmail.gmail_thread_id || '').trim();
  const baseEmailAddress = normalizeEmail(baseEmail.email || baseEmail.from);
  const baseLeadId = String(baseEmail.lead_id || '');
  const baseSubjectKey = emailSubjectKey(baseEmail.subject);
  const baseTrashed = emailIsTrashed(baseEmail);
  const related = (emails || []).filter(item => {
    if (!item || emailIsTrashed(item) !== baseTrashed) return false;
    if (item.id === baseEmail.id) return true;
    const sameThread = baseThreadId && String(item.gmail_thread_id || '').trim() === baseThreadId;
    if (sameThread) return true;
    const sameSubject = baseSubjectKey && emailSubjectKey(item.subject) === baseSubjectKey;
    if (!sameSubject) return false;
    const sameLead = baseLeadId && String(item.lead_id || '') === baseLeadId;
    const sameMailbox = baseEmailAddress && normalizeEmail(item.email || item.from) === baseEmailAddress;
    return sameLead || sameMailbox;
  });
  const unique = new Map();
  related.forEach(item => unique.set(item.id, item));
  if (!unique.has(baseEmail.id)) unique.set(baseEmail.id, baseEmail);
  return [...unique.values()].sort((a, b) => new Date(a.received_at || a.created_at || 0) - new Date(b.received_at || b.created_at || 0));
}

async function loadEmailDetailThread(baseEmail) {
  if (!postgresPool) return [baseEmail];
  const threadId = String(baseEmail.gmail_thread_id || '').trim();
  const email = normalizeEmail(baseEmail.email || baseEmail.from);
  const leadId = String(baseEmail.lead_id || '');
  const candidates = await postgresPool.query(
    `select data from app_emails
     where id = $1
        or ($2 <> '' and data->>'gmail_thread_id' = $2)
        or ($3 <> '' and lower(coalesce(email, data->>'email', data->>'from', '')) = lower($3))
        or ($4 <> '' and coalesce(lead_id, data->>'lead_id', '') = $4)
     order by received_at asc nulls last, id
     limit 200`,
    [baseEmail.id, threadId, email, leadId]
  );
  return emailDetailThread(baseEmail, candidates.rows.map(item => item.data));
}

async function loadEmailDetail(id) {
  await ensureStorage();
  if (postgresPool) {
    const result = await postgresPool.query(`select data from app_emails where id = $1 limit 1`, [id]);
    if (!result.rows[0]) throw statusError(404, 'Email not found.');
    const email = result.rows[0].data;
    const thread = await loadEmailDetailThread(email);
    return { email: publicEmailDetail(email), thread: thread.map(publicEmailDetail) };
  }
  const db = await loadDb();
  const email = (db.emails || []).find(item => item.id === id);
  if (!email) throw statusError(404, 'Email not found.');
  const thread = emailDetailThread(email, db.emails || []);
  return { email: publicEmailDetail(email), thread: thread.map(publicEmailDetail) };
}

async function loadDeveloperConfigDb() {
  await ensureUserStorage();
  const seeded = seedDatabase();
  if (!postgresPool || !usesPostgresStorage()) {
    const db = await loadDb();
    return { ...seeded, users: db.users, gmail: db.gmail, eventbrite: db.eventbrite, meta: db.meta };
  }
  await removeLegacyPostgresDeveloperUsers();
  const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const users = (await postgresPool.query(
    `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} order by created_at, id`
  )).rows;
  let workspace = null;
  try {
    workspace = (await postgresPool.query(`select gmail, eventbrite, meta from app_workspace where id = $1`, ['main'])).rows[0] || null;
  } catch {
    workspace = null;
  }
  return recalculate({
    ...seeded,
    users,
    gmail: workspace?.gmail || { connected: false, imported_message_ids: [] },
    eventbrite: workspace?.eventbrite || { connected: false, imported_event_ids: [], imported_attendee_ids: [] },
    meta: workspace?.meta || { imported_lead_ids: [], imported_form_ids: [] },
    apollo: workspace?.meta?.apollo || { imported_person_ids: [] }
  });
}

async function createWorkspaceUser(body, actor) {
  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const password = String(body.password || '').trim() || temporaryPassword();
  const role = normalizeWorkspaceRole(body.role || 'member');
  if (!name || !email) throw statusError(400, 'Name and email are required.');
  if (password.length < 8) throw statusError(400, 'Password must be at least 8 characters.');
  if (!role) throw statusError(400, 'Choose a valid role.');
  if (role === 'admin' && !isDeveloperEmail(email)) throw statusError(400, 'Only the configured developer account can use Developer.');
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const existing = await postgresPool.query(`select id from ${table} where email = $1 limit 1`, [email]);
    if (existing.rows[0]) throw statusError(400, 'A user with this email already exists.');
    const user = {
      id: `U-${crypto.randomBytes(8).toString('hex')}`,
      name,
      email,
      role,
      password_hash: hashPassword(password),
      invited_at: new Date().toISOString(),
      password_changed_at: null
    };
    await upsertPostgresUsers([user]);
    dbCache = null;
    return { ok: true, user: publicUser(user), temporary_password: password };
  }
  const db = await loadDb();
  if (db.users.some(item => normalizeEmail(item.email) === email)) throw statusError(400, 'A user with this email already exists.');
  const user = { id: nextId('U', [db.users]), name, email, role, password_hash: hashPassword(password), invited_at: new Date().toISOString(), password_changed_at: null };
  db.users.push(user);
  addAudit(db, actor, 'Team member invited', 'user', email);
  await saveDb(db);
  return { ok: true, user: publicUser(user), temporary_password: password };
}

async function resetWorkspaceUserPassword(userId, body, actor) {
  const password = String(body.password || '').trim() || temporaryPassword();
  if (password.length < 8) throw statusError(400, 'Password must be at least 8 characters.');
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const result = await postgresPool.query(
      `update ${table}
       set password_hash = $2, temporary_password = null, password_changed_at = null, invited_at = coalesce(invited_at, now()), updated_at = now()
       where id = $1
       returning id, name, email, role, invited_at, password_changed_at`,
      [userId, hashPassword(password)]
    );
    if (!result.rows[0]) throw statusError(404, 'User not found.');
    await clearUserSessions(userId);
    dbCache = null;
    return { ok: true, user: result.rows[0], temporary_password: password };
  }
  const db = await loadDb();
  const target = db.users.find(item => item.id === userId);
  if (!target) throw statusError(404, 'User not found.');
  target.password_hash = hashPassword(password);
  target.password_changed_at = null;
  target.invited_at ||= new Date().toISOString();
  await clearUserSessions(target.id);
  addAudit(db, actor, 'Team member password reset', 'user', target.email);
  await saveDb(db);
  return { ok: true, user: publicUser(target), temporary_password: password };
}

async function resetPasswordWithTokenFastDb(body) {
  if (!usesPostgresStorage()) throw statusError(500, 'Password reset requires Neon/PostgreSQL storage.');
  await ensureStorage();
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!token || !password) throw statusError(400, 'Reset token and new password are required.');
  if (password.length < 8) throw statusError(400, 'Password must be at least 8 characters.');
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const resetsTable = sqlIdentifier(POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select r.user_id
       from ${resetsTable} r
       join ${usersTable} u on u.id = r.user_id
       where r.token_hash = $1
         and r.used_at is null
         and r.expires_at > now()
       order by r.created_at desc
       limit 1
       for update of r`,
      [tokenHash(token)]
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) throw statusError(400, 'This reset link is invalid or expired.');
    await client.query(
      `update ${usersTable}
       set password_hash = $2,
           temporary_password = null,
           password_changed_at = now(),
           updated_at = now()
       where id = $1`,
      [userId, hashPassword(password)]
    );
    await client.query(`update ${resetsTable} set used_at = now() where user_id = $1 and used_at is null`, [userId]);
    await client.query('commit');
    await clearUserSessions(userId);
    dbCache = null;
    return { ok: true };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function assertUserCanBeManaged(target, actor, action, nextRole = '') {
  if (!target) throw statusError(404, 'User not found.');
  if (target.id === actor.id) throw statusError(400, `You cannot ${action} your own account.`);
  const targetIsConfiguredDeveloper = isDeveloperEmail(target.email);
  if (nextRole && canonicalWorkspaceRole(nextRole) === 'admin' && !targetIsConfiguredDeveloper) {
    throw statusError(400, 'Only the configured developer account can use Developer.');
  }
  if (targetIsConfiguredDeveloper && (action === 'delete' || (nextRole && canonicalWorkspaceRole(nextRole) !== 'admin'))) {
    throw statusError(400, 'The configured developer account must stay as Developer.');
  }
}

async function updateWorkspaceUserRole(userId, body, actor) {
  const role = normalizeWorkspaceRole(body.role);
  if (!role) throw statusError(400, 'Choose Developer, Monitor or Member.');
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const current = await postgresPool.query(`select id, name, email, role from ${table} where id = $1 limit 1`, [userId]);
    const target = current.rows[0];
    assertUserCanBeManaged(target, actor, 'change the role for', role);
    const result = await postgresPool.query(
      `update ${table} set role = $2, updated_at = now() where id = $1 returning id, name, email, role, invited_at, password_changed_at`,
      [userId, role]
    );
    await clearUserSessions(userId);
    dbCache = null;
    return { ok: true, user: result.rows[0] };
  }
  const db = await loadDb();
  const target = db.users.find(item => item.id === userId);
  assertUserCanBeManaged(target, actor, 'change the role for', role);
  target.role = role;
  await clearUserSessions(target.id);
  addAudit(db, actor, 'Team member role changed', 'user', target.email);
  await saveDb(db);
  return { ok: true, user: publicUser(target) };
}

async function deleteWorkspaceUser(userId, actor) {
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const current = await postgresPool.query(`select id, name, email, role from ${table} where id = $1 limit 1`, [userId]);
    const target = current.rows[0];
    assertUserCanBeManaged(target, actor, 'delete');
    await postgresPool.query(`delete from ${table} where id = $1`, [userId]);
    await clearUserSessions(userId);
    dbCache = null;
    return { ok: true, deleted_id: userId };
  }
  const db = await loadDb();
  const target = db.users.find(item => item.id === userId);
  assertUserCanBeManaged(target, actor, 'delete');
  db.users = db.users.filter(item => item.id !== userId);
  await clearUserSessions(userId);
  addAudit(db, actor, 'Team member deleted', 'user', target.email);
  await saveDb(db);
  return { ok: true, deleted_id: userId };
}

async function loadMarketingSummary() {
  if (!postgresPool) return null;
  try {
    const result = await postgresPool.query(`
      select
        coalesce(sum(m.revenue), 0)::float as revenue,
        coalesce(sum(m.ticket_sales), 0)::int as ticket_sales,
        coalesce(sum(m.delivered), 0)::int as delivered,
        coalesce(sum(m.opened), 0)::int as opened,
        coalesce(sum(m.clicks), 0)::int as clicks,
        coalesce(sum(m.unsubscribed), 0)::int as unsubscribed,
        coalesce(sum(m.bounced), 0)::int as bounced,
        coalesce(max((s.data->>'fallback_unsubscribe_rate')::numeric), 0)::float as fallback_unsubscribe_rate,
        coalesce(max((s.data->>'fallback_bounce_rate')::numeric), 0)::float as fallback_bounce_rate
      from app_marketing_campaign_metrics m
      cross join app_marketing_settings s
      where s.id = 'main'
    `);
    const row = result.rows[0] || {};
    const delivered = Number(row.delivered || 0);
    const fallbackUnsubRate = Number(row.fallback_unsubscribe_rate || 0);
    const fallbackBounceRate = Number(row.fallback_bounce_rate || 0);
    const unsubscribed = Number(row.unsubscribed || 0) || Math.round(delivered * fallbackUnsubRate);
    const bounced = Number(row.bounced || 0) || Math.round(delivered * fallbackBounceRate);
    return {
      revenue: Number(row.revenue || 0),
      ticket_sales: Number(row.ticket_sales || 0),
      delivered,
      opened: Number(row.opened || 0),
      clicks: Number(row.clicks || 0),
      unsubscribed,
      bounced,
      unsubscribe_rate: delivered ? unsubscribed / delivered : 0,
      bounce_rate: delivered ? bounced / delivered : 0,
      source: 'app_marketing_*'
    };
  } catch {
    return null;
  }
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 10) return `${text.slice(0, 2)}...${text.slice(-2)}`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function envKeyStatus(key, label = key, secret = /SECRET|TOKEN|PASS|PASSWORD|DATABASE|URI|URL/i.test(key)) {
  const value = process.env[key] || '';
  return {
    key,
    label,
    configured: Boolean(value),
    value: value ? (secret ? maskSecret(value) : value) : '',
    secret
  };
}

function isLocalRequest(req) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const address = String(req.socket.remoteAddress || '');
  const hostLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  const socketLocal = address === '::1' || address === '127.0.0.1' || address.endsWith(':127.0.0.1');
  return hostLocal && socketLocal;
}

function configuredDeveloperEmail() {
  return configuredDeveloperEmails()[0] || '';
}

function configuredDeveloperEmails() {
  return uniqueStrings([
    DEFAULT_DEVELOPER_EMAIL,
    process.env.DEV_PANEL_EMAIL
  ].map(normalizeEmail).filter(Boolean));
}

function isDeveloperEmail(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && configuredDeveloperEmails().includes(normalized));
}

function canUseDeveloperDashboard(req, user) {
  return Boolean(user && isDeveloperEmail(user.email));
}

function requireDeveloperAccess(req, user) {
  if (!canUseDeveloperDashboard(req, user)) {
    throw statusError(403, 'Developer dashboard is only available to the configured developer account.');
  }
}

function developerConfig(req, db) {
  return {
    local_only: !configuredDeveloperEmail(),
    storage: storageMode(),
    users: (db.users || []).map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      role_key: visibleWorkspaceRoleKey(user),
      role_label: visibleWorkspaceRoleKey(user) === 'developer' ? 'Developer' : visibleWorkspaceRoleKey(user) === 'monitor' ? 'Monitor' : 'Member',
      is_configured_developer: isConfiguredDeveloperUser(user),
      invited_at: user.invited_at || '',
      password_changed_at: user.password_changed_at || '',
      // True while an invited or reset user still signs in with the password they were given.
      password_temporary: Boolean(user.invited_at) && !user.password_changed_at && !isConfiguredDeveloperUser(user)
    })),
    server: [
      envKeyStatus('PORT', 'Backend port', false),
      envKeyStatus('DATABASE_URL', 'Primary database URL', true),
      envKeyStatus('DATABASE_NAME', 'Database name', false),
      envKeyStatus('POSTGRES_STATE_TABLE', 'Postgres state table', false),
      envKeyStatus('DEV_PANEL_EMAIL', 'Developer panel email', false)
    ],
    integrations: [
      {
        name: 'Gmail',
        status: db.gmail?.connected ? 'Connected' : gmailConfigured() ? 'Ready to connect' : 'Needs credentials',
        account: db.gmail?.email || '',
        callback: gmailRedirectUri(req),
        keys: [
          envKeyStatus('GMAIL_CLIENT_ID', 'OAuth client ID', false),
          envKeyStatus('GMAIL_CLIENT_SECRET', 'OAuth client secret', true),
          envKeyStatus('GMAIL_REDIRECT_URI', 'OAuth redirect URI', false),
          envKeyStatus('GMAIL_SMTP_USER', 'SMTP user', false),
          envKeyStatus('GMAIL_SMTP_PASS', 'SMTP app password', true)
        ]
      },
      {
        name: 'Eventbrite',
        status: db.eventbrite?.connected || eventbritePrivateTokenConfigured() ? 'Connected' : eventbriteConfigured() ? 'Ready to connect' : 'Needs credentials',
        account: db.eventbrite?.name || '',
        callback: eventbriteRedirectUri(req),
        keys: [
          envKeyStatus('EVENTBRITE_CLIENT_ID', 'OAuth client ID', false),
          envKeyStatus('EVENTBRITE_CLIENT_SECRET', 'OAuth client secret', true),
          envKeyStatus('EVENTBRITE_REDIRECT_URI', 'OAuth redirect URI', false),
          envKeyStatus('EVENTBRITE_PRIVATE_TOKEN', 'Private token', true)
        ]
      },
      {
        name: 'Meta Lead Ads',
        status: metaConfigured() ? 'Connected' : 'Needs credentials',
        account: process.env.META_PAGE_ID || '',
        callback: '',
        keys: [
          envKeyStatus('META_ACCESS_TOKEN', 'Page access token', true),
          envKeyStatus('META_PAGE_ID', 'Page ID', false),
          envKeyStatus('META_FORM_IDS', 'Allowed form IDs', false),
          envKeyStatus('META_GRAPH_VERSION', 'Graph API version', false)
        ]
      },
      {
        name: 'Zoom',
        status: zoomConfigured() ? 'Connected' : 'Needs credentials',
        account: process.env.ZOOM_USER_ID || 'me',
        callback: '',
        keys: [
          envKeyStatus('ZOOM_ACCOUNT_ID', 'Server-to-Server account ID', true),
          envKeyStatus('ZOOM_CLIENT_ID', 'Client ID', false),
          envKeyStatus('ZOOM_CLIENT_SECRET', 'Client secret', true),
          envKeyStatus('ZOOM_USER_ID', 'Meeting host user ID', false),
          envKeyStatus('ZOOM_MEETING_TYPE', 'Meeting list type', false),
          envKeyStatus('ZOOM_SYNC_ALL_USERS', 'Sync all account users', false),
          envKeyStatus('ZOOM_MAX_USERS', 'Maximum users per sync', false),
          envKeyStatus('ZOOM_MAX_MEETINGS', 'Maximum meetings per sync', false)
        ]
      },
      {
        name: 'Apollo',
        status: apolloConfigured() ? 'Connected' : 'Needs credentials',
        account: process.env.APOLLO_KEYWORDS || process.env.APOLLO_PERSON_TITLES || '',
        callback: '',
        keys: [
          envKeyStatus('APOLLO_API_KEY', 'API key', true),
          envKeyStatus('APOLLO_KEYWORDS', 'Keyword search', false),
          envKeyStatus('APOLLO_PERSON_TITLES', 'Person titles', false),
          envKeyStatus('APOLLO_PERSON_LOCATIONS', 'Person locations', false),
          envKeyStatus('APOLLO_PER_PAGE', 'Results per sync', false)
        ]
      },
      {
        name: 'Zoho CRM',
        status: zohoConnectionDiagnostics(req, db).connected ? 'Connected' : zohoConnectionDiagnostics(req, db).reauthorizationRequired ? 'Reconnect required' : zohoConfigured() ? 'Ready to connect' : 'Needs credentials',
        account: db.zoho?.email || db.zoho?.api_domain || '',
        callback: zohoRedirectUri(req),
        keys: [
          envKeyStatus('ZOHO_CLIENT_ID', 'OAuth client ID', false),
          envKeyStatus('ZOHO_CLIENT_SECRET', 'OAuth client secret', true),
          envKeyStatus('ZOHO_REDIRECT_URI', 'OAuth redirect URI', false),
          envKeyStatus('ZOHO_AUTH_ACCOUNTS_URL', 'Authorization accounts URL', false),
          envKeyStatus('ZOHO_ACCOUNTS_URL', 'Accounts URL', false),
          envKeyStatus('ZOHO_API_BASE_URL', 'API base URL', false),
          envKeyStatus('ZOHO_SCOPES', 'OAuth scopes', false),
          envKeyStatus('ZOHO_SYNC_MODULES', 'Modules to sync', false)
        ]
      }
    ]
  };
}

function publicApplication(app) {
  return {
    ...app,
    requirements: (app.requirements || []).map(req => ({
      ...req,
      latest: req.latest ? { ...req.latest, content_base64: undefined } : null
    }))
  };
}

function loadApplicationList(db) {
  const enrolledLeadIds = new Set((db.leads || [])
    .filter(lead => lead?.id && !lead.deleted_at && isEnrolledStage(lead.stage))
    .map(lead => String(lead.id)));
  return (db.applications || [])
    .filter(app => enrolledLeadIds.has(String(app.lead_id || '')))
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(publicApplication);
}

function loadAuditList(db, limit = 100) {
  return (db.audit || [])
    .slice()
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))
    .slice(0, Math.max(1, Math.min(Number(limit || 100), 250)));
}

function loadAttributionList(db, limit = 100) {
  return (db.attribution || [])
    .slice()
    .sort((a, b) => new Date(b.learner?.enrolled_at || b.created_at || 0) - new Date(a.learner?.enrolled_at || a.created_at || 0))
    .slice(0, Math.max(1, Math.min(Number(limit || 100), 250)));
}

async function loadApplicationListDb(options = {}, trace = null) {
  await perfPhase(trace, 'applications_storage', () => ensureStorage());
  const safeLimit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const safeOffset = Math.max(0, Number(options.offset || 0));
  const cursor = decodePageCursor(options.cursor, 'application cursor');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const filters = {
    status: String(options.status || '').trim(),
    programme: String(options.programme || options.programme_id || '').trim(),
    intake: String(options.intake || options.intake_id || '').trim(),
    owner: String(options.owner || options.owner_id || '').trim(),
    source: String(options.source || '').trim(),
    search: String(options.search || '').trim().slice(0, 200),
    createdFrom: parseOptionalIsoDate(options.created_from, 'created_from'),
    createdTo: parseOptionalIsoDate(options.created_to, 'created_to')
  };
  if (!options.cursor) await runEnrolledLeadApplicationBackfill();
  if (postgresPool) {
    const values = [];
    const conditions = [
      `${activeLeadCondition('l')} and lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled'`
    ];
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (filters.status) conditions.push(`a.status = ${bind(filters.status)}`);
    if (filters.programme) conditions.push(`(a.programme = ${bind(filters.programme)} or a.data->>'programme_id' = $${values.length})`);
    if (filters.intake) conditions.push(`(a.intake = ${bind(filters.intake)} or a.data->>'intake_id' = $${values.length})`);
    if (filters.owner) conditions.push(`(l.owner_id = ${bind(filters.owner)} or a.manager = $${values.length} or a.data->>'owner_id' = $${values.length})`);
    if (filters.source) {
      const sourceParam = bind(filters.source);
      conditions.push(`(l.source_first_touch = ${sourceParam} or l.source_lead_capture = ${sourceParam} or a.data->>'source' = ${sourceParam})`);
    }
    if (filters.createdFrom) conditions.push(`a.created_at >= ${bind(filters.createdFrom)}::timestamptz`);
    if (filters.createdTo) conditions.push(`a.created_at < ${bind(filters.createdTo)}::timestamptz`);
    if (filters.search) {
      const term = bind(`%${escapeSqlLike(filters.search)}%`);
      conditions.push(`(
        a.first_name ilike ${term} or a.last_name ilike ${term} or a.programme ilike ${term} or a.status ilike ${term}
        or l.email ilike ${term} or l.first_name ilike ${term} or l.last_name ilike ${term}
      )`);
    }
    if (cursor?.id) {
      if (cursor.created_at) {
        const createdParam = bind(cursor.created_at);
        const idParam = bind(String(cursor.id || ''));
        conditions.push(`(a.created_at < ${createdParam}::timestamptz or (a.created_at = ${createdParam}::timestamptz and a.id < ${idParam}) or a.created_at is null)`);
      } else {
        conditions.push(`(a.created_at is null and a.id < ${bind(String(cursor.id || ''))})`);
      }
    }
    const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const listValues = cursor ? [...values, safeLimit + 1] : [...values, safeLimit + 1, safeOffset];
    const [result, total] = await Promise.all([
      timedPostgresQuery(trace, 'applications_page',
        `select a.data, a.created_at
         from app_applications a
         left join app_leads l on l.id = a.lead_id
         ${whereSql}
         order by a.created_at desc nulls last, a.id desc
         limit $${cursor ? listValues.length : listValues.length - 1}${cursor ? '' : ` offset $${listValues.length}`}`,
        listValues
      ),
      includeTotal ? timedPostgresQuery(trace, 'applications_count', `select count(*)::int as count from app_applications a left join app_leads l on l.id = a.lead_id ${whereSql}`, values) : Promise.resolve(null)
    ]);
    return perfPhase(trace, 'mapping', async () => {
      const pageRows = result.rows.slice(0, safeLimit);
      const applications = pageRows.map(item => publicApplication(item.data));
      const count = total ? Number(total.rows[0]?.count || 0) : null;
      const last = pageRows[pageRows.length - 1];
      const nextCursor = result.rows.length > safeLimit && last?.data?.id ? encodePageCursor({ created_at: last.created_at || last.data.created_at || null, id: last.data.id }) : '';
      return {
        applications,
        total: count,
        offset: safeOffset,
        limit: safeLimit,
        loaded: safeOffset + applications.length,
        has_more: Boolean(nextCursor),
        hasMore: Boolean(nextCursor),
        next_cursor: nextCursor,
        nextCursor,
        next_offset: safeOffset + applications.length
      };
    });
  }
  const all = loadApplicationList(await loadDb());
  const filtered = all
    .filter(app => !filters.status || String(app.status || '') === filters.status)
    .filter(app => !filters.programme || String(app.programme || app.programme_id || '') === filters.programme)
    .filter(app => !filters.intake || String(app.intake || app.intake_id || '') === filters.intake)
    .filter(app => !filters.owner || String(app.owner_id || app.manager || '') === filters.owner)
    .filter(app => !filters.source || String(app.source || '') === filters.source)
    .filter(app => !filters.createdFrom || new Date(app.created_at || 0) >= new Date(filters.createdFrom))
    .filter(app => !filters.createdTo || new Date(app.created_at || 0) < new Date(filters.createdTo))
    .filter(app => !filters.search || JSON.stringify(app).toLowerCase().includes(filters.search.toLowerCase()));
  const cursorIndex = cursor?.id ? filtered.findIndex(app => app.id === cursor.id) + 1 : safeOffset;
  const start = Math.max(0, cursorIndex || 0);
  const applications = filtered.slice(start, start + safeLimit);
  const nextCursor = start + applications.length < filtered.length ? encodePageCursor({ created_at: applications[applications.length - 1]?.created_at || null, id: applications[applications.length - 1]?.id || '' }) : '';
  return {
    applications,
    total: filtered.length,
    offset: start,
    limit: safeLimit,
    loaded: start + applications.length,
    has_more: Boolean(nextCursor),
    hasMore: Boolean(nextCursor),
    next_cursor: nextCursor,
    nextCursor,
    next_offset: start + applications.length
  };
}

async function nextPostgresId(client, table, prefix) {
  const safeTable = sqlIdentifier(table, table);
  const result = await client.query(
    `select coalesce(max((substring(id from $1))::int), 0) + 1 as next from ${safeTable}`,
    [`^${prefix}-(\\d+)$`]
  );
  return `${prefix}-${Number(result.rows[0]?.next || 1)}`;
}

const APPLICATION_DOCUMENT_TEMPLATES = [
  ['training_plan', 'Training Plan', 'TrainingPlan-Training Plan v3 (5).pdf', 'assets/documents/TrainingPlan-Training Plan v3 (5).pdf'],
  ['onboarding_ilr', 'OnBoarding ILR', 'OnBoarding-ILR (3).pdf', 'assets/documents/OnBoarding-ILR (3).pdf'],
  ['employer_agreement', 'Employer Agreement Form', 'EmployerAgreementForm - Generic.pdf', 'assets/documents/EmployerAgreementForm - Generic.pdf'],
  ['written_agreement', 'Apprenticeship Written Agreement', 'Apprenticeship-WrittenAgreement V1.1 (2).pdf', 'assets/documents/Apprenticeship-WrittenAgreement V1.1 (2).pdf'],
  ['apprenticeship_agreement', 'Apprenticeship Agreement', 'ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf', 'assets/documents/ApprenticeshipAgreement-Apprenticeship Agreement v5 (3).pdf']
];

async function seedDocumentTemplatesFromDisk() {
  if (!postgresPool) return;
  for (const [key, title, filename, assetPath] of APPLICATION_DOCUMENT_TEMPLATES) {
    const filePath = path.join(ROOT, assetPath || filename);
    let content = null;
    try {
      content = await fs.promises.readFile(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    await postgresPool.query(
      `insert into app_document_templates (key, title, filename, content_type, content, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (key) do update set
         title = excluded.title,
         filename = excluded.filename,
         content_type = excluded.content_type,
         content = excluded.content,
         updated_at = now()`,
      [key, title, filename, 'application/pdf', content]
    );
  }
}

function applicationRequirements(appId, files = [], options = {}) {
  const byKey = new Map((Array.isArray(files) ? files : []).map(file => [String(file.key || ''), file]));
  return APPLICATION_DOCUMENT_TEMPLATES.map(([key, title], index) => {
    const file = byKey.get(key);
    return {
      id: `R-${appId}-${index + 1}`,
      key,
      title,
      latest: file?.content_base64 ? {
        id: `ER-${appId}-${index + 1}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        filename: String(file.filename || title),
        version: 1,
        status: options.verified ? 'Verified' : 'Pending',
        reviewer: options.verified ? options.reviewer || null : null,
        reviewed_at: options.verified ? new Date().toISOString() : null,
        content_base64: file.content_base64
      } : null
    };
  });
}

function applicationLearnerFromBody(body) {
  if (!body.already_enrolled) return null;
  return {
    external_reference: body.learner_reference || body.external_reference || 'Already enrolled',
    enrolled_at: body.enrolled_at || new Date().toISOString(),
    note: body.enrolment_note || 'Added as an existing enrolled learner.'
  };
}

function isEnrolledStage(stage) {
  return String(stage || '').trim().toLowerCase() === 'enrolled';
}

function automaticEnrolledLearner(lead, now = new Date().toISOString()) {
  return {
    external_reference: lead.learner_reference || lead.external_reference || `AUTO-${lead.id}`,
    enrolled_at: lead.enrolled_at || now,
    note: 'Application created automatically because the lead is enrolled.'
  };
}

function automaticApplicationFromLead(appId, lead, user, now = new Date().toISOString()) {
  const learner = automaticEnrolledLearner(lead, now);
  return {
    id: appId,
    lead_id: lead.id,
    first_name: lead.first_name,
    last_name: lead.last_name,
    programme: lead.programme,
    intake: lead.intake || 'Next intake',
    status: 'Enrolled',
    manager: user?.name || lead.owner || 'System',
    member: lead.first_name,
    created_at: now,
    contract: { status: 'Verified', note: 'Lead was already enrolled; application was created automatically.' },
    requirements: applicationRequirements(appId, [], { verified: true, reviewer: user?.name || 'System' }),
    learner
  };
}

const automaticApplicationFromEnrolledLead = automaticApplicationFromLead;

async function ensureApplicationForLeadFastDb(client, lead, user, options = {}) {
  if (!AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS || !lead?.id || !isEnrolledStage(lead.stage)) return null;
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`auto-application:${lead.id}`]);
  const existing = await client.query(`select data from app_applications where lead_id = $1 limit 1`, [lead.id]);
  if (existing.rows[0]) return null;
  const now = options.now || new Date().toISOString();
  const appId = await nextPostgresId(client, 'app_applications', 'A');
  const app = automaticApplicationFromLead(appId, lead, user, now);
  await client.query(
    `insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
    [app.id, app.lead_id, app.first_name, app.last_name, app.programme, app.intake, app.status, app.manager, app.member, app.created_at, jsonValue(app.contract), jsonValue(app.requirements), jsonValue(app.learner), jsonValue(app)]
  );
  const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
  const attribution = { ...lead, programme: app.programme, snapshot };
  await client.query(
    `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
    [lead.id, lead.email, app.programme, jsonValue(attribution)]
  );
  await appendAuditFast(client, user || { name: 'System' }, options.auditAction || 'Application auto-created for lead', 'lead', lead.id, app.id);
  return { application: app, attribution };
}

const ensureApplicationForEnrolledLeadFastDb = ensureApplicationForLeadFastDb;

async function createApplicationFastDb(body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    const intakeResult = body.intake_id
      ? await client.query(`select data from app_intakes where id = $1 limit 1`, [body.intake_id])
      : { rows: [] };
    const intake = intakeResult.rows[0]?.data || null;
    const now = new Date().toISOString();
    const appId = await nextPostgresId(client, 'app_applications', 'A');
    const learner = applicationLearnerFromBody(body);
    const alreadyEnrolled = Boolean(learner);
    const documentsNeedSignature = Boolean(body.documents_need_signature);
    const evidenceVerified = alreadyEnrolled && !documentsNeedSignature;
    const app = {
      id: appId,
      lead_id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      programme: lead.programme,
      intake: intake?.name || 'Next intake',
      status: alreadyEnrolled ? 'Enrolled' : 'In review',
      manager: user.name,
      member: lead.first_name,
      created_at: now,
      contract: evidenceVerified ? { status: 'Verified', note: 'Existing enrolled learner documents uploaded.' } : { status: 'Draft', note: documentsNeedSignature ? 'Documents uploaded for learner signature.' : undefined },
      requirements: applicationRequirements(appId, body.evidence_files, { verified: evidenceVerified, reviewer: user.name }),
      learner
    };
    lead.stage = alreadyEnrolled ? 'Enrolled' : 'Application Submitted';
    await client.query(
      `update app_leads set stage = $2, data = $3::jsonb where id = $1`,
      [lead.id, lead.stage, jsonValue(lead)]
    );
    await client.query(
      `insert into app_applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, requirements, learner, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
      [app.id, app.lead_id, app.first_name, app.last_name, app.programme, app.intake, app.status, app.manager, app.member, app.created_at, jsonValue(app.contract), jsonValue(app.requirements), jsonValue(app.learner), jsonValue(app)]
    );
    let attribution = null;
    if (alreadyEnrolled) {
      const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
      attribution = { ...lead, programme: app.programme, snapshot };
      await client.query(
        `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
        [lead.id, lead.email, app.programme, jsonValue(attribution)]
      );
    }
    const audit = {
      id: `AU-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      occurred_at: now,
      actor: user.name,
      action: alreadyEnrolled ? 'Existing learner enrolled' : 'Application started',
      entity: 'lead',
      entity_id: lead.id
    };
    await client.query(
      `insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)`,
      [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, jsonValue(audit)]
    );
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app), lead, attribution };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function appendAuditFast(client, user, action, entity, entityId, detail = '') {
  const audit = {
    id: `AU-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    occurred_at: new Date().toISOString(),
    actor: user.name,
    action: detail ? `${action}: ${detail}` : action,
    entity,
    entity_id: entityId
  };
  await client.query(
    `insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
     values ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)`,
    [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, jsonValue(audit)]
  );
  return audit;
}

async function updateLeadFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_leads where id = $1 for update`, [id]);
    const lead = result.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    if (body.stage !== undefined) lead.stage = body.stage;
    if (body.owner_id !== undefined) lead.owner_id = body.owner_id;
    if (body.priority !== undefined) lead.priority = body.priority;
    await client.query(
      `update app_leads set stage = $2, owner_id = $3, priority = $4, data = $5::jsonb where id = $1`,
      [lead.id, lead.stage || null, lead.owner_id || null, lead.priority || null, jsonValue(lead)]
    );
    const automaticApplication = await ensureApplicationForLeadFastDb(client, lead, user, {
      auditAction: 'Application auto-created for lead'
    });
    await appendAuditFast(client, user, 'Opportunity updated', 'lead', lead.id, body.reason);
    await client.query('commit');
    dbCache = null;
    return { ok: true, lead, application: automaticApplication ? publicApplication(automaticApplication.application) : null, attribution: automaticApplication?.attribution || null };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function addLeadNoteFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select id from app_leads where id = $1 limit 1`, [id]);
    if (!result.rows[0]) throw statusError(404, 'Lead not found.');
    const audit = await appendAuditFast(client, user, 'Note added', 'lead', id, body.note);
    await client.query('commit');
    dbCache = null;
    return { ok: true, audit };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function createTaskFastDb(body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
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
      [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, jsonValue(task)]
    );
    await appendAuditFast(client, user, 'Task created', 'lead', lead.id, body.title);
    await client.query('commit');
    dbCache = null;
    return { ok: true, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function completeTaskFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_tasks where id = $1 for update`, [id]);
    const task = result.rows[0]?.data;
    if (!task) throw statusError(404, 'Task not found.');
    task.status = 'Done';
    task.completed_at = new Date().toISOString();
    await client.query(
      `update app_tasks set status = $2, completed_at = $3::timestamptz, data = $4::jsonb where id = $1`,
      [task.id, task.status, task.completed_at, jsonValue(task)]
    );
    await appendAuditFast(client, user, 'Task completed', 'lead', task.lead_id, task.title);
    await client.query('commit');
    dbCache = null;
    return { ok: true, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function createLeadFastDb(body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const programmeResult = await client.query(`select data from app_programmes where id = $1 limit 1`, [body.programme_id]);
    const programme = programmeResult.rows[0]?.data;
    if (!programme) throw statusError(400, 'Choose a programme.');
    const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const ownerResult = body.owner_id
      ? await client.query(`select id, name, email, role from ${usersTable} where id = $1 limit 1`, [body.owner_id])
      : { rows: [] };
    const owner = ownerResult.rows[0] || user;
    const email = normalizeEmail(body.email);
    if (isExcludedLeadSender(email, body.first_name, body.last_name)) throw statusError(400, 'This sender is excluded from lead creation.');
    const existingResult = email
      ? await client.query(`select data from app_leads where lower(email) = $1 and ${activeLeadCondition()} limit 1 for update`, [email])
      : { rows: [] };
    const now = new Date().toISOString();
    const normalized = {
      first_name: body.first_name || nameParts('', email).first_name,
      last_name: body.last_name || nameParts('', email).last_name,
      full_name: `${body.first_name || nameParts('', email).first_name} ${body.last_name || nameParts('', email).last_name}`,
      programme: programme.name,
      programme_id: programme.id,
      email,
      employer: body.employer || '',
      phone: body.phone || '',
      city: body.city || '',
      owner: owner?.name || user.name,
      owner_id: owner?.id || user.id,
      stage: 'New lead',
      priority: body.priority || 'P2',
      source_first_touch: body.source || 'Manual',
      source_lead_capture: body.source || 'Manual',
      contact_permission: body.contact_permission || 'Unknown',
      level: programme.level || 'Needs review',
      created_at: now,
      next_action_at: null
    };
    let lead = existingResult.rows[0]?.data || null;
    const created = !lead;
    if (lead) {
      lead = mergeLeadData(lead, normalized);
    } else {
      const id = leadIdForEmail({ leads: [] }, email || `${body.first_name}-${body.last_name}-${Date.now()}`);
      lead = { ...normalized, id, person_id: id };
      addLeadSource(lead, lead.source_lead_capture, { provider_id: '', captured_at: lead.created_at });
    }
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
      [lead.id, lead.person_id || lead.id, lead.first_name, lead.last_name, lead.email, lead.employer, lead.phone, lead.city, lead.programme_id, lead.programme, lead.level, lead.owner_id, lead.owner, lead.stage, lead.priority, lead.source_first_touch, lead.source_lead_capture, lead.contact_permission, lead.created_at, lead.next_action_at, jsonValue(lead)]
    );
    let task = null;
    if (created) {
      task = {
        id: `T-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        title: `First contact with ${body.first_name} ${body.last_name}`,
        lead_id: lead.id,
        kind: 'Call',
        status: 'Open',
        created_at: now,
        due_at: new Date(Date.now() + 86400000).toISOString(),
        priority: lead.priority,
        owner_id: lead.owner_id
      };
      await client.query(
        `insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
         values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`,
        [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, jsonValue(task)]
      );
    }
    const automaticApplication = await ensureApplicationForLeadFastDb(client, lead, user, {
      auditAction: created ? 'Application auto-created for new lead' : 'Application auto-created for duplicate lead'
    });
    await appendAuditFast(client, user, created ? 'Lead created' : 'Lead updated from duplicate submission', 'lead', lead.id);
    await client.query('commit');
    dbCache = null;
    return { id: lead.id, lead, task, created, application: automaticApplication ? publicApplication(automaticApplication.application) : null, attribution: automaticApplication?.attribution || null };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function addProgrammeOpportunityFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [id]);
    const programmeResult = await client.query(`select data from app_programmes where id = $1 limit 1`, [body.programme_id]);
    const lead = leadResult.rows[0]?.data;
    const programme = programmeResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    if (!programme) throw statusError(400, 'Choose a programme.');
    lead.programme_history ||= [];
    if (!lead.programme_history.some(item => item.programme_id === lead.programme_id)) {
      lead.programme_history.push({ programme_id: lead.programme_id, programme: lead.programme, level: lead.level, added_at: lead.created_at || new Date().toISOString() });
    }
    if (!lead.programme_history.some(item => item.programme_id === programme.id)) {
      lead.programme_history.push({ programme_id: programme.id, programme: programme.name, level: programme.level, added_at: new Date().toISOString() });
    }
    lead.programme_id = programme.id;
    lead.programme = programme.name;
    lead.level = programme.level;
    lead.stage = 'New lead';
    lead.next_action_at = null;
    await client.query(
      `update app_leads set programme_id = $2, programme = $3, level = $4, stage = $5, next_action_at = null, data = $6::jsonb where id = $1`,
      [lead.id, lead.programme_id, lead.programme, lead.level, lead.stage, jsonValue(lead)]
    );
    await appendAuditFast(client, user, 'Programme opportunity linked', 'lead', lead.id, programme.name);
    await client.query('commit');
    dbCache = null;
    return { id: lead.id, lead, created: false };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function logCallFastDb(body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
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
        [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, jsonValue(task)]
      );
    }
    await appendAuditFast(client, user, `Call ${body.outcome}`, 'lead', lead.id, body.note);
    await client.query('commit');
    dbCache = null;
    return { ok: true, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function recordEmailFastDb(body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [body.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    const received = new Date(body.received_at);
    const receivedAt = Number.isNaN(received.getTime()) ? new Date() : received;
    const email = {
      id: `E-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      lead_id: lead.id,
      subject: body.subject,
      body: body.body,
      owner: lead.owner,
      direction: 'inbound',
      response_at: null,
      due_at: new Date(receivedAt.getTime() + EMAIL_RESPONSE_SLA_MS).toISOString(),
      received_at: receivedAt.toISOString()
    };
    await client.query(
      `insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, null, null, $9::timestamptz, $10::timestamptz, null, $11::jsonb)`,
      [email.id, email.lead_id, email.first_name, email.last_name, email.email, email.subject, email.body, email.owner, email.due_at, email.received_at, jsonValue(email)]
    );
    await appendAuditFast(client, user, 'Inbound email recorded', 'lead', lead.id, body.subject);
    await client.query('commit');
    dbCache = null;
    return { ok: true, email };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveEmailFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_emails where id = $1 for update`, [id]);
    const email = result.rows[0]?.data;
    if (!email) throw statusError(404, 'Email not found.');
    const responseAt = new Date(body.response_at);
    email.response_at = Number.isNaN(responseAt.getTime()) || responseAt.getFullYear() <= 2000 ? new Date().toISOString() : responseAt.toISOString();
    email.response_note = body.note;
    await client.query(
      `update app_emails set response_at = $2::timestamptz, response_note = $3, data = $4::jsonb where id = $1`,
      [email.id, email.response_at, email.response_note, jsonValue(email)]
    );
    await appendAuditFast(client, user, 'Email response recorded', 'lead', email.lead_id, body.note);
    await client.query('commit');
    dbCache = null;
    return { ok: true, email };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function updateEmailReadStateFastDb(id, body) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_emails where id = $1 for update`, [id]);
    const email = result.rows[0]?.data;
    if (!email) throw statusError(404, 'Email not found.');
    const isRead = body.is_read !== false;
    email.is_read = isRead;
    if (isRead) {
      email.gmail_labels = (email.gmail_labels || []).filter(label => label !== 'UNREAD');
      email.gmail_label_names = (email.gmail_label_names || []).filter(label => String(label).toLowerCase() !== 'unread');
    } else {
      email.gmail_labels = [...new Set([...(email.gmail_labels || []), 'UNREAD'])];
      email.gmail_label_names = [...new Set([...(email.gmail_label_names || []), 'Unread'])];
    }
    await client.query(`update app_emails set data = $2::jsonb where id = $1`, [email.id, jsonValue(email)]);
    await client.query('commit');
    dbCache = null;
    return { ok: true, email: publicEmailSummary(email) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function checkInAttendeeFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const eventResult = await client.query(
      `select data from app_events where attendees @> $1::jsonb limit 1 for update`,
      [JSON.stringify([{ id }])]
    );
    const event = eventResult.rows[0]?.data;
    if (!event) throw statusError(404, 'Attendee not found.');
    const attendee = (event.attendees || []).find(item => item.id === id);
    if (!attendee) throw statusError(404, 'Attendee not found.');
    attendee.attended_at = attendee.attended_at || new Date().toISOString();
    attendee.status = attendee.status || 'Attended';
    event.attendance = (event.attendees || []).filter(item => item.attended_at).length;
    let task = null;
    if (attendee.lead_id) {
      const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [attendee.lead_id]);
      const lead = leadResult.rows[0]?.data;
      if (lead) {
        task = {
          id: `T-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          title: 'Follow up after event attendance',
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
           values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`,
          [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, jsonValue(task)]
        );
        await appendAuditFast(client, user, 'Event attendee checked in', 'lead', lead.id, `${attendee.first_name || ''} ${attendee.last_name || ''}`.trim());
      }
    }
    await client.query(
      `update app_events set attendance = $2, attendees = $3::jsonb, data = $4::jsonb where id = $1`,
      [event.id, event.attendance, jsonValue(event.attendees || []), jsonValue(event)]
    );
    await client.query('commit');
    dbCache = null;
    return { ok: true, attendee, event, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function uploadEvidenceFastDb(id, body) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw statusError(404, 'Application not found.');
    const req = (app.requirements || []).find(item => item.id === body.requirement_id);
    if (!req) throw statusError(404, 'Requirement not found.');
    req.latest = {
      id: `ER-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      filename: body.filename,
      version: (req.latest?.version || 0) + 1,
      status: 'Pending',
      reviewer: null,
      content_base64: body.content_base64
    };
    if (!app.learner) app.status = 'In review';
    await client.query(
      `update app_applications set status = $2, requirements = $3::jsonb, data = $4::jsonb where id = $1`,
      [app.id, app.status, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function sendEvidenceFileFastDb(id, res) {
  if (!postgresPool) return false;
  await ensureStorage();
  const result = await postgresPool.query(
    `select data from app_applications
     where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
     limit 1`,
    [id]
  );
  const app = result.rows[0]?.data;
  const req = (app?.requirements || []).find(item => item.latest?.id === id);
  if (!req?.latest?.content_base64) throw statusError(404, 'Evidence not found.');
  const filename = String(req.latest.filename || 'evidence-file').replace(/[\r\n"]/g, '_');
  const content = Buffer.from(req.latest.content_base64 || '', 'base64');
  res.writeHead(200, {
    'Content-Type': mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`
  });
  res.end(content);
  return true;
}

async function sendDocumentTemplateFile(key, res) {
  const template = APPLICATION_DOCUMENT_TEMPLATES.find(([itemKey]) => itemKey === key);
  if (!template) throw statusError(404, 'Document template not found.');
  await ensureStorage();
  if (postgresPool) {
    const result = await postgresPool.query(
      `select title, filename, content_type, content from app_document_templates where key = $1 limit 1`,
      [key]
    );
    const row = result.rows[0];
    if (!row) throw statusError(404, 'Document template not found.');
    const filename = String(row.filename || template[2]).replace(/[\r\n"]/g, '_');
    res.writeHead(200, {
      'Content-Type': row.content_type || 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300'
    });
    res.end(row.content);
    return true;
  }
  const filename = template[2];
  const filePath = path.resolve(ROOT, template[3] || filename);
  const rootPath = path.resolve(ROOT);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) throw statusError(404, 'Document template not found.');
  const content = await fs.promises.readFile(filePath).catch(() => null);
  if (!content) throw statusError(404, 'Document template not found.');
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[\r\n"]/g, '_')}"`,
    'Cache-Control': 'private, max-age=300'
  });
  res.end(content);
  return true;
}

async function reviewEvidenceFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select data from app_applications
       where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
       limit 1 for update`,
      [id]
    );
    const app = result.rows[0]?.data;
    if (!app) throw statusError(404, 'Evidence not found.');
    const req = (app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest) throw statusError(404, 'Evidence not found.');
    req.latest.status = body.status;
    req.latest.reviewer = user.name;
    req.latest.review_note = body.note;
    await client.query(
      `update app_applications set requirements = $2::jsonb, data = $3::jsonb where id = $1`,
      [app.id, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app), evidence: { ...req.latest, content_base64: undefined } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function reviewApplicationFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    app.status = body.status;
    lead.stage = body.status === 'Eligible' ? 'Ready for Enrolment' : 'Not Eligible';
    await client.query(`update app_applications set status = $2, data = $3::jsonb where id = $1`, [app.id, app.status, jsonValue(app)]);
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
    await appendAuditFast(client, user, 'Eligibility decision', 'lead', lead.id, body.status);
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app), lead };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyContractFastDb(id, body) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw statusError(404, 'Application not found.');
    app.contract = {
      status: 'Verified',
      signatory: body.signatory,
      signed_at: body.signed_at,
      note: body.note,
      consistency_confirmed: body.consistency_confirmed
    };
    await client.query(
      `update app_applications set contract = $2::jsonb, data = $3::jsonb where id = $1`,
      [app.id, jsonValue(app.contract), jsonValue(app)]
    );
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function enrolApplicationFastDb(id, body, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const appResult = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = appResult.rows[0]?.data;
    if (!app) throw statusError(404, 'Application not found.');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
    const lead = leadResult.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    app.status = 'Enrolled';
    app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
    lead.stage = 'Enrolled';
    const snapshot = { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture };
    const attribution = { ...lead, programme: app.programme, snapshot };
    await client.query(`update app_applications set status = $2, learner = $3::jsonb, data = $4::jsonb where id = $1`, [app.id, app.status, jsonValue(app.learner), jsonValue(app)]);
    await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
    await client.query(
      `insert into app_attribution (lead_id, email, programme, data) values ($1, $2, $3, $4::jsonb)`,
      [lead.id, lead.email, app.programme, jsonValue(attribution)]
    );
    await appendAuditFast(client, user, 'Learner enrolled', 'lead', lead.id, body.external_reference);
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app), lead, attribution };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteLeadFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_leads where id = $1 for update`, [id]);
    const lead = result.rows[0]?.data;
    if (!lead) throw statusError(404, 'Lead not found.');
    await client.query(`delete from app_tasks where lead_id = $1`, [id]);
    await client.query(`delete from app_emails where lead_id = $1`, [id]);
    await client.query(`delete from app_applications where lead_id = $1`, [id]);
    await client.query(`delete from app_attribution where lead_id = $1`, [id]);
    await client.query(`delete from app_leads where id = $1`, [id]);
    await appendAuditFast(client, user, 'Lead deleted', 'lead', id, fullName(lead));
    await client.query('commit');
    dbCache = null;
    return { ok: true, deleted: { leads: [id], tasks_for_lead: id, emails_for_lead: id, applications_for_lead: id } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteTaskFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_tasks where id = $1 for update`, [id]);
    const task = result.rows[0]?.data;
    if (!task) throw statusError(404, 'Task not found.');
    await client.query(`delete from app_tasks where id = $1`, [id]);
    await appendAuditFast(client, user, 'Task deleted', 'lead', task.lead_id, task.title);
    await client.query('commit');
    dbCache = null;
    return { ok: true, deleted: { tasks: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEmailFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_emails where id = $1 for update`, [id]);
    const email = result.rows[0]?.data;
    if (!email) throw statusError(404, 'Email not found.');
    await client.query(`delete from app_emails where id = $1`, [id]);
    await appendAuditFast(client, user, 'Email deleted', 'lead', email.lead_id, email.subject);
    await client.query('commit');
    dbCache = null;
    return { ok: true, deleted: { emails: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteApplicationFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_applications where id = $1 for update`, [id]);
    const app = result.rows[0]?.data;
    if (!app) throw statusError(404, 'Application not found.');
    let lead = null;
    if (app.lead_id) {
      const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [app.lead_id]);
      lead = leadResult.rows[0]?.data || null;
      if (lead && ['Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Not Eligible', 'Enrolled'].includes(lead.stage)) {
        lead.stage = 'Qualified';
        await client.query(`update app_leads set stage = $2, data = $3::jsonb where id = $1`, [lead.id, lead.stage, jsonValue(lead)]);
      }
    }
    await client.query(`delete from app_attribution where lead_id = $1 and programme = $2`, [app.lead_id, app.programme]);
    await client.query(`delete from app_applications where id = $1`, [id]);
    await appendAuditFast(client, user, 'Application deleted', 'lead', app.lead_id || id, app.programme);
    await client.query('commit');
    dbCache = null;
    return { ok: true, deleted: { applications: [id] }, lead };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteEvidenceFastDb(id, user) {
  if (!postgresPool) return null;
  await ensureStorage();
  const client = await postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select data from app_applications
       where jsonb_path_exists(requirements, '$[*].latest ? (@.id == $evidence_id)', jsonb_build_object('evidence_id', $1::text))
       limit 1 for update`,
      [id]
    );
    const app = result.rows[0]?.data;
    if (!app) throw statusError(404, 'Evidence not found.');
    const req = (app.requirements || []).find(item => item.latest?.id === id);
    if (!req?.latest) throw statusError(404, 'Evidence not found.');
    const filename = req.latest.filename;
    req.latest = null;
    app.status = (app.requirements || []).some(item => item.latest?.status === 'Pending') ? 'In review' : app.status;
    await client.query(
      `update app_applications set status = $2, requirements = $3::jsonb, data = $4::jsonb where id = $1`,
      [app.id, app.status, jsonValue(app.requirements || []), jsonValue(app)]
    );
    await appendAuditFast(client, user, 'Evidence deleted', 'application', app.id, filename);
    await client.query('commit');
    dbCache = null;
    return { ok: true, application: publicApplication(app), deleted: { evidence: [id] } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function isZoomEventRecord(event = {}) {
  return Boolean(
    event.zoom_meeting_id ||
    event.zoom_meeting_uuid ||
    String(event.campaign || '').toLowerCase().startsWith('zoom') ||
    String(event.location || '').toLowerCase() === 'zoom'
  );
}

async function loadZoomEventListDb(limit = 2000) {
  return (await loadZoomEventPageDb({ limit })).items;
}

function publicMeetingSummary(event = {}) {
  const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : Number(event.attendee_count || 0);
  const summary = { ...event, attendee_count: attendeeCount };
  delete summary.attendees;
  delete summary.transcript;
  delete summary.recording;
  delete summary.recordings;
  delete summary.raw;
  delete summary.raw_payload;
  return summary;
}

async function loadZoomEventPageDb(options = {}, trace = null) {
  await perfPhase(trace, 'meetings_storage', () => ensureStorage());
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50;
  const cursor = decodePageCursor(options.cursor, 'meeting cursor');
  const filters = {
    startFrom: parseOptionalIsoDate(options.start_from || options.date_from, 'start_from'),
    startTo: parseOptionalIsoDate(options.start_to || options.date_to, 'start_to'),
    owner: String(options.owner || options.owner_id || '').trim(),
    lead: String(options.lead_id || '').trim(),
    contact: String(options.contact || options.contact_id || '').trim(),
    provider: String(options.provider || 'zoom').trim().toLowerCase(),
    search: String(options.search || '').trim().slice(0, 200)
  };
  if (filters.provider && filters.provider !== 'zoom') throw statusError(400, 'Only Zoom meetings are available here.');
  if (postgresPool) {
    const values = [];
    const conditions = [
      `(coalesce(e.data->>'zoom_meeting_id', '') <> ''
        or coalesce(e.data->>'zoom_meeting_uuid', '') <> ''
        or lower(coalesce(e.location, e.data->>'location', '')) = 'zoom'
        or lower(coalesce(e.campaign, e.data->>'campaign', '')) like 'zoom%')`
    ];
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (filters.startFrom) conditions.push(`e.start_at >= ${bind(filters.startFrom)}::timestamptz`);
    if (filters.startTo) conditions.push(`e.start_at < ${bind(filters.startTo)}::timestamptz`);
    if (filters.owner) {
      const ownerParam = bind(filters.owner);
      conditions.push(`(e.data->>'zoom_host_id' = ${ownerParam} or e.data->>'zoom_host_label' = ${ownerParam} or e.data->>'owner_id' = ${ownerParam})`);
    }
    if (filters.lead) {
      const leadParam = bind(filters.lead);
      conditions.push(`exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a
        where a->>'lead_id' = ${leadParam}
      )`);
    }
    if (filters.contact) {
      const contactParam = bind(filters.contact.toLowerCase());
      conditions.push(`exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a
        where lower(coalesce(a->>'id', a->>'email', a->>'phone', '')) = ${contactParam}
      )`);
    }
    if (filters.search) {
      const term = bind(`%${escapeSqlLike(filters.search)}%`);
      conditions.push(`(
        e.name ilike ${term} or e.location ilike ${term} or e.campaign ilike ${term}
        or e.data->>'zoom_host_label' ilike ${term} or e.data->>'zoom_host_id' ilike ${term} or e.data->>'zoom_meeting_id' ilike ${term}
      )`);
    }
    if (cursor?.id) {
      if (cursor.start_at) {
        const startParam = bind(cursor.start_at);
        const idParam = bind(String(cursor.id || ''));
        conditions.push(`(e.start_at < ${startParam}::timestamptz or (e.start_at = ${startParam}::timestamptz and e.id < ${idParam}) or e.start_at is null)`);
      } else {
        conditions.push(`(e.start_at is null and e.id < ${bind(String(cursor.id || ''))})`);
      }
    }
    const whereSql = conditions.join(' and ');
    const result = await timedPostgresQuery(trace, 'meetings_page',
      `select
         jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'title', e.name,
           'start_at', e.start_at,
           'duration', e.data->'duration',
           'provider', 'zoom',
           'location', coalesce(e.location, 'Zoom'),
           'campaign', coalesce(e.campaign, 'Zoom'),
           'status', coalesce(e.data->>'status', e.data->>'zoom_list_type', 'meeting'),
           'zoom_list_type', coalesce(e.data->>'zoom_list_type', e.data->>'status', 'meeting'),
           'zoom_meeting_id', coalesce(e.data->>'zoom_meeting_id', ''),
           'zoom_meeting_uuid', coalesce(e.data->>'zoom_meeting_uuid', ''),
           'zoom_host_id', coalesce(e.data->>'zoom_host_id', ''),
           'zoom_host_label', coalesce(e.data->>'zoom_host_label', ''),
           'zoom_account_id', coalesce(e.data->>'zoom_account_id', ''),
           'zoom_account_label', coalesce(e.data->>'zoom_account_label', ''),
           'meeting_link', coalesce(e.data->>'meeting_link', e.data->>'zoom_link', ''),
           'zoom_link', coalesce(e.data->>'zoom_link', e.data->>'meeting_link', ''),
           'attendee_count', jsonb_array_length(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end)
         ) as data,
         e.start_at
       from app_events e
       where ${whereSql}
       order by e.start_at desc nulls last, e.id desc
       limit $${values.length + 1}`,
      [...values, limit + 1]
    );
    return perfPhase(trace, 'mapping', async () => {
      const rows = result.rows.slice(0, limit);
      const items = rows.map(item => publicMeetingSummary(item.data));
      const last = rows[rows.length - 1];
      const nextCursor = result.rows.length > limit && last?.data?.id ? encodePageCursor({ start_at: last.start_at || last.data.start_at || null, id: last.data.id }) : '';
      return { items, events: items, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
    });
  }
  const rows = (await loadDb()).events
    .filter(isZoomEventRecord)
    .filter(event => !filters.startFrom || new Date(event.start_at || 0) >= new Date(filters.startFrom))
    .filter(event => !filters.startTo || new Date(event.start_at || 0) < new Date(filters.startTo))
    .filter(event => !filters.owner || [event.zoom_host_id, event.zoom_host_label, event.owner_id].map(String).includes(filters.owner))
    .filter(event => !filters.lead || (event.attendees || []).some(a => String(a.lead_id || '') === filters.lead))
    .filter(event => !filters.search || JSON.stringify(publicMeetingSummary(event)).toLowerCase().includes(filters.search.toLowerCase()))
    .sort((a, b) => new Date(b.start_at || 0) - new Date(a.start_at || 0) || String(b.id || '').localeCompare(String(a.id || '')));
  const start = cursor?.id ? Math.max(0, rows.findIndex(item => item.id === cursor.id) + 1) : 0;
  const page = rows.slice(start, start + limit).map(publicMeetingSummary);
  const nextCursor = start + page.length < rows.length ? encodePageCursor({ start_at: page[page.length - 1]?.start_at || null, id: page[page.length - 1]?.id || '' }) : '';
  return { items: page, events: page, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
}

async function loadZoomCallPageDb(limit = 50, offset = 0) {
  await ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 250));
  const safeOffset = Math.max(0, Number(offset || 0));
  const zoomState = await loadZoomStateForPaging();
  const allCalls = (zoomState.calls || [])
    .map(call => hydrateZoomStoredCall({ leads: [] }, call))
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
  const calls = allCalls.slice(safeOffset, safeOffset + safeLimit);
  return {
    calls,
    total: allCalls.length,
    offset: safeOffset,
    limit: safeLimit,
    loaded: safeOffset + calls.length,
    has_more: safeOffset + calls.length < allCalls.length,
    next_offset: safeOffset + calls.length,
    last_sync_at: zoomState.last_call_sync_at || null
  };
}

async function loadZoomStateForPaging() {
  let zoomState = dbCache?.zoom?.calls?.length ? dbCache.zoom : {};
  if (postgresPool && !(zoomState.calls || []).length) {
    const result = await postgresPool.query(`select meta->'zoom' as zoom from app_workspace where id = $1`, ['main']);
    zoomState = result.rows[0]?.zoom || {};
  }
  if (!(zoomState.calls || []).length) {
    zoomState = (await loadDb()).zoom || {};
  }
  return zoomState || {};
}

function zoomStoredNumberKey(number = '') {
  const digits = phoneDigits(number);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function zoomStoredCallSource(call = {}) {
  return [call.zoom_account_label || call.zoom_account_id, call.owner_name, call.owner_extension ? `Ext ${call.owner_extension}` : '', call.site_name, call.path]
    .filter(Boolean)
    .join(' / ') || 'Zoom Phone';
}

function summarizeZoomStoredNumbers(calls = []) {
  const byNumber = new Map();
  for (const call of calls) {
    for (const [side, number, name] of [['caller', call.caller_number, call.caller_name], ['callee', call.callee_number, call.callee_name]]) {
      const key = zoomStoredNumberKey(number);
      if (!key) continue;
      const row = byNumber.get(key) || {
        key,
        number,
        display: number,
        name: name || '',
        total: 0,
        inbound: 0,
        outbound: 0,
        caller: 0,
        callee: 0,
        linked: 0,
        last_at: '',
        lead_id: '',
        lead_name: '',
        sources: new Set(),
        accounts: new Set()
      };
      row.total += 1;
      row[side] += 1;
      if (String(call.direction || '').includes('in')) row.inbound += 1;
      if (String(call.direction || '').includes('out')) row.outbound += 1;
      if (call.lead_id && (call.matched_number ? zoomStoredNumberKey(call.matched_number) === key : true)) {
        row.linked += 1;
        row.lead_id = call.lead_id;
        row.lead_name = call.lead_name || call.lead_id;
      }
      if (!row.last_at || new Date(call.started_at || 0) > new Date(row.last_at || 0)) row.last_at = call.started_at || '';
      if (name && !row.name) row.name = name;
      if (call.zoom_account_label || call.zoom_account_id) row.accounts.add(call.zoom_account_label || call.zoom_account_id);
      row.sources.add(zoomStoredCallSource(call));
      byNumber.set(key, row);
    }
  }
  return [...byNumber.values()]
    .map(row => ({ ...row, sources: [...row.sources], accounts: [...row.accounts] }))
    .sort((a, b) => b.total - a.total || new Date(b.last_at || 0) - new Date(a.last_at || 0));
}

async function loadZoomNumberPageDb(limit = 50, offset = 0) {
  await ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 250));
  const safeOffset = Math.max(0, Number(offset || 0));
  const zoomState = await loadZoomStateForPaging();
  const calls = (zoomState.calls || []).map(call => hydrateZoomStoredCall({ leads: [] }, call));
  const numbers = summarizeZoomStoredNumbers(calls);
  const rows = numbers.slice(safeOffset, safeOffset + safeLimit);
  return {
    numbers: rows,
    total: numbers.length,
    offset: safeOffset,
    limit: safeLimit,
    loaded: safeOffset + rows.length,
    has_more: safeOffset + rows.length < numbers.length,
    next_offset: safeOffset + rows.length,
    last_sync_at: zoomState.last_call_sync_at || null
  };
}

async function loadAuditListDb(limit = 100) {
  await ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 250));
  if (postgresPool) {
    const result = await postgresPool.query(`select data from app_audit order by occurred_at desc nulls last, id limit $1`, [safeLimit]);
    return result.rows.map(item => item.data);
  }
  return loadAuditList(await loadDb(), safeLimit);
}

async function loadAttributionListDb(limit = 100) {
  await ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 250));
  if (postgresPool) {
    const result = await postgresPool.query(`select data from app_attribution order by id desc limit $1`, [safeLimit]);
    return result.rows.map(item => item.data);
  }
  return loadAttributionList(await loadDb(), safeLimit);
}

function leadFor(db, id) {
  const lead = db.leads.find(item => item.id === id);
  if (!lead) throw statusError(404, 'Lead not found.');
  return lead;
}

function appFor(db, id) {
  const app = db.applications.find(item => item.id === id);
  if (!app) throw statusError(404, 'Application not found.');
  return app;
}

function addAudit(db, user, action, entity, entity_id, detail = '') {
  db.audit.unshift({
    id: `AU-${Date.now()}-${db.audit.length}`,
    occurred_at: new Date().toISOString(),
    actor: user.name,
    action: detail ? `${action}: ${detail}` : action,
    entity,
    entity_id
  });
}

function timeline(db, lead) {
  const items = [{ occurred_at: lead.created_at, source: 'Lead capture', summary: `${fullName(lead)} entered the ${lead.programme} pipeline.`, actor: lead.owner, verification: 'System recorded', confidence: 1 }];
  db.tasks.filter(task => task.lead_id === lead.id).forEach(task => items.push({ occurred_at: task.completed_at || task.due_at, source: task.kind, summary: `${task.status} task: ${task.title}`, actor: lead.owner, verification: task.status === 'Done' ? 'Completed' : 'Scheduled', confidence: 0.9 }));
  db.emails.filter(email => email.lead_id === lead.id && !emailIsTrashed(email)).forEach(email => items.push({ occurred_at: email.received_at, source: 'Email', summary: email.subject, actor: email.owner, verification: email.direction === 'outbound' ? 'Sent by us' : email.response_at ? 'Responded' : 'Awaiting response', confidence: 0.92 }));
  db.applications.filter(app => app.lead_id === lead.id).forEach(app => items.push({ occurred_at: app.created_at || lead.created_at, source: 'Application', summary: `Application status: ${app.learner ? 'Enrolled' : app.status}`, actor: app.manager || lead.owner, verification: 'Human review required', confidence: 0.95 }));
  db.audit.filter(item => item.entity_id === lead.id).forEach(item => items.push({ occurred_at: item.occurred_at, source: 'Workspace', summary: item.action, actor: item.actor, verification: 'Audit trail', confidence: 1 }));
  return items.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

function forwardedHeader(req, name, fallback = '') {
  return String(req.headers[name] || fallback).split(',')[0].trim();
}

function requestIsSecure(req) {
  return forwardedHeader(req, 'x-forwarded-proto') === 'https' || req.socket?.encrypted || process.env.NODE_ENV === 'production';
}

function originFor(req) {
  const proto = forwardedHeader(req, 'x-forwarded-proto', requestIsSecure(req) ? 'https' : 'http');
  const host = forwardedHeader(req, 'x-forwarded-host', req.headers.host);
  return `${proto}://${host}`;
}

function gmailRedirectUri(req) {
  return process.env.GMAIL_REDIRECT_URI || `${originFor(req)}/api/integrations/gmail/callback`;
}

function eventbriteRedirectUri(req) {
  return process.env.EVENTBRITE_REDIRECT_URI || `${originFor(req)}/api/integrations/eventbrite/callback`;
}

function zohoRedirectUri(req) {
  return process.env.ZOHO_REDIRECT_URI || `${originFor(req)}/api/integrations/zoho/callback`;
}

function gmailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    !process.env.GMAIL_CLIENT_ID.includes('replace-with') &&
    !process.env.GMAIL_CLIENT_SECRET.includes('replace-with') &&
    !process.env.GMAIL_CLIENT_ID.includes('your-google') &&
    !process.env.GMAIL_CLIENT_SECRET.includes('your-google')
  );
}

function eventbriteConfigured() {
  return Boolean(
    process.env.EVENTBRITE_CLIENT_ID &&
    process.env.EVENTBRITE_CLIENT_SECRET &&
    !process.env.EVENTBRITE_CLIENT_ID.includes('your-eventbrite') &&
    !process.env.EVENTBRITE_CLIENT_SECRET.includes('your-eventbrite') &&
    !process.env.EVENTBRITE_CLIENT_ID.includes('replace-with') &&
    !process.env.EVENTBRITE_CLIENT_SECRET.includes('replace-with')
  );
}

function eventbritePrivateTokenConfigured() {
  return Boolean(
    process.env.EVENTBRITE_PRIVATE_TOKEN &&
    !process.env.EVENTBRITE_PRIVATE_TOKEN.includes('your-eventbrite') &&
    !process.env.EVENTBRITE_PRIVATE_TOKEN.includes('replace-with')
  );
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
  const configured = String(process.env.ZOHO_SCOPES || DEFAULT_ZOHO_SCOPES.join(','))
    .split(/[,\s]+/)
    .map(scope => scope.trim())
    .filter(Boolean);
  return configured.length ? [...new Set(configured)] : DEFAULT_ZOHO_SCOPES;
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

function metaConfigured() {
  return Boolean(
    process.env.META_ACCESS_TOKEN &&
    process.env.META_PAGE_ID &&
    !process.env.META_ACCESS_TOKEN.includes('your-meta') &&
    !process.env.META_PAGE_ID.includes('your-facebook') &&
    !process.env.META_ACCESS_TOKEN.includes('replace-with') &&
    !process.env.META_PAGE_ID.includes('replace-with')
  );
}

function apolloConfigured() {
  return Boolean(
    process.env.APOLLO_API_KEY &&
    !process.env.APOLLO_API_KEY.includes('your-apollo') &&
    !process.env.APOLLO_API_KEY.includes('replace-with') &&
    process.env.APOLLO_API_KEY.length > 10
  );
}

function zoomConfigured() {
  return zoomAccounts().length > 0;
}

function validZoomCredential(accountId, clientId, clientSecret) {
  return Boolean(
    accountId &&
    clientId &&
    clientSecret &&
    !accountId.includes('your-zoom') &&
    !clientId.includes('your-zoom') &&
    !clientSecret.includes('your-zoom') &&
    !accountId.includes('replace-with') &&
    !clientId.includes('replace-with') &&
    !clientSecret.includes('replace-with')
  );
}

function zoomAccounts() {
  const accounts = [];
  function add(suffix = '', fallbackLabel = 'Zoom account') {
    const accountId = process.env[`ZOOM_ACCOUNT_ID${suffix}`];
    const clientId = process.env[`ZOOM_CLIENT_ID${suffix}`];
    const clientSecret = process.env[`ZOOM_CLIENT_SECRET${suffix}`];
    if (!validZoomCredential(accountId || '', clientId || '', clientSecret || '')) return;
    accounts.push({
      accountId,
      clientId,
      clientSecret,
      userId: process.env[`ZOOM_USER_ID${suffix}`] || process.env.ZOOM_USER_ID || 'me',
      label: process.env[`ZOOM_ACCOUNT_LABEL${suffix}`] || fallbackLabel
    });
  }
  add('', process.env.ZOOM_ACCOUNT_LABEL || 'Zoom account 1');
  for (let index = 2; index <= 10; index += 1) add(`_${index}`, `Zoom account ${index}`);
  return accounts;
}

function csvEnv(name) {
  return String(process.env[name] || '').split(',').map(item => item.trim()).filter(Boolean);
}

function apolloSearchUrl(maxPeople = 25) {
  const params = new URLSearchParams();
  for (const title of csvEnv('APOLLO_PERSON_TITLES')) params.append('person_titles[]', title);
  for (const location of csvEnv('APOLLO_PERSON_LOCATIONS')) params.append('person_locations[]', location);
  for (const seniority of csvEnv('APOLLO_PERSON_SENIORITIES')) params.append('person_seniorities[]', seniority);
  for (const website of csvEnv('APOLLO_ORGANIZATION_WEBSITES')) params.append('organization_domains[]', website);
  if (process.env.APOLLO_KEYWORDS) params.set('q_keywords', process.env.APOLLO_KEYWORDS);
  params.set('page', '1');
  params.set('per_page', String(Math.max(1, Math.min(Number(process.env.APOLLO_PER_PAGE || maxPeople || 25), 100))));
  return `https://api.apollo.io/api/v1/mixed_people/api_search?${params}`;
}

function metaGraphVersion() {
  return process.env.META_GRAPH_VERSION || 'v22.0';
}

function metaUrl(pathname, params = {}) {
  const query = new URLSearchParams(params);
  return `https://graph.facebook.com/${metaGraphVersion()}/${pathname.replace(/^\/+/, '')}?${query}`;
}

function gmailAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    redirect_uri: gmailRedirectUri(req),
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function eventbriteAuthUrl(req, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.EVENTBRITE_CLIENT_ID,
    redirect_uri: eventbriteRedirectUri(req),
    state
  });
  return `https://www.eventbrite.com/oauth/authorize?${params}`;
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

async function fetchJson(url, options = {}) {
  const urlText = String(url || '');
  if (/gmail\.googleapis\.com|oauth2\.googleapis\.com/i.test(urlText)) externalFetchCounters.gmail += 1;
  if (/googleapis\.com|google\.com/i.test(urlText)) externalFetchCounters.google += 1;
  if (/zoho/i.test(urlText)) externalFetchCounters.zoho += 1;
  if (/zoom\.us/i.test(urlText)) externalFetchCounters.zoom += 1;
  if (/eventbrite/i.test(urlText)) externalFetchCounters.eventbrite += 1;
  if (/graph\.facebook\.com/i.test(urlText)) externalFetchCounters.meta += 1;
  if (/apollo/i.test(urlText)) externalFetchCounters.apollo += 1;
  const timeoutMs = Number(options.timeoutMs || 20000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: options.signal || controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw statusError(504, 'Provider request timed out.');
    throw statusError(502, error.message || 'Provider request failed.');
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let value = {};
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    value = { raw: text };
  }
  if (!response.ok) {
    const providerMessage = value.error_description || value.error?.message || value.message || value.reason || value.error || value.raw || 'Provider request failed.';
    const providerCode = value.code || value.error_code || value.errorCode || '';
    throw statusError(response.status >= 500 ? 502 : response.status, providerCode ? `${providerMessage} (${providerCode})` : providerMessage);
  }
  return value;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchZoomJson(url, options = {}, context = 'Zoom') {
  let lastError = null;
  const attempts = Math.max(1, Math.min(Number(options.attempts || 3), 5));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (ZOOM_REQUEST_DELAY_MS) await wait(ZOOM_REQUEST_DELAY_MS);
    try {
      return await fetchJson(url, { ...options, timeoutMs: options.timeoutMs || 30000 });
    } catch (error) {
      lastError = error;
      const status = Number(error.status || 0);
      if (![429, 502, 503, 504].includes(status)) throw statusError(status || 502, `${context}: ${error.message || 'Provider request failed.'}`);
      await wait(1200 * (attempt + 1));
    }
  }
  throw statusError(lastError?.status || 502, `${context}: ${lastError?.message || 'Provider request failed.'}`);
}

async function exchangeGmailCode(req, code) {
  return fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      redirect_uri: gmailRedirectUri(req),
      grant_type: 'authorization_code'
    })
  });
}

async function exchangeEventbriteCode(req, code) {
  return fetchJson('https://www.eventbrite.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.EVENTBRITE_CLIENT_ID,
      client_secret: process.env.EVENTBRITE_CLIENT_SECRET,
      redirect_uri: eventbriteRedirectUri(req),
      grant_type: 'authorization_code'
    })
  });
}

async function exchangeZohoCode(req, code, accountsUrl = '') {
  return fetchJson(`${String(accountsUrl || zohoAccountsUrl()).replace(/\/+$/, '')}/oauth/v2/token`, {
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

function eventbriteAccessToken(db) {
  if (eventbritePrivateTokenConfigured()) return process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!db.eventbrite?.access_token) throw statusError(400, 'Eventbrite is not connected.');
  return db.eventbrite.access_token;
}

async function refreshZohoToken(db) {
  if (!db.zoho?.refresh_token) throw statusError(400, 'Zoho CRM is not connected. Reconnect Zoho CRM so the server can store a refresh token.');
  const accountsUrl = zohoTokenAccountsUrl(db);
  console.info(`[zoho] refresh start accounts=${accountsUrl} access_expired=${!zohoAccessTokenValid(db.zoho)}`);
  const token = await fetchJson(`${accountsUrl}/oauth/v2/token`, {
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
  if (!db.zoho?.refresh_token) throw statusError(401, zohoReconnectRequiredMessage());
  if (!db.zoho.expires_at || db.zoho.expires_at < Date.now()) return refreshZohoToken(db);
  if (!db.zoho.access_token) return refreshZohoToken(db);
  return db.zoho.access_token;
}

async function refreshGmailToken(db) {
  if (!db.gmail?.refresh_token) throw statusError(400, 'Gmail is not connected.');
  let token;
  try {
    token = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: db.gmail.refresh_token,
        grant_type: 'refresh_token'
      })
    });
  } catch (error) {
    if (gmailReconnectError(error.message)) throw await markGmailReconnectRequired(db, error.message);
    throw error;
  }
  db.gmail.access_token = token.access_token;
  db.gmail.expires_at = Date.now() + ((token.expires_in || 3600) - 60) * 1000;
  db.gmail.reconnect_required = false;
  db.gmail.last_error = '';
  await saveGmailImportTables(db, { leadIds: [], taskIds: [], emailIds: [], auditIds: [], preserveEventbrite: true });
  return db.gmail.access_token;
}

function gmailReconnectError(message = '') {
  return /expired|revoked|invalid_grant|invalid authentication|unauthorized|reauth|reconnect/i.test(String(message || ''));
}

async function markGmailReconnectRequired(db, message = '') {
  db.gmail ||= {};
  db.gmail.connected = false;
  db.gmail.reconnect_required = true;
  db.gmail.last_error = 'Gmail token expired or revoked. Reconnect Gmail from Settings.';
  db.gmail.access_token = '';
  db.gmail.expires_at = 0;
  await saveGmailImportTables(db, { leadIds: [], taskIds: [], emailIds: [], auditIds: [], preserveEventbrite: true });
  return statusError(401, db.gmail.last_error || message || 'Reconnect Gmail from Settings.');
}

async function gmailAccessToken(db) {
  if (!db.gmail?.access_token) throw statusError(400, 'Gmail is not connected.');
  if (!db.gmail.expires_at || db.gmail.expires_at < Date.now()) return refreshGmailToken(db);
  return db.gmail.access_token;
}

function decodeBase64Url(value = '') {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function findTextPayload(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts || []) {
    const text = findTextPayload(part);
    if (text) return text;
  }
  return '';
}

function headerValue(message, name) {
  return message.payload?.headers?.find(header => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

const GMAIL_SYSTEM_LABELS = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  TRASH: 'Trash',
  SPAM: 'Spam',
  DRAFT: 'Draft',
  STARRED: 'Starred',
  IMPORTANT: 'Important',
  UNREAD: 'Unread',
  CATEGORY_PERSONAL: 'Personal',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums'
};

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizedGmailLabelName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isGmailEnrolmentLabelName(value) {
  const label = normalizedGmailLabelName(value);
  return GMAIL_ENROLMENT_LABELS.has(label) || GMAIL_ENROLMENT_LABEL_PREFIXES.some(prefix => label === prefix || label.startsWith(`${prefix}/`));
}

function gmailEnrolmentLabel(email) {
  return uniqueStrings(email?.gmail_label_names || [])
    .find(isGmailEnrolmentLabelName) || '';
}

function isInternalGmailLabelName(value) {
  return /^Label_[A-Za-z0-9_-]+$/i.test(String(value || '').trim());
}

function cachedGmailLabelNames(db) {
  return Object.entries(db.gmail?.label_name_map || {})
    .filter(([, name]) => name && !isInternalGmailLabelName(name));
}

async function gmailLabelNameMap(auth, db) {
  const fallback = new Map(Object.entries(GMAIL_SYSTEM_LABELS));
  for (const [id, name] of cachedGmailLabelNames(db)) fallback.set(id, name);
  try {
    const result = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers: auth });
    const labelNameMap = {};
    for (const label of result.labels || []) {
      const name = label.name || GMAIL_SYSTEM_LABELS[label.id] || '';
      if (!name || isInternalGmailLabelName(name)) continue;
      fallback.set(label.id, name);
      labelNameMap[label.id] = name;
    }
    db.gmail ||= {};
    db.gmail.label_name_map = { ...(db.gmail.label_name_map || {}), ...labelNameMap };
    db.gmail.label_names_updated_at = new Date().toISOString();
  } catch (error) {
    if (!/quota|rate|limit/i.test(error.message)) console.warn(`Gmail label lookup failed: ${error.message}`);
  }
  return fallback;
}

function gmailLabelsForMessage(message, labelMap) {
  const ids = uniqueStrings(message?.labelIds || []);
  const names = uniqueStrings(ids.map(id => labelMap.get(id) || GMAIL_SYSTEM_LABELS[id] || '').filter(name => name && !isInternalGmailLabelName(name)));
  return { gmail_labels: ids, gmail_label_names: names };
}

function gmailEmailNeedsLabelRefresh(email) {
  return !email?.gmail_labels?.length || !email?.gmail_label_names?.length || (email.gmail_label_names || []).some(isInternalGmailLabelName);
}

function refreshStoredGmailLabelNames(db, labelMap, changed) {
  let refreshed = 0;
  for (const email of db.emails || []) {
    if (!email?.gmail_labels?.length) continue;
    const labels = gmailLabelsForMessage({ labelIds: email.gmail_labels }, labelMap);
    if (!labels.gmail_label_names.length) continue;
    if (sameStringList(email.gmail_label_names, labels.gmail_label_names)) continue;
    email.gmail_label_names = labels.gmail_label_names;
    changed?.emailIds?.add(email.id);
    refreshed += 1;
  }
  return refreshed;
}

function sameStringList(a = [], b = []) {
  const left = uniqueStrings(a).sort();
  const right = uniqueStrings(b).sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function applyGmailLabels(email, message, labelMap) {
  if (!email || !message) return false;
  const labels = gmailLabelsForMessage(message, labelMap);
  const changed = !sameStringList(email.gmail_labels, labels.gmail_labels) || !sameStringList(email.gmail_label_names, labels.gmail_label_names);
  email.gmail_labels = labels.gmail_labels;
  email.gmail_label_names = labels.gmail_label_names;
  if (labels.gmail_labels.includes('TRASH')) return markEmailAsDashboardTrash(email) || changed;
  if (labels.gmail_labels.includes('INBOX')) return restoreEmailFromDashboardTrash(email) || changed;
  return changed;
}

function updateStoredGmailLabels(email, labelIds = [], labelMap, mode = 'add') {
  if (!email || !labelIds.length) return false;
  const current = new Set(uniqueStrings(email.gmail_labels || []));
  for (const labelId of uniqueStrings(labelIds)) {
    if (mode === 'remove') current.delete(labelId);
    else current.add(labelId);
  }
  const labels = gmailLabelsForMessage({ labelIds: [...current] }, labelMap);
  const changed = !sameStringList(email.gmail_labels, labels.gmail_labels) || !sameStringList(email.gmail_label_names, labels.gmail_label_names);
  email.gmail_labels = labels.gmail_labels;
  email.gmail_label_names = labels.gmail_label_names;
  return changed;
}

function sortEmailsNewest(db) {
  db.emails = (db.emails || []).sort((a, b) => new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0));
}

function emailSubjectKey(subject = '') {
  return String(subject || '')
    .toLowerCase()
    .replace(/^(\s*(re|fw|fwd):\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function markInboundEmailRepliedFromSent(db, sentEmail, changed, source = 'Gmail sent reply') {
  if (!sentEmail || sentEmail.direction !== 'outbound') return false;
  const sentAt = new Date(sentEmail.received_at || sentEmail.created_at || 0);
  if (Number.isNaN(sentAt.getTime())) return false;
  const recipient = normalizeEmail(sentEmail.email);
  const subjectKey = emailSubjectKey(sentEmail.subject);
  const threadId = String(sentEmail.gmail_thread_id || '').trim();
  if (!recipient || (!subjectKey && !threadId)) return false;
  const match = (db.emails || [])
    .filter(email => {
      if (!email || email.id === sentEmail.id || email.direction === 'outbound' || email.response_at || emailIsTrashed(email)) return false;
      if (normalizeEmail(email.email) !== recipient) return false;
      const sameThread = threadId && String(email.gmail_thread_id || '') === threadId;
      const sameSubject = subjectKey && emailSubjectKey(email.subject) === subjectKey;
      if (!sameThread && !sameSubject) return false;
      const receivedAt = new Date(email.received_at || email.created_at || 0);
      return !Number.isNaN(receivedAt.getTime()) && receivedAt <= sentAt;
    })
    .sort((a, b) => new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0))[0];
  if (!match) return false;
  match.response_at = sentAt.toISOString();
  match.response_note = match.response_note || `${source}: ${sentEmail.subject || 'Reply sent'}`;
  changed?.emailIds?.add(match.id);
  if (sentEmail.lead_id) changed?.leadIds?.add(sentEmail.lead_id);
  return true;
}

function reconcileGmailSentReplies(db, changed) {
  let resolved = 0;
  for (const email of db.emails || []) {
    if (email.direction === 'outbound' && markInboundEmailRepliedFromSent(db, email, changed, 'Existing Gmail sent reply')) resolved += 1;
  }
  return resolved;
}

function gmailSyncPageToken(db, source, incremental = false) {
  if (source === 'sent') return incremental ? (db.gmail?.incremental_sent_page_token || '') : (db.gmail?.sent_sync_2026_page_token || '');
  return incremental ? (db.gmail?.incremental_page_token || '') : (db.gmail?.sync_2026_page_token || '');
}

function setGmailSyncPageToken(db, source, token, incremental = false) {
  if (source === 'sent') {
    if (incremental) {
      db.gmail.incremental_sent_page_token = token || null;
      db.gmail.sent_sync_2026_page_token = null;
    } else {
      db.gmail.sent_sync_2026_page_token = token || null;
    }
    return;
  }
  if (incremental) {
    db.gmail.incremental_page_token = token || null;
    db.gmail.sync_2026_page_token = null;
  } else {
    db.gmail.sync_2026_page_token = token || null;
  }
}

function parseAddress(value) {
  const match = String(value).match(/^(.*?)<([^>]+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim().toLowerCase() };
  const email = String(value).trim().toLowerCase();
  return { name: email.split('@')[0] || 'Unknown sender', email };
}

function parseAddressList(value) {
  const text = String(value || '');
  const withNames = [...text.matchAll(/([^,<>"]+|"[^"]+")?\s*<([^>]+)>/g)].map(match => ({
    name: String(match[1] || '').replace(/"/g, '').trim(),
    email: normalizeEmail(match[2])
  }));
  if (withNames.length) return withNames.filter(item => item.email);
  return text.split(',').map(item => parseAddress(item)).filter(item => item.email);
}

function leadForEmailAddress(db, email) {
  const normalized = normalizeEmail(email);
  return normalized ? db.leads.find(item => normalizeEmail(item.email) === normalized) || null : null;
}

function applyGmailEnrolmentLabels(db, user, changed) {
  let enrolled = 0;
  for (const email of db.emails || []) {
    const label = gmailEnrolmentLabel(email);
    if (!label) continue;
    const linkedLead = email.lead_id ? (db.leads || []).find(lead => lead.id === email.lead_id) : null;
    const lead = linkedLead || leadForEmailAddress(db, email.email);
    if (!lead) continue;
    if (email.lead_id !== lead.id) {
      email.lead_id = lead.id;
      changed?.emailIds?.add(email.id);
    }
    if (lead.stage === 'Enrolled') continue;
    lead.stage = 'Enrolled';
    lead.enrolled_from_gmail_label = label;
    lead.enrolled_from_gmail_label_at = new Date().toISOString();
    changed?.leadIds?.add(lead.id);
    if (db.audit && user) {
      addAudit(db, user, 'Lead enrolled from Gmail label', 'lead', lead.id, label);
      changed?.auditIds?.add(db.audit[0]?.id);
    }
    enrolled += 1;
  }
  return enrolled;
}

function externalRecipients(db, message) {
  const companyEmails = new Set(companyMailboxEmails(db));
  return parseAddressList(`${headerValue(message, 'To')},${headerValue(message, 'Cc')}`)
    .filter(item => item.email && !companyEmails.has(item.email) && !/@(kentbusinesscollege\.org|pathway\.demo)$/i.test(item.email));
}

function nameParts(name, email) {
  const cleaned = (name || email.split('@')[0] || 'Unknown sender').trim();
  const parts = cleaned.split(/\s+/);
  return { first_name: parts[0] || 'Unknown', last_name: parts.slice(1).join(' ') || 'Sender' };
}

function markEmailAsDashboardTrash(email, reason = 'Gmail Trash') {
  if (!email || emailIsTrashed(email)) return false;
  email.dashboard_folder = 'trash';
  email.trashed_at = new Date().toISOString();
  email.trash_reason = reason;
  return true;
}

function restoreEmailFromDashboardTrash(email) {
  if (!email || !emailIsTrashed(email)) return false;
  email.dashboard_folder = 'inbox';
  email.restored_from_trash_at = new Date().toISOString();
  delete email.trashed_at;
  delete email.trash_reason;
  return true;
}

function gmailImportChanged(changed, counts = {}) {
  return Boolean(
    counts.imported ||
    counts.replied ||
    counts.labels ||
    counts.restored ||
    counts.trashed ||
    changed.leadIds?.size ||
    changed.taskIds?.size ||
    changed.emailIds?.size ||
    changed.auditIds?.size
  );
}

async function syncGmailTrashLabels(db, auth, changed, options = {}) {
  if (!GMAIL_TRASH_SYNC_LIMIT) return { trashed: 0, scanned_trash: 0 };
  const lastTrashSyncAt = new Date(db.gmail?.last_trash_sync_at || 0).getTime();
  if (!options.force && lastTrashSyncAt && Date.now() - lastTrashSyncAt < GMAIL_TRASH_SYNC_INTERVAL_MS) {
    return { trashed: 0, scanned_trash: 0, trash_sync_skipped: true };
  }
  const byGmailId = new Map((db.emails || []).filter(email => email.gmail_message_id).map(email => [email.gmail_message_id, email]));
  if (!byGmailId.size) return { trashed: 0, scanned_trash: 0 };
  let trashed = 0, scannedTrash = 0, pageToken = '';
  while (scannedTrash < GMAIL_TRASH_SYNC_LIMIT) {
    const params = { labelIds: 'TRASH', includeSpamTrash: 'true', maxResults: String(Math.min(100, GMAIL_TRASH_SYNC_LIMIT - scannedTrash)) };
    if (pageToken) params.pageToken = pageToken;
    let list;
    try {
      list = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams(params)}`, { headers: auth });
    } catch (error) {
      if (/quota|rate|limit/i.test(error.message)) return { trashed, scanned_trash: scannedTrash, quota_limited: true };
      throw error;
    }
    const messages = list.messages || [];
    scannedTrash += messages.length;
    for (const item of messages) {
      const email = byGmailId.get(item.id);
      if (markEmailAsDashboardTrash(email)) {
        changed.emailIds.add(email.id);
        trashed += 1;
      }
    }
    if (!list.nextPageToken || !messages.length) break;
    pageToken = list.nextPageToken;
  }
  db.gmail.last_trash_sync_at = new Date().toISOString();
  return { trashed, scanned_trash: scannedTrash };
}

async function syncGmailHistoryChanges(db, auth, changed) {
  let profile;
  const labelMap = await gmailLabelNameMap(auth, db);
  if (!db.gmail?.history_id) {
    profile = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth });
    db.gmail.history_id = profile.historyId || null;
    return { history_initialized: true, history_trash: 0, history_restored: 0 };
  }
  const byGmailId = new Map((db.emails || []).filter(email => email.gmail_message_id).map(email => [email.gmail_message_id, email]));
  if (!byGmailId.size) return { history_trash: 0, history_restored: 0 };
  let pageToken = '', historyTrash = 0, historyRestored = 0, latestHistoryId = db.gmail.history_id;
  while (true) {
    const params = new URLSearchParams({ startHistoryId: String(db.gmail.history_id) });
    params.append('historyTypes', 'labelAdded');
    params.append('historyTypes', 'labelRemoved');
    params.append('historyTypes', 'messageDeleted');
    if (pageToken) params.set('pageToken', pageToken);
    let result;
    try {
      result = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`, { headers: auth });
    } catch (error) {
      if (String(error.status || '') === '404' || /startHistoryId|history/i.test(error.message)) {
        profile = profile || await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth });
        db.gmail.history_id = profile.historyId || db.gmail.history_id;
        return { history_reset: true, history_trash: historyTrash, history_restored: historyRestored };
      }
      if (/quota|rate|limit/i.test(error.message)) return { history_quota_limited: true, history_trash: historyTrash, history_restored: historyRestored };
      throw error;
    }
    latestHistoryId = result.historyId || latestHistoryId;
    for (const item of result.history || []) {
      latestHistoryId = item.id || latestHistoryId;
      for (const change of item.labelsAdded || []) {
        const email = byGmailId.get(change.message?.id);
        const labels = change.labelIds || [];
        if (updateStoredGmailLabels(email, labels, labelMap, 'add')) {
          changed.emailIds.add(email.id);
        }
        if (labels.includes('TRASH') && markEmailAsDashboardTrash(email)) {
          changed.emailIds.add(email.id);
          historyTrash += 1;
        }
        if (labels.includes('INBOX') && restoreEmailFromDashboardTrash(email)) {
          changed.emailIds.add(email.id);
          historyRestored += 1;
        }
      }
      for (const change of item.labelsRemoved || []) {
        const email = byGmailId.get(change.message?.id);
        const labels = change.labelIds || [];
        if (updateStoredGmailLabels(email, labels, labelMap, 'remove')) {
          changed.emailIds.add(email.id);
        }
        if (labels.includes('TRASH') && restoreEmailFromDashboardTrash(email)) {
          changed.emailIds.add(email.id);
          historyRestored += 1;
        }
      }
      for (const change of item.messagesDeleted || []) {
        const email = byGmailId.get(change.message?.id);
        if (markEmailAsDashboardTrash(email, 'Deleted in Gmail')) {
          changed.emailIds.add(email.id);
          historyTrash += 1;
        }
      }
    }
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  db.gmail.history_id = latestHistoryId;
  return { history_trash: historyTrash, history_restored: historyRestored };
}

async function importGmailMessages(db, user, maxResults = 25, options = {}) {
  if (!gmailConfigured()) throw statusError(400, 'Gmail credentials are not configured.');
  if (!GMAIL_IMPORT_ENABLED) throw statusError(403, 'Gmail import is paused. Existing emails remain available.');
  const accessToken = await gmailAccessToken(db);
  const auth = { Authorization: `Bearer ${accessToken}` };
  db.gmail ||= { connected: false, imported_message_ids: [] };
  const labelMap = await gmailLabelNameMap(auth, db);
  const known = new Set([...(db.gmail.imported_message_ids || []), ...db.emails.map(email => email.gmail_message_id).filter(Boolean)]);
  const totalLimit = Math.max(1, Math.min(Number(maxResults) || 25, 25));
  const incrementalStart = GMAIL_INCREMENTAL_ONLY ? ensureIncrementalStart(db.gmail, 'incremental_started_at') : null;
  if (GMAIL_INCREMENTAL_ONLY) {
    db.gmail.sync_2026_page_token = null;
    db.gmail.sent_sync_2026_page_token = null;
  }
  const latestOnly = Boolean(options.latest);
  let imported = 0, importedInbox = 0, importedSent = 0, scanned = 0, restored = 0;
  const pageTokens = {
    inbox: latestOnly ? '' : gmailSyncPageToken(db, 'inbox', GMAIL_INCREMENTAL_ONLY),
    sent: latestOnly ? '' : gmailSyncPageToken(db, 'sent', GMAIL_INCREMENTAL_ONLY)
  };
  const changed = { leadIds: new Set(), taskIds: new Set(), emailIds: new Set(), auditIds: new Set() };
  const labelsRefreshed = refreshStoredGmailLabelNames(db, labelMap, changed);
  const historyResult = options.skipTrash ? { history_trash: 0, history_restored: 0, history_skipped: true } : await syncGmailHistoryChanges(db, auth, changed);
  const trashResult = options.skipTrash ? { trashed: 0, scanned_trash: 0, trash_sync_skipped: true } : await syncGmailTrashLabels(db, auth, changed, { force: options.forceTrash });
  let enrolledFromLabels = 0;
  const quotaResponse = async () => {
    enrolledFromLabels += applyGmailEnrolmentLabels(db, user, changed);
    if (latestOnly) {
      db.gmail.sync_2026_page_token = null;
      db.gmail.sent_sync_2026_page_token = null;
    } else if (GMAIL_INCREMENTAL_ONLY) {
      setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, true);
      setGmailSyncPageToken(db, 'sent', pageTokens.sent, true);
      db.gmail.incremental_only = true;
    } else {
      setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, false);
      setGmailSyncPageToken(db, 'sent', pageTokens.sent, false);
    }
    db.gmail.last_sync_at = new Date().toISOString();
    if (gmailImportChanged(changed, { imported, labels: labelsRefreshed, restored: restored + (historyResult.history_restored || 0), trashed: (trashResult.trashed || 0) + (historyResult.history_trash || 0) }) || (!latestOnly && (pageTokens.inbox || pageTokens.sent))) {
      await saveGmailImportTables(db, { ...changed, preserveEventbrite: true });
    }
    return { imported, imported_inbox: importedInbox, imported_sent: importedSent, labels_refreshed: labelsRefreshed, labels_enrolled: enrolledFromLabels, scanned, restored, ...historyResult, ...trashResult, since: GMAIL_INCREMENTAL_ONLY ? db.gmail.incremental_started_at : '2026-01-01', has_more: !latestOnly && Boolean(pageTokens.inbox || pageTokens.sent), quota_limited: true, retry_after_ms: 70000, last_sync_at: db.gmail.last_sync_at };
  };

  async function importSource(source, labelId) {
    let scannedSource = 0;
    while (scannedSource < totalLimit) {
    const queryAfter = GMAIL_INCREMENTAL_ONLY ? gmailQueryDate(new Date(incrementalStart.getTime() - 86400000)) : '2025/12/31';
      const params = { labelIds: labelId, q: `after:${queryAfter}`, maxResults: String(Math.min(25, totalLimit - scannedSource)) };
      if (pageTokens[source] && !latestOnly) params.pageToken = pageTokens[source];
    let list;
    try {
      list = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams(params)}`, { headers: auth });
    } catch (error) {
      if (/quota|rate|limit/i.test(error.message)) return quotaResponse();
      throw error;
    }
    const messages = list.messages || [];
    scanned += messages.length;
      scannedSource += messages.length;
    let reachedIncrementalFloor = false;
    for (const item of messages) {
      if (known.has(item.id)) {
        const existing = db.emails.find(email => email.gmail_message_id === item.id);
          const wasTrashed = emailIsTrashed(existing);
        let labelChanged = false;
        if (existing && (latestOnly || gmailEmailNeedsLabelRefresh(existing))) {
          try {
            const message = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&fields=id,labelIds`, { headers: auth });
            labelChanged = applyGmailLabels(existing, message, labelMap);
          } catch (error) {
            if (/quota|rate|limit/i.test(error.message)) return quotaResponse();
            throw error;
          }
        }
          const restoredNow = source === 'inbox' && restoreEmailFromDashboardTrash(existing);
          if (labelChanged || restoredNow) {
          changed.emailIds.add(existing.id);
            if (wasTrashed && !emailIsTrashed(existing)) restored += 1;
        }
          if (source === 'sent' && markInboundEmailRepliedFromSent(db, existing, changed)) {
            changed.emailIds.add(existing.id);
          }
        continue;
      }
      let message;
      try {
        message = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, { headers: auth });
      } catch (error) {
        if (/quota|rate|limit/i.test(error.message)) return quotaResponse();
        throw error;
      }
      const from = parseAddress(headerValue(message, 'From'));
      const subject = headerValue(message, 'Subject') || '(No subject)';
      const body = findTextPayload(message.payload) || message.snippet || '';
      const receivedAt = headerValue(message, 'Date') ? new Date(headerValue(message, 'Date')) : new Date(Number(message.internalDate || Date.now()));
      if (GMAIL_INCREMENTAL_ONLY && receivedAt <= incrementalStart) {
        reachedIncrementalFloor = true;
          continue;
        }
        const emailId = nextId('E', [db.emails]);
        if (source === 'sent') {
          const recipient = externalRecipients(db, message)[0];
          if (!recipient) {
            known.add(item.id);
            continue;
          }
          const lead = leadForEmailAddress(db, recipient.email);
          const fallbackNames = nameParts(recipient.name, recipient.email);
          const emailNames = lead ? { first_name: lead.first_name, last_name: lead.last_name } : fallbackNames;
          const sentEmail = {
            id: emailId,
            ...emailNames,
            email: recipient.email,
            lead_id: lead?.id || '',
            subject,
            body,
            owner: lead?.owner || user.name,
            direction: 'outbound',
            response_at: null,
            due_at: null,
            received_at: receivedAt.toISOString(),
            gmail_message_id: item.id,
            gmail_thread_id: message.threadId || '',
            ...gmailLabelsForMessage(message, labelMap),
            dashboard_folder: 'sent'
          };
          db.emails.unshift(sentEmail);
          markInboundEmailRepliedFromSent(db, sentEmail, changed);
          if (lead) changed.leadIds.add(lead.id);
          importedSent += 1;
        } else {
      const names = nameParts(from.name, from.email);
      const taskCountBeforeLead = db.tasks.length;
      const lead = ensureLeadForEmailSender(db, user, {
        first_name: names.first_name,
        last_name: names.last_name,
        email: from.email,
        direction: 'inbound',
        received_at: receivedAt.toISOString(),
        programme_text: `${subject} ${body}`
      });
      if (lead) changed.leadIds.add(lead.id);
      db.tasks.slice(taskCountBeforeLead).forEach(task => changed.taskIds.add(task.id));
      const emailNames = lead ? { first_name: lead.first_name, last_name: lead.last_name } : names;
      db.emails.unshift({
        id: emailId,
        ...emailNames,
        email: from.email,
        lead_id: lead?.id || '',
        subject,
        body,
        owner: lead?.owner || user.name,
        direction: 'inbound',
        response_at: null,
        due_at: new Date(receivedAt.getTime() + EMAIL_RESPONSE_SLA_MS).toISOString(),
        received_at: receivedAt.toISOString(),
        gmail_message_id: item.id,
        gmail_thread_id: message.threadId || '',
        ...gmailLabelsForMessage(message, labelMap),
        dashboard_folder: 'inbox'
      });
          importedInbox += 1;
        }
      changed.emailIds.add(emailId);
      db.gmail.imported_message_ids = [...(db.gmail.imported_message_ids || []), item.id];
      known.add(item.id);
      imported += 1;
    }
    if (reachedIncrementalFloor || !list.nextPageToken || !messages.length) {
        pageTokens[source] = '';
      break;
    }
      pageTokens[source] = list.nextPageToken;
    }
  }

  await importSource('inbox', 'INBOX');
  await importSource('sent', 'SENT');
  const repliesResolved = reconcileGmailSentReplies(db, changed);
  enrolledFromLabels += applyGmailEnrolmentLabels(db, user, changed);
  sortEmailsNewest(db);
  if (latestOnly) {
    db.gmail.sync_2026_page_token = null;
    db.gmail.sent_sync_2026_page_token = null;
  } else if (GMAIL_INCREMENTAL_ONLY) {
    setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, true);
    setGmailSyncPageToken(db, 'sent', pageTokens.sent, true);
    db.gmail.incremental_only = true;
  } else {
    setGmailSyncPageToken(db, 'inbox', pageTokens.inbox, false);
    setGmailSyncPageToken(db, 'sent', pageTokens.sent, false);
  }
  db.gmail.last_sync_at = new Date().toISOString();
  if (gmailImportChanged(changed, { imported, labels: labelsRefreshed, restored: restored + (historyResult.history_restored || 0), trashed: (trashResult.trashed || 0) + (historyResult.history_trash || 0), replied: repliesResolved }) || (!latestOnly && (pageTokens.inbox || pageTokens.sent))) {
    await saveGmailImportTables(db, { ...changed, preserveEventbrite: true });
  }
  return { imported, imported_inbox: importedInbox, imported_sent: importedSent, replies_resolved: repliesResolved, labels_refreshed: labelsRefreshed, labels_enrolled: enrolledFromLabels, scanned, restored, ...historyResult, ...trashResult, since: GMAIL_INCREMENTAL_ONLY ? db.gmail.incremental_started_at : '2026-01-01', has_more: !latestOnly && Boolean(pageTokens.inbox || pageTokens.sent), last_sync_at: db.gmail.last_sync_at };
}

function autoSyncUser(db) {
  return db.users.find(item => ['admin', 'director', 'manager'].includes(item.role)) || db.users[0] || { id: 'system', name: 'System', role: 'admin' };
}

function gmailDailySyncTarget() {
  const match = String(GMAIL_AUTO_SYNC_DAILY_TIME || '').match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  const hour = Math.max(0, Math.min(Number(match?.[1] ?? 18), 23));
  const minute = Math.max(0, Math.min(Number(match?.[2] ?? 0), 59));
  return { hour, minute };
}

function gmailDailySyncDelayMs() {
  const { hour, minute } = gmailDailySyncTarget();
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleGmailAutoSync(delayMs) {
  if (!GMAIL_AUTO_SYNC_ENABLED) return;
  if (gmailAutoSyncTimer) clearTimeout(gmailAutoSyncTimer);
  const delay = Math.max(1000, Number(delayMs) || (GMAIL_AUTO_SYNC_MODE === 'daily' ? gmailDailySyncDelayMs() : GMAIL_AUTO_SYNC_IDLE_MS));
  gmailAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
  gmailAutoSyncTimer = setTimeout(runGmailAutoSync, delay);
  if (gmailAutoSyncTimer.unref) gmailAutoSyncTimer.unref();
}

async function importGmailDailyMessages(db, user) {
  const totals = {
    imported: 0,
    imported_inbox: 0,
    imported_sent: 0,
    replies_resolved: 0,
    labels_refreshed: 0,
    scanned: 0,
    restored: 0,
    trashed: 0,
    scanned_trash: 0,
    history_trash: 0,
    history_restored: 0
  };
  let lastResult = null;
  let batchesRun = 0;
  for (let batch = 0; batch < GMAIL_AUTO_SYNC_DAILY_BATCHES; batch += 1) {
    lastResult = await importGmailMessages(db, user, GMAIL_AUTO_SYNC_BATCH_SIZE, { latest: false, skipTrash: false });
    batchesRun += 1;
    for (const key of Object.keys(totals)) totals[key] += Number(lastResult[key] || 0);
    if (lastResult.quota_limited || !lastResult.has_more) break;
  }
  return {
    ...(lastResult || {}),
    ...totals,
    mode: 'daily',
    daily_time: GMAIL_AUTO_SYNC_DAILY_TIME,
    batches_run: batchesRun,
    batch_limit: GMAIL_AUTO_SYNC_DAILY_BATCHES,
    has_more: Boolean(lastResult?.has_more),
    quota_limited: Boolean(lastResult?.quota_limited)
  };
}

async function runGmailAutoSync() {
  if (!GMAIL_AUTO_SYNC_ENABLED) return;
  if (gmailAutoSyncRunning) return scheduleGmailAutoSync(GMAIL_AUTO_SYNC_ACTIVE_MS);
  gmailAutoSyncRunning = true;
  gmailAutoSyncState.running = true;
  try {
    const db = await loadDb();
    if (!gmailConfigured() || !db.gmail?.connected || !db.gmail?.access_token) {
      gmailAutoSyncState.last_result = { skipped: true, reason: 'Gmail is not connected.' };
      gmailAutoSyncState.last_error = null;
      return scheduleGmailAutoSync();
    }
    const result = GMAIL_AUTO_SYNC_MODE === 'daily'
      ? await importGmailDailyMessages(db, autoSyncUser(db))
      : await importGmailMessages(db, autoSyncUser(db), GMAIL_AUTO_SYNC_BATCH_SIZE, { latest: true, skipTrash: false });
    gmailAutoSyncState.last_result = result;
    gmailAutoSyncState.last_error = null;
    const nextDelay = result.quota_limited
      ? Number(result.retry_after_ms || 70000) + 5000
      : GMAIL_AUTO_SYNC_MODE === 'daily'
        ? gmailDailySyncDelayMs()
        : result.has_more
        ? GMAIL_AUTO_SYNC_ACTIVE_MS
        : GMAIL_AUTO_SYNC_IDLE_MS;
    scheduleGmailAutoSync(nextDelay);
  } catch (error) {
    gmailAutoSyncState.last_error = error.message || 'Gmail auto sync failed.';
    console.error(`Gmail auto sync failed: ${gmailAutoSyncState.last_error}`);
    scheduleGmailAutoSync();
  } finally {
    gmailAutoSyncRunning = false;
    gmailAutoSyncState.running = false;
  }
}

function scheduleEventAutoSync(delayMs) {
  if (!EVENT_AUTO_SYNC_ENABLED) return;
  if (eventAutoSyncTimer) clearTimeout(eventAutoSyncTimer);
  const delay = Math.max(1000, Number(delayMs) || EVENT_AUTO_SYNC_INTERVAL_MS);
  eventAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
  eventAutoSyncTimer = setTimeout(runEventAutoSync, delay);
  if (eventAutoSyncTimer.unref) eventAutoSyncTimer.unref();
}

async function runEventAutoSync() {
  if (!EVENT_AUTO_SYNC_ENABLED) return;
  if (zoomAutoSyncRunning) return scheduleEventAutoSync(60 * 1000);
  if (eventAutoSyncRunning) return scheduleEventAutoSync(EVENT_AUTO_SYNC_INTERVAL_MS);
  eventAutoSyncRunning = true;
  eventAutoSyncState.running = true;
  console.log('Event auto sync starting.');
  try {
    const db = await loadDb();
    const user = autoSyncUser(db);
    const results = {};
    if (eventbriteConfigured() || eventbritePrivateTokenConfigured()) {
      try {
        results.eventbrite = await importEventbriteEvents(db, user, EVENT_AUTO_SYNC_MAX_EVENTS, { save: false });
        await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, deleteEventIds: results.eventbrite.deleted_event_ids || [] });
      } catch (error) {
        results.eventbrite = { error: error.message || 'Eventbrite sync failed.' };
      }
    } else {
      results.eventbrite = { skipped: true, reason: 'Eventbrite is not configured.' };
    }
    if (EVENTS_SHEET_URL) {
      try {
        results.sheet = await importSpreadsheetEvents(db, user, { filename: 'auto-events-sheet', google_url: EVENTS_SHEET_URL });
        await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
      } catch (error) {
        results.sheet = { error: error.message || 'Sheet sync failed.' };
      }
    } else {
      results.sheet = { skipped: true, reason: 'EVENTS_SHEET_URL is not configured.' };
    }
    if (zoomConfigured() && !ZOOM_AUTO_SYNC_ENABLED) {
      try {
        results.zoom = await importZoomMeetings(db, user, Number(process.env.ZOOM_MAX_MEETINGS || 500), { save: false });
        await saveEventImportTables(db, { preserveGmail: true });
      } catch (error) {
        results.zoom = { error: error.message || 'Zoom sync failed.' };
      }
    } else if (ZOOM_AUTO_SYNC_ENABLED) {
      results.zoom = { skipped: true, reason: 'Zoom auto sync runs in its own worker.' };
    } else {
      results.zoom = { skipped: true, reason: 'Zoom is not configured.' };
    }
    eventAutoSyncState.last_result = results;
    const errors = Object.values(results).filter(item => item?.error).map(item => item.error);
    eventAutoSyncState.last_error = errors.length ? errors.join('; ') : null;
    console.log(`Event auto sync finished: ${JSON.stringify(results)}`);
  } catch (error) {
    eventAutoSyncState.last_error = error.message || 'Event auto sync failed.';
    console.error(`Event auto sync failed: ${eventAutoSyncState.last_error}`);
  } finally {
    eventAutoSyncRunning = false;
    eventAutoSyncState.running = false;
    scheduleEventAutoSync(EVENT_AUTO_SYNC_INTERVAL_MS);
  }
}

function scheduleZoomAutoSync(delayMs) {
  if (!ZOOM_AUTO_SYNC_ENABLED) return;
  if (zoomAutoSyncTimer) clearTimeout(zoomAutoSyncTimer);
  const delay = Math.max(1000, Number(delayMs) || ZOOM_AUTO_SYNC_INTERVAL_MS);
  zoomAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
  zoomAutoSyncTimer = setTimeout(runZoomAutoSync, delay);
  if (zoomAutoSyncTimer.unref) zoomAutoSyncTimer.unref();
}

async function runZoomAutoSync() {
  if (!ZOOM_AUTO_SYNC_ENABLED) return;
  if (zoomAutoSyncRunning) return scheduleZoomAutoSync(ZOOM_AUTO_SYNC_INTERVAL_MS);
  if (eventAutoSyncRunning) return scheduleZoomAutoSync(60 * 1000);
  zoomAutoSyncRunning = true;
  zoomAutoSyncState.running = true;
  console.log('Zoom auto sync starting.');
  try {
    const db = await loadDb();
    const user = autoSyncUser(db);
    const results = {};
    let shouldSave = false;
    if (!zoomConfigured()) {
      results.zoom = { skipped: true, reason: 'Zoom is not configured.' };
    } else {
      if (ZOOM_AUTO_SYNC_MEETINGS) {
        try {
          results.meetings = await importZoomMeetings(db, user, ZOOM_AUTO_SYNC_MAX_MEETINGS, { save: false });
          shouldSave = true;
        } catch (error) {
          results.meetings = { error: error.message || 'Zoom meetings sync failed.' };
        }
      } else {
        results.meetings = { skipped: true, reason: 'ZOOM_AUTO_SYNC_MEETINGS is disabled.' };
      }
      if (ZOOM_AUTO_SYNC_CALLS) {
        try {
          results.calls = await importZoomCalls(db, user, ZOOM_AUTO_SYNC_MAX_CALLS, { save: false, max_calls: ZOOM_AUTO_SYNC_MAX_CALLS });
          shouldSave = true;
        } catch (error) {
          results.calls = { error: error.message || 'Zoom calls sync failed.' };
        }
      } else {
        results.calls = { skipped: true, reason: 'ZOOM_AUTO_SYNC_CALLS is disabled.' };
      }
      if (shouldSave) await saveEventImportTables(db, { preserveGmail: true });
    }
    zoomAutoSyncState.last_result = results;
    const errors = Object.values(results).filter(item => item?.error).map(item => item.error);
    zoomAutoSyncState.last_error = errors.length ? errors.join('; ') : null;
    console.log(`Zoom auto sync finished: ${JSON.stringify(results)}`);
  } catch (error) {
    zoomAutoSyncState.last_error = error.message || 'Zoom auto sync failed.';
    console.error(`Zoom auto sync failed: ${zoomAutoSyncState.last_error}`);
  } finally {
    zoomAutoSyncRunning = false;
    zoomAutoSyncState.running = false;
    scheduleZoomAutoSync(ZOOM_AUTO_SYNC_INTERVAL_MS);
  }
}

function startAutoSync() {
  if (!BACKGROUND_JOBS_ENABLED) {
    gmailAutoSyncState = { ...gmailAutoSyncState, enabled: false, mode: GMAIL_AUTO_SYNC_MODE, daily_time: GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
    eventAutoSyncState = { ...eventAutoSyncState, enabled: false, running: false, next_run_at: null };
    zoomAutoSyncState = { ...zoomAutoSyncState, enabled: false, running: false, next_run_at: null };
    console.log('Background auto sync disabled. Set BACKGROUND_JOBS_ENABLED=true to resume scheduled sync jobs.');
    return;
  }
  resumeZohoSyncJobs().catch(error => console.error(`Zoho sync resume failed: ${zohoSafeJobError(error)}`));
  scheduleZohoAutoSync(60 * 1000);
  if (!GMAIL_AUTO_SYNC_ENABLED && !EVENT_AUTO_SYNC_ENABLED && !ZOOM_AUTO_SYNC_ENABLED) {
    gmailAutoSyncState = { ...gmailAutoSyncState, enabled: false, mode: GMAIL_AUTO_SYNC_MODE, daily_time: GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
    eventAutoSyncState = { ...eventAutoSyncState, enabled: false, running: false, next_run_at: null };
    zoomAutoSyncState = { ...zoomAutoSyncState, enabled: false, running: false, next_run_at: null };
    return;
  }
  if (GMAIL_AUTO_SYNC_ENABLED) {
    gmailAutoSyncState = { ...gmailAutoSyncState, enabled: true, mode: GMAIL_AUTO_SYNC_MODE, daily_time: GMAIL_AUTO_SYNC_DAILY_TIME };
    scheduleGmailAutoSync(GMAIL_AUTO_SYNC_MODE === 'daily' ? null : 20000);
  } else {
    gmailAutoSyncState = { ...gmailAutoSyncState, enabled: false, mode: GMAIL_AUTO_SYNC_MODE, daily_time: GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
  }
  if (EVENT_AUTO_SYNC_ENABLED) {
    const delay = 15000;
    eventAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
    console.log(`Event auto sync scheduled in ${Math.round(delay / 1000)}s.`);
    setTimeout(runEventAutoSync, delay);
  } else {
    eventAutoSyncState = { ...eventAutoSyncState, enabled: false, running: false, next_run_at: null };
  }
  if (ZOOM_AUTO_SYNC_ENABLED) {
    const delay = 90000;
    zoomAutoSyncState = { ...zoomAutoSyncState, enabled: true, meetings: ZOOM_AUTO_SYNC_MEETINGS, calls: ZOOM_AUTO_SYNC_CALLS };
    console.log(`Zoom auto sync scheduled in ${Math.round(delay / 1000)}s.`);
    scheduleZoomAutoSync(delay);
  } else {
    zoomAutoSyncState = { ...zoomAutoSyncState, enabled: false, running: false, next_run_at: null };
  }
}

let leadApplicationBackfillRunning = false;

async function runEnrolledLeadApplicationBackfill() {
  if (!ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED || leadApplicationBackfillRunning) return;
  leadApplicationBackfillRunning = true;
  let created = 0;
  try {
    await ensureStorage();
    if (!postgresPool || !usesPostgresStorage()) {
      const db = await loadDb();
      db.applications ||= [];
      db.leads ||= [];
      db.audit ||= [];
      const leadById = new Map(db.leads.map(lead => [String(lead.id), lead]));
      const beforeCleanup = db.applications.length;
      db.applications = db.applications.filter(app => {
        const lead = leadById.get(String(app.lead_id));
        const autoDraft = app?.contract?.note === 'Application created automatically from lead.' && !app?.learner;
        return !(autoDraft && lead && !isEnrolledStage(lead.stage));
      });
      const missingLeads = db.leads
        .filter(lead => lead?.id && !lead.deleted_at && isEnrolledStage(lead.stage))
        .filter(lead => !db.applications.some(app => String(app.lead_id) === String(lead.id)))
        .slice(0, ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT);
      for (const lead of missingLeads) {
        const appId = nextId('A', [db.applications]);
        const app = automaticApplicationFromLead(appId, lead, { name: 'System' });
        db.applications.push(app);
        db.attribution ||= [];
        db.attribution.unshift({ ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
        addAudit(db, { name: 'System' }, 'Application auto-created during lead backfill', 'lead', lead.id, app.id);
        created += 1;
      }
      if (created || beforeCleanup !== db.applications.length) {
        await saveDb(db);
        console.log(`Lead application backfill created ${created} local application(s).`);
      }
      return created;
    }
    const cleanup = await postgresPool.query(
      `delete from app_applications a
       using app_leads l
       where a.lead_id = l.id
         and a.data->'contract'->>'note' = 'Application created automatically from lead.'
         and coalesce(a.data->'learner', 'null'::jsonb) = 'null'::jsonb
         and lower(coalesce(l.stage, l.data->>'stage', '')) <> 'enrolled'`
    );
    if (cleanup.rowCount) {
      dbCache = null;
      console.log(`Lead application backfill removed ${cleanup.rowCount} non-enrolled auto-created application(s).`);
    }
    const result = await postgresPool.query(
      `select l.id
       from app_leads l
       where ${activeLeadCondition('l')}
         and lower(coalesce(l.stage, l.data->>'stage', '')) = 'enrolled'
         and not exists (select 1 from app_applications a where a.lead_id = l.id)
       order by l.created_at nulls last, l.id
       limit $1`,
      [ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT]
    );
    for (const row of result.rows) {
      const client = await postgresPool.connect();
      try {
        await client.query('begin');
        const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [row.id]);
        const lead = leadResult.rows[0]?.data;
        const auto = await ensureApplicationForLeadFastDb(client, lead, { name: 'System' }, {
          auditAction: 'Application auto-created during lead backfill'
        });
        if (auto) created += 1;
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        console.error(`Lead application backfill failed for ${row.id}: ${error.message || error}`);
      } finally {
        client.release();
      }
    }
    if (created) {
      dbCache = null;
      console.log(`Lead application backfill created ${created} application(s).`);
    } else if (result.rows.length) {
      console.log('Lead application backfill found no missing applications after locking leads.');
    } else {
      console.log('Lead application backfill found no leads missing applications.');
    }
  } catch (error) {
    console.error(`Lead application backfill failed: ${error.message || error}`);
  } finally {
    leadApplicationBackfillRunning = false;
  }
  return created;
}

function programmeForEvent(db, eventName = '') {
  return programmeForText(db, eventName);
}

function eventVenue(event) {
  if (event.online_event) return 'Online';
  const venue = event.venue || {};
  return venue.name || venue.address?.localized_area_display || venue.address?.city || 'Eventbrite';
}

function leadFromAttendee(db, user, attendee, event) {
  const profile = attendee.profile || {};
  const email = String(profile.email || attendee.email || '').toLowerCase();
  const first_name = profile.first_name || profile.name?.split(/\s+/)[0] || 'Eventbrite';
  const last_name = profile.last_name || profile.name?.split(/\s+/).slice(1).join(' ') || 'Attendee';
  const programme = programmeForEvent(db, event.name?.text || '');
  const result = ensureLeadRecord(db, user, {
    first_name,
    last_name,
    programme_id: programme.id,
    email: email || `${attendee.id}@eventbrite.local`,
    employer: profile.company || '',
    phone: profile.cell_phone || profile.home_phone || '',
    city: profile.addresses?.home?.city || '',
    stage: 'New lead',
    priority: 'P2',
    source_first_touch: 'Event',
    source_lead_capture: 'Event',
    contact_permission: 'Unknown',
    created_at: attendee.created || event.created || new Date().toISOString(),
    eventbrite_attendee_id: attendee.id
  }, {
    taskTitle: `Follow up after ${event.name?.text || 'Eventbrite event'}`,
    taskKind: 'Follow-up'
  });
  return result.lead;
}

function normalizeColumnName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function rowValue(row, names) {
  const wanted = names.map(normalizeColumnName);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normalizeColumnName(key)) && value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function truthySpreadsheetValue(value) {
  return /^(yes|y|true|1|attended|checked in|check in|present)$/i.test(String(value || '').trim());
}

function spreadsheetDateValue(dateValue, timeValue = '') {
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) return dateValue.toISOString();
  if (typeof dateValue === 'number') {
    const parsed = XLSX.SSF.parse_date_code(dateValue);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 9, parsed.M || 0, parsed.S || 0)).toISOString();
  }
  const dateText = String(dateValue || '').trim();
  const timeText = String(timeValue || '').trim();
  if (!dateText) return new Date().toISOString();
  const direct = new Date(timeText && !/\d{1,2}:\d{2}/.test(dateText) ? `${dateText} ${timeText}` : dateText);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const dmy = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(.+))?$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const parsed = new Date(`${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T${timeText || dmy[4] || '09:00'}:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizedEventName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]+/g, '');
}

function eventMasterDateToken(value) {
  const text = String(value || '').trim();
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g);
  if (iso?.length) return iso[iso.length - 1].replace(/\.\d+Z$/, 'Z');
  const date = text.match(/\d{4}-\d{2}-\d{2}/);
  return date ? date[0] : '';
}

function eventStartToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 16);
  return text.slice(0, 16).toLowerCase();
}

function spreadsheetEventKey(event) {
  const name = normalizedEventName(event.name);
  const masterDate = eventMasterDateToken(event.master_event_key);
  if (name && masterDate) return `event:${name}|${masterDate}`;
  const start = eventStartToken(event.start_at);
  if (name && start) return `event:${name}|${start}`;
  const sheetId = String(event.sheet_event_id || event.eventbrite_event_id || '').trim().toLowerCase();
  if (sheetId) return `sheet:${sheetId}`;
  return [event.name, event.start_at, event.location].map(item => String(item || '').trim().toLowerCase()).join('|');
}

function findSpreadsheetEvent(db, eventRecord) {
  const key = spreadsheetEventKey(eventRecord);
  const name = normalizedEventName(eventRecord.name);
  const masterDate = eventMasterDateToken(eventRecord.master_event_key);
  const startDay = String(eventRecord.start_at || '').slice(0, 10);
  return (db.events || []).find(item => spreadsheetEventKey(item) === key) ||
    (db.events || []).find(item => {
      if (normalizedEventName(item.name) !== name) return false;
      const itemMasterDate = eventMasterDateToken(item.master_event_key);
      if (masterDate && itemMasterDate) return itemMasterDate === masterDate;
      return String(item.start_at || '').slice(0, 10) === startDay;
    }) ||
    null;
}

function mergeSpreadsheetEventRecord(target, eventRecord) {
  const attendees = target.attendees || [];
  const capacity = Math.max(Number(target.capacity || 0), Number(eventRecord.capacity || 0), attendees.length);
  Object.assign(target, {
    ...eventRecord,
    id: target.id,
    attendees,
    capacity,
    created_at: target.created_at || eventRecord.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return target;
}

function mergeEventAttendees(primary = [], secondary = []) {
  const byKey = new Map();
  for (const attendee of [...primary, ...secondary]) {
    const key = normalizeEmail(attendee.email) || attendee.eventbrite_attendee_id || attendee.attendee_id || attendee.id;
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) || {}), ...attendee });
  }
  return [...byKey.values()];
}

function googleSheetExportUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const id = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return '';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}

async function spreadsheetBufferFromImport({ filename = 'events.xlsx', file_base64 = '', google_url = '' } = {}) {
  if (google_url) {
    const exportUrl = googleSheetExportUrl(google_url);
    if (!exportUrl) throw statusError(400, 'Use a Google Sheets link, not a Google Doc link.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(exportUrl, { signal: controller.signal });
      if (!response.ok) throw statusError(400, 'Could not read this Google Sheet. Share it with anyone who has the link, then try again.');
      return { filename: `${filename || 'google-sheet'}.xlsx`, buffer: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      if (error.name === 'AbortError') throw statusError(504, 'Google Sheet request timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!file_base64) throw statusError(400, 'Upload an Excel file or paste a Google Sheets link first.');
  const buffer = Buffer.from(String(file_base64).replace(/^data:[^,]+,/, ''), 'base64');
  return { filename, buffer };
}

async function importSpreadsheetEvents(db, user, input = {}) {
  db.eventbrite ||= { connected: false, imported_event_ids: [], imported_attendee_ids: [] };
  const eventIncrementalStart = EVENTS_INCREMENTAL_ONLY ? ensureIncrementalStart(db.eventbrite, 'events_incremental_started_at') : null;
  const { filename, buffer } = await spreadsheetBufferFromImport(input);
  if (!buffer.length) throw statusError(400, 'The uploaded file is empty.');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames.length) throw statusError(400, 'No sheets were found in this file.');
  const allRows = workbook.SheetNames.flatMap(sheetName => {
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false })
      .filter(row => Object.values(row).some(value => String(value || '').trim()))
      .map(row => ({ ...row, __sheet: sheetName }));
  });
  const rows = allRows.filter(row => {
    const hasAttendee = normalizeEmail(rowValue(row, ['email', 'email address', 'attendee email', 'learner email', 'student email'])) ||
      rowValue(row, ['attendee id']) ||
      rowValue(row, ['attendee name', 'full name', 'learner name', 'student name', 'name']);
    const hasEvent = rowValue(row, ['event name', 'event', 'event title', 'title', 'session']);
    return hasEvent || hasAttendee;
  });
  if (!rows.length) throw statusError(400, 'No usable rows were found in this file.');

  const eventMap = new Map();
  let importedAttendees = 0;
  let linkedLeads = 0;
  for (const row of rows) {
    const email = normalizeEmail(rowValue(row, ['email', 'email address', 'attendee email', 'learner email', 'student email']));
    const eventName = String(rowValue(row, ['event name', 'event', 'event title', 'title', 'session']) || path.basename(filename, path.extname(filename)) || 'Imported event').trim();
    const startAt = spreadsheetDateValue(rowValue(row, ['start_at', 'start at', 'date', 'event date', 'start date', 'when']), rowValue(row, ['time', 'start time', 'event time']));
    const meetingLink = String(rowValue(row, ['google meet', 'google meet link', 'meet link', 'zoom link', 'meeting link', 'meeting url', 'join link']) || '').trim();
    const eventRecord = {
      name: eventName,
      location: String(rowValue(row, ['location', 'venue', 'place', 'city']) || 'Imported').trim(),
      start_at: startAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      campaign: String(rowValue(row, ['campaign', 'source', 'channel']) || 'Excel import').trim(),
      capacity: Number(rowValue(row, ['capacity', 'spaces', 'seats']) || 0) || 0,
      sheet_event_id: String(rowValue(row, ['event id']) || '').trim(),
      master_event_key: String(rowValue(row, ['master event key']) || '').trim(),
      description: String(rowValue(row, ['description']) || '').trim(),
      status: String(rowValue(row, ['status', 'event status']) || '').trim(),
      timezone: String(rowValue(row, ['timezone']) || '').trim(),
      ...(meetingLink ? { meeting_link: meetingLink, zoom_link: meetingLink } : {})
    };
    const existing = findSpreadsheetEvent(db, eventRecord);
    const startsAfterIncrementalStart = !eventIncrementalStart || new Date(eventRecord.start_at) >= eventIncrementalStart;
    if (EVENTS_INCREMENTAL_ONLY && !existing && !startsAfterIncrementalStart) continue;
    const key = spreadsheetEventKey(eventRecord);
    if (!eventMap.has(key)) {
      eventMap.set(key, existing ? mergeSpreadsheetEventRecord(existing, eventRecord) : {
        id: nextId('EV', [db.events, [...eventMap.values()]]),
        ...eventRecord,
        attendees: []
      });
    }
    const event = eventMap.get(key);
    if (meetingLink) {
      event.meeting_link = meetingLink;
      event.zoom_link = meetingLink;
    }
    const full = String(rowValue(row, ['attendee name', 'full name', 'learner name', 'student name', 'name']) || '').trim();
    const parts = nameParts(full, email || 'attendee@event.local');
    const first_name = String(rowValue(row, ['first name', 'firstname', 'forename', 'given name']) || parts.first_name || 'Event').trim();
    const last_name = String(rowValue(row, ['last name', 'lastname', 'surname', 'family name']) || parts.last_name || 'Attendee').trim();
    if (!email && !full && !rowValue(row, ['first name', 'firstname'])) continue;
    const programme = programmeForEvent(db, event.name);
    const result = ensureLeadRecord(db, user, {
      first_name,
      last_name,
      programme_id: programme.id,
      email: email || `${numericHash(`${event.name}:${first_name}:${last_name}`)}@event.local`,
      employer: String(rowValue(row, ['employer', 'company', 'organisation', 'organization']) || '').trim(),
      phone: String(rowValue(row, ['phone', 'mobile', 'telephone']) || '').trim(),
      city: String(rowValue(row, ['city', 'town']) || '').trim(),
      stage: 'New lead',
      priority: String(rowValue(row, ['priority']) || 'P2').trim(),
      source_first_touch: 'Event',
      source_lead_capture: 'Event',
      contact_permission: String(rowValue(row, ['contact permission', 'consent', 'permission']) || 'Unknown').trim(),
      created_at: startAt
    }, {
      taskTitle: `Follow up after ${event.name}`,
      taskKind: 'Follow-up'
    });
    const lead = result.lead;
    if (lead) linkedLeads += 1;
    const attendeeId = `XL-${numericHash(`${event.id}:${email || first_name}:${last_name}`)}`;
    const attendedAt = rowValue(row, ['attended_at', 'attended at', 'checked in at', 'check in time']);
    const attended = attendedAt || truthySpreadsheetValue(rowValue(row, ['attended', 'checked in', 'check in', 'present']));
    const attendee = {
      id: attendeeId,
      attendee_id: String(rowValue(row, ['attendee id']) || '').trim(),
      attendee_dedupe_key: String(rowValue(row, ['attendee dedupe key']) || '').trim(),
      attendee_unique_key: String(rowValue(row, ['attendee unique key']) || '').trim(),
      lead_id: lead?.id || '',
      first_name: lead?.first_name || first_name,
      last_name: lead?.last_name || last_name,
      email: lead?.email || email,
      phone: String(rowValue(row, ['phone', 'mobile', 'telephone']) || lead?.phone || '').trim(),
      job_title: String(rowValue(row, ['job title', 'title', 'role']) || '').trim(),
      status: String(rowValue(row, ['status', 'attendance status']) || '').trim(),
      zoom_link: meetingLink,
      source_account: String(rowValue(row, ['source account', 'owner', 'account']) || '').trim(),
      reminder_1_day: String(rowValue(row, ['1 day before event']) || '').trim(),
      reminder_2_hours: String(rowValue(row, ['2 hours before event']) || '').trim(),
      attended_at: attendedAt ? spreadsheetDateValue(attendedAt) : attended ? new Date().toISOString() : null
    };
    const existingAttendee = (event.attendees || []).find(item => normalizeEmail(item.email) === normalizeEmail(attendee.email) || item.id === attendee.id);
    if (existingAttendee) Object.assign(existingAttendee, attendee);
    else {
      event.attendees ||= [];
      event.attendees.push(attendee);
      importedAttendees += 1;
    }
  }

  let importedEvents = 0;
  for (const event of eventMap.values()) {
    event.registrations = (event.attendees || []).length;
    event.attendance = (event.attendees || []).filter(item => item.attended_at).length;
    if (!event.capacity || event.capacity < event.registrations) event.capacity = event.registrations;
    if (!db.events.some(item => item.id === event.id)) {
      db.events.push(event);
      importedEvents += 1;
    }
  }
  if (!eventMap.size && EVENTS_INCREMENTAL_ONLY) return { imported_events: 0, updated_events: 0, imported_attendees: 0, linked_leads: 0, skipped_old: true };
  if (!eventMap.size) throw statusError(400, 'No event rows were found. Include at least attendee name or email.');
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Events imported from Excel', 'integration', 'Excel', `${eventMap.size} events, ${importedAttendees} attendees, ${linkedLeads} linked leads`);
  return { imported_events: importedEvents, updated_events: eventMap.size - importedEvents, imported_attendees: importedAttendees, linked_leads: linkedLeads + reconciliation.attendees_linked, reconciliation };
}

async function importEventbriteEvents(db, user, maxEvents = 10, options = {}) {
  if (!eventbriteConfigured() && !eventbritePrivateTokenConfigured()) throw statusError(400, 'Eventbrite credentials are not configured.');
  db.eventbrite ||= { connected: false, imported_event_ids: [], imported_attendee_ids: [] };
  const eventIncrementalStart = EVENTS_INCREMENTAL_ONLY ? ensureIncrementalStart(db.eventbrite, 'events_incremental_started_at') : null;
  const accessToken = eventbriteAccessToken(db);
  const auth = { Authorization: `Bearer ${accessToken}` };
  const orgList = await fetchJson('https://www.eventbriteapi.com/v3/users/me/organizations/', { headers: auth });
  const events = [];
  const currentEventbriteIds = new Set();
  let eventbriteIdScanComplete = true;
  for (const org of orgList.organizations || []) {
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        expand: 'venue',
        status: 'all',
        page_size: '50',
        page: String(page)
      });
      const list = await fetchJson(`https://www.eventbriteapi.com/v3/organizations/${org.id}/events/?${params}`, { headers: auth, timeoutMs: 12000 });
      for (const event of list.events || []) {
        currentEventbriteIds.add(event.id);
        if (events.length < maxEvents) events.push({ ...event, organization_name: org.name });
      }
      const pagination = list.pagination || {};
      const pageCount = Number(pagination.page_count || page);
      if (!pagination.has_more_items || page >= pageCount || page >= 50) break;
      if (page >= EVENTBRITE_DELETE_SCAN_PAGES) {
        eventbriteIdScanComplete = false;
        break;
      }
      page += 1;
    }
  }
  async function attendeesForEvent(event) {
    const attendees = [];
    let page = 1;
    do {
      const params = new URLSearchParams({ page: String(page) });
      const pageResult = await fetchJson(`https://www.eventbriteapi.com/v3/events/${event.id}/attendees/?${params}`, { headers: auth, timeoutMs: 12000 });
      attendees.push(...(pageResult.attendees || []));
      const pagination = pageResult.pagination || {};
      const pageCount = Number(pagination.page_count || page);
      if (!pagination.has_more_items || page >= pageCount || page >= 50) break;
      page += 1;
    } while (true);
    return attendees;
  }
  const attendeeResults = new Map();
  for (let index = 0; index < events.length; index += 6) {
    const batch = events.slice(index, index + 6);
    const results = await Promise.all(batch.map(async event => {
      try {
        return { event_id: event.id, attendees: await attendeesForEvent(event), error: '' };
      } catch (error) {
        return { event_id: event.id, attendees: [], error: error.message };
      }
    }));
    for (const result of results) attendeeResults.set(result.event_id, result);
  }
  let importedEvents = 0;
  let importedAttendees = 0;
  let attendeeErrors = 0;
  const deletedEventIds = new Set();
  for (const event of events.slice(0, maxEvents)) {
    const eventRecordForMatch = {
      eventbrite_event_id: event.id,
      name: event.name?.text || 'Eventbrite event',
      start_at: event.start?.utc || event.start?.local || new Date().toISOString(),
      location: eventVenue(event)
    };
    let existing = db.events.find(item => item.eventbrite_event_id === event.id);
    const matchingImportedEvent = findSpreadsheetEvent(db, eventRecordForMatch);
    if (existing && matchingImportedEvent && matchingImportedEvent.id !== existing.id) {
      existing.attendees = mergeEventAttendees(existing.attendees || [], matchingImportedEvent.attendees || []);
      db.events = db.events.filter(item => item.id !== matchingImportedEvent.id);
      deletedEventIds.add(matchingImportedEvent.id);
    } else if (!existing) {
      existing = matchingImportedEvent;
    }
    if (EVENTS_INCREMENTAL_ONLY && !existing) {
      const changedAt = new Date(event.changed || event.created || event.start?.utc || event.start?.local || Date.now());
      if (changedAt < eventIncrementalStart) continue;
    }
    const attendeeResult = attendeeResults.get(event.id) || { attendees: [], error: '' };
    let sync_warning = attendeeResult.error ? `Attendees could not be imported: ${attendeeResult.error}` : '';
    if (attendeeResult.error) attendeeErrors += 1;
    const attendees = (attendeeResult.attendees || []).map(attendee => {
      const lead = leadFromAttendee(db, user, attendee, event);
      const profile = attendee.profile || {};
      const fallbackNames = nameParts(profile.name || '', String(profile.email || attendee.email || `${attendee.id}@eventbrite.local`).toLowerCase());
      if (!(db.eventbrite.imported_attendee_ids || []).includes(attendee.id)) {
        db.eventbrite.imported_attendee_ids = [...(db.eventbrite.imported_attendee_ids || []), attendee.id];
        importedAttendees += 1;
      }
      return {
        id: `EB-${attendee.id}`,
        eventbrite_attendee_id: attendee.id,
        lead_id: lead?.id || '',
        first_name: lead?.first_name || profile.first_name || fallbackNames.first_name,
        last_name: lead?.last_name || profile.last_name || fallbackNames.last_name,
        email: lead?.email || String(profile.email || attendee.email || `${attendee.id}@eventbrite.local`).toLowerCase(),
        attended_at: attendee.checked_in ? (attendee.changed || new Date().toISOString()) : null
      };
    });
    const mergedAttendees = mergeEventAttendees(existing?.attendees || [], attendees);
    const record = {
      id: existing?.id || nextId('EV', [db.events]),
      eventbrite_event_id: event.id,
      name: event.name?.text || 'Eventbrite event',
      location: eventVenue(event),
      start_at: event.start?.utc || event.start?.local || new Date().toISOString(),
      created_at: existing?.created_at || event.created || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      campaign: 'Eventbrite',
      capacity: Math.max(Number(existing?.capacity || 0), Number(event.capacity || event.ticket_availability?.quantity_total || mergedAttendees.length || 0)),
      registrations: Math.max(Number(existing?.registrations || 0), mergedAttendees.length),
      attendance: Math.max(Number(existing?.attendance || 0), mergedAttendees.filter(item => item.attended_at).length),
      attendees: mergedAttendees,
      sync_warning
    };
    if (existing) Object.assign(existing, record);
    else {
      db.events.push(record);
      importedEvents += 1;
    }
    if (!(db.eventbrite.imported_event_ids || []).includes(event.id)) db.eventbrite.imported_event_ids = [...(db.eventbrite.imported_event_ids || []), event.id];
  }
  db.eventbrite.last_sync_at = new Date().toISOString();
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Eventbrite synced', 'integration', 'Eventbrite', `${importedEvents} events, ${importedAttendees} attendees${deletedEventIds.size ? `, ${deletedEventIds.size} removed` : ''}${attendeeErrors ? `, ${attendeeErrors} attendee import warnings` : ''}`);
  if (options.save !== false) await saveDb(db);
  return { imported_events: importedEvents, imported_attendees: importedAttendees, deleted_events: deletedEventIds.size, deleted_event_ids: [...deletedEventIds], deletion_scan_complete: eventbriteIdScanComplete, scanned: events.length, attendee_errors: attendeeErrors, reconciliation, last_sync_at: db.eventbrite.last_sync_at };
}

async function zoomAccessToken(account) {
  if (!account) throw statusError(400, 'Zoom credentials are not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env.');
  const basic = Buffer.from(`${account.clientId}:${account.clientSecret}`).toString('base64');
  const token = await fetchZoomJson('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: account.accountId
    })
  }, `Zoom token for ${account.label}`);
  if (!token.access_token) throw statusError(502, 'Zoom did not return an access token.');
  return token.access_token;
}

function zoomUserId() {
  return encodeURIComponent(process.env.ZOOM_USER_ID || 'me');
}

function zoomSyncAllUsers() {
  return String(process.env.ZOOM_SYNC_ALL_USERS || 'false').toLowerCase() === 'true';
}

function zoomMeetingType() {
  const value = String(process.env.ZOOM_MEETING_TYPE || 'upcoming').trim();
  return value || 'upcoming';
}

function zoomMeetingTypes() {
  const value = zoomMeetingType().toLowerCase();
  if (value === 'all') return ['upcoming', 'scheduled', 'upcoming_meetings', 'previous_meetings', 'past'];
  return [value];
}

function zoomIncludeHistory() {
  return String(process.env.ZOOM_INCLUDE_HISTORY || 'true').toLowerCase() !== 'false';
}

function zoomReportHistoryMonths(options = {}) {
  const requested = Number(options.report_history_months || options.history_months || process.env.ZOOM_REPORT_HISTORY_MONTHS || 6);
  return Math.max(1, Math.min(requested || 6, 6));
}

function zoomReportOverlapDays() {
  return Math.max(0, Math.min(Number(process.env.ZOOM_REPORT_SYNC_OVERLAP_DAYS || 7), 30));
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function zoomHistoryStart(options = {}) {
  const raw = String(options.history_from || process.env.ZOOM_HISTORY_FROM || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function zoomSixMonthFloor(reference = new Date()) {
  const floor = new Date(reference);
  floor.setUTCHours(0, 0, 0, 0);
  floor.setUTCMonth(floor.getUTCMonth() - 6);
  return floor;
}

function zoomReportCalendarFloor(reference = new Date(), months = 6) {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - (months - 1), 1));
}

function monthEnd(date) {
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  end.setUTCHours(0, 0, 0, 0);
  return end;
}

function zoomMaxDate(...dates) {
  return dates.filter(Boolean).reduce((max, date) => !max || date > max ? date : max, null);
}

function zoomReportHistoryRanges(options = {}) {
  const ranges = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const months = zoomReportHistoryMonths(options);
  const requestedStart = zoomReportCalendarFloor(now, months);
  const syncState = options.sync_state || {};
  let incrementalStart = null;
  if (syncState.initial_backfill_completed && syncState.last_successful_sync_at) {
    incrementalStart = new Date(syncState.last_successful_sync_at);
    if (!Number.isNaN(incrementalStart.getTime())) {
      incrementalStart.setUTCDate(incrementalStart.getUTCDate() - zoomReportOverlapDays());
      incrementalStart.setUTCHours(0, 0, 0, 0);
    } else {
      incrementalStart = null;
    }
  }
  const start = zoomMaxDate(zoomReportCalendarFloor(now, 6), zoomHistoryStart(options), incrementalStart || requestedStart);
  if (!start || start > now) return [{ from: dateOnly(now), to: dateOnly(now) }];
  let from = new Date(start);
  from.setUTCHours(0, 0, 0, 0);
  while (from <= now && ranges.length < 8) {
    const to = monthEnd(from);
    if (to > now) to.setTime(now.getTime());
    ranges.push({ from: dateOnly(from), to: dateOnly(to) });
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() + 1);
  }
  return ranges;
}

function zoomReportUnsupportedWarning(message = '') {
  return /only available for paid|zmp account|does not contain scopes|no permission|report.*scope/i.test(String(message || ''));
}

function zoomOptionalEndpointDisableWarning(message = '') {
  return /does not contain scopes|invalid access token|no permission|not authorized|scope|timed out|timeout/i.test(String(message || ''));
}

function zoomParticipantImportEnabled() {
  return !/^(0|false|no|off)$/i.test(String(process.env.ZOOM_IMPORT_PARTICIPANTS || 'true'));
}

function zoomPastParticipantImportEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.ZOOM_IMPORT_PAST_PARTICIPANTS || 'false'));
}

function zoomParticipantLimit() {
  return Math.max(1, Math.min(Number(process.env.ZOOM_MAX_PARTICIPANTS_PER_MEETING || 300), 1000));
}

function zoomRegistrantLookupLimit() {
  return Math.max(0, Math.min(Number(process.env.ZOOM_MAX_REGISTRANT_MEETING_LOOKUPS || 20), 200));
}

function zoomCallHistoryMonths(options = {}) {
  const requested = Number(options.call_history_months || process.env.ZOOM_CALL_HISTORY_MONTHS || 3);
  return Math.max(1, Math.min(requested || 3, 12));
}

function zoomCallMaxRecords(options = {}) {
  return Math.max(1, Math.min(Number(options.max_calls || process.env.ZOOM_MAX_CALLS || 1000), 5000));
}

function zoomCallHistoryRanges(options = {}) {
  const ranges = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  let from = zoomReportCalendarFloor(now, zoomCallHistoryMonths(options));
  from.setUTCHours(0, 0, 0, 0);
  while (from <= now && ranges.length < 12) {
    const to = monthEnd(from);
    if (to > now) to.setTime(now.getTime());
    ranges.push({ from: dateOnly(from), to: dateOnly(to) });
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() + 1);
  }
  return ranges;
}

function phoneDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function samePhone(a, b) {
  const left = phoneDigits(a), right = phoneDigits(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right.slice(-10)) || right.endsWith(left.slice(-10));
}

function leadForZoomCall(db, record = {}) {
  const numbers = [record.caller_number, record.callee_number].filter(Boolean);
  return (db.leads || []).find(lead => numbers.some(number => samePhone(lead.phone, number))) || null;
}

function zoomCallLeadMatch(db, record = {}) {
  for (const lead of db.leads || []) {
    if (samePhone(lead.phone, record.caller_number)) return { lead, side: 'caller', number: record.caller_number };
    if (samePhone(lead.phone, record.callee_number)) return { lead, side: 'callee', number: record.callee_number };
  }
  return { lead: null, side: '', number: '' };
}

function zoomMeetingPathId(meeting = {}) {
  const value = String(meeting.uuid || meeting.id || '').trim();
  return encodeURIComponent(value);
}

function zoomRegistrantPhone(registrant = {}) {
  const direct = registrant.phone || registrant.phone_number || registrant.mobile || registrant.mobile_phone || registrant.cell_phone;
  if (direct) return String(direct).trim();
  for (const answer of registrant.custom_questions || []) {
    const title = String(answer.title || answer.question || '').toLowerCase();
    if (/phone|mobile|telephone|tel/.test(title) && answer.value) return String(answer.value).trim();
  }
  return '';
}

function splitZoomName(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
}

function zoomLeadByEmailMap(db) {
  return new Map((db.leads || []).map(lead => [normalizeEmail(lead.email), lead]).filter(([email]) => email));
}

function zoomAttendeeFromRecord(record = {}, meeting = {}, source = 'zoom', leadByEmail = new Map()) {
  const email = normalizeEmail(record.email || record.user_email || record.registrant_email);
  const name = record.name || record.user_name || [record.first_name, record.last_name].filter(Boolean).join(' ') || email || 'Zoom attendee';
  const splitName = splitZoomName(name);
  const lead = email ? leadByEmail.get(email) : null;
  const phone = String(zoomRegistrantPhone(record) || record.phone || record.phone_number || lead?.phone || '').trim();
  return {
    id: `ZA-${numericHash([meeting.zoom_account_id || '', meeting.uuid || meeting.id || '', source, email || record.id || name].join('|'))}`,
    first_name: record.first_name || splitName.first_name || lead?.first_name || '',
    last_name: record.last_name || splitName.last_name || lead?.last_name || '',
    email,
    phone,
    status: source === 'participant' ? 'attended' : String(record.status || 'confirmed').replace(/^approved$/i, 'confirmed'),
    attended_at: source === 'participant' ? (record.join_time || record.leave_time || meeting.start_time || '') : '',
    source_account: 'Zoom',
    zoom_source: source,
    zoom_participant_id: record.id || record.user_id || '',
    lead_id: lead?.id || ''
  };
}

async function fetchZoomMeetingRegistrants(auth, meeting, account, host, maxParticipants) {
  if (!meeting.id) return { attendees: [], warning: '' };
  const attendees = [];
  let nextPageToken = '';
  while (attendees.length < maxParticipants) {
    const params = new URLSearchParams({
      page_size: String(Math.max(1, Math.min(100, maxParticipants - attendees.length)))
    });
    if (nextPageToken) params.set('next_page_token', nextPageToken);
    try {
      const list = await fetchZoomJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meeting.id)}/registrants?${params}`, { headers: auth, timeoutMs: 3000, attempts: 1 }, `Zoom registrants for ${account.label} / ${host.label || host.id}`);
      attendees.push(...(list.registrants || []));
      nextPageToken = list.next_page_token || '';
      if (!nextPageToken || !(list.registrants || []).length) break;
    } catch (error) {
      return { attendees, warning: error.message || 'Zoom registrants unavailable.' };
    }
  }
  return { attendees, warning: '' };
}

async function fetchZoomPastParticipants(auth, meeting, account, host, maxParticipants) {
  if (!meeting.uuid && !meeting.id) return { attendees: [], warning: '' };
  const attendees = [];
  let nextPageToken = '';
  while (attendees.length < maxParticipants) {
    const params = new URLSearchParams({
      page_size: String(Math.max(1, Math.min(100, maxParticipants - attendees.length)))
    });
    if (nextPageToken) params.set('next_page_token', nextPageToken);
    try {
      const list = await fetchZoomJson(`https://api.zoom.us/v2/past_meetings/${zoomMeetingPathId(meeting)}/participants?${params}`, { headers: auth, timeoutMs: 6000, attempts: 1 }, `Zoom participants for ${account.label} / ${host.label || host.id}`);
      attendees.push(...(list.participants || []));
      nextPageToken = list.next_page_token || '';
      if (!nextPageToken || !(list.participants || []).length) break;
    } catch (error) {
      return { attendees, warning: error.message || 'Zoom participants unavailable.' };
    }
  }
  return { attendees, warning: '' };
}

async function fetchZoomMeetingAttendees(auth, meeting, account, host, leadByEmail, maxParticipants = zoomParticipantLimit(), availability = {}) {
  if (!zoomParticipantImportEnabled()) return { attendees: [], warnings: [] };
  availability.registrantsUnavailable ||= new Set();
  availability.participantsUnavailable ||= new Set();
  availability.registrantLookups ||= 0;
  const hostKey = `${account.accountId}:${host.id || zoomUserId()}`;
  const warnings = [];
  const canLookupRegistrants = availability.registrantLookups < zoomRegistrantLookupLimit();
  const registrants = !canLookupRegistrants || availability.registrantsUnavailable.has(hostKey)
    ? { attendees: [], warning: '' }
    : await fetchZoomMeetingRegistrants(auth, meeting, account, host, maxParticipants);
  if (canLookupRegistrants && !availability.registrantsUnavailable.has(hostKey)) availability.registrantLookups += 1;
  if (registrants.warning) {
    warnings.push(registrants.warning);
    if (zoomOptionalEndpointDisableWarning(registrants.warning)) availability.registrantsUnavailable.add(hostKey);
  }
  const remaining = zoomPastParticipantImportEnabled() ? Math.max(0, maxParticipants - registrants.attendees.length) : 0;
  const participants = remaining && !availability.participantsUnavailable.has(hostKey)
    ? await fetchZoomPastParticipants(auth, meeting, account, host, remaining)
    : { attendees: [], warning: '' };
  if (participants.warning) {
    warnings.push(participants.warning);
    if (zoomOptionalEndpointDisableWarning(participants.warning)) availability.participantsUnavailable.add(hostKey);
  }
  return {
    attendees: mergeEventAttendees(
      registrants.attendees.map(item => zoomAttendeeFromRecord(item, meeting, 'registrant', leadByEmail)),
      participants.attendees.map(item => zoomAttendeeFromRecord(item, meeting, 'participant', leadByEmail))
    ),
    warnings
  };
}

async function enrichZoomMeetingWithAttendees(auth, account, host, meeting, leadByEmail, warnings, availability) {
  const attendeeResult = await fetchZoomMeetingAttendees(auth, meeting, account, host, leadByEmail, zoomParticipantLimit(), availability);
  attendeeResult.warnings.forEach(warning => {
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  });
  return {
    ...meeting,
    zoom_attendees: attendeeResult.attendees,
    zoom_attendee_count: attendeeResult.attendees.length,
    zoom_phone_count: attendeeResult.attendees.filter(attendee => attendee.phone).length
  };
}

async function fetchZoomMeetingHosts(auth, maxUsers = 100, account = {}) {
  if (!zoomSyncAllUsers()) return [{ id: account.userId || process.env.ZOOM_USER_ID || 'me', label: account.userId || process.env.ZOOM_USER_ID || 'me' }];
  const hosts = [];
  let nextPageToken = '';
  while (hosts.length < maxUsers) {
    const params = new URLSearchParams({
      status: 'active',
      page_size: String(Math.max(1, Math.min(100, maxUsers - hosts.length)))
    });
    if (nextPageToken) params.set('next_page_token', nextPageToken);
    const list = await fetchZoomJson(`https://api.zoom.us/v2/users?${params}`, { headers: auth, timeoutMs: 20000 }, `Zoom users for ${account.label || 'account'}`);
    for (const item of list.users || []) {
      hosts.push({
        id: item.id || item.email,
        label: item.email || item.display_name || item.id || 'Zoom user'
      });
    }
    nextPageToken = list.next_page_token || '';
    if (!nextPageToken || !(list.users || []).length) break;
  }
  return hosts.length ? hosts : [{ id: account.userId || process.env.ZOOM_USER_ID || 'me', label: account.userId || process.env.ZOOM_USER_ID || 'me' }];
}

function zoomCallField(call = {}, ...keys) {
  for (const key of keys) {
    const parts = key.split('.');
    let value = call;
    for (const part of parts) value = value?.[part];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function zoomCallParticipants(call = {}) {
  return call.call_participants || call.participants || call.users || [];
}

function zoomCallPartyName(party = {}) {
  return String(party.name || party.display_name || party.user_name || party.extension_name || party.email || '').trim();
}

function zoomCallPartyNumber(party = {}) {
  return String(party.phone_number || party.number || party.extension_number || party.extension || '').trim();
}

function usableZoomPhone(value = '') {
  const text = String(value || '').trim();
  return phoneDigits(text).length >= 7 ? text : '';
}

function zoomCallPhoneCandidates(call = {}, role = '') {
  const matches = [];
  const rolePattern = role === 'caller' ? /caller|from|source/i : role === 'callee' ? /callee|to|target|destination/i : /./;
  const walk = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (child && typeof child === 'object') {
        walk(child, nextPath);
        continue;
      }
      if (!rolePattern.test(nextPath)) continue;
      if (!/(phone|did|number)$/i.test(key)) continue;
      if (/country|type|ext|extension|id$/i.test(key)) continue;
      const phone = usableZoomPhone(child);
      if (phone) matches.push({ path: nextPath, phone });
    }
  };
  walk(call);
  return matches;
}

function zoomCallBestNumber(call = {}, role = 'caller', party = {}) {
  const direct = role === 'caller'
    ? zoomCallField(call, 'caller_number', 'caller_did_number', 'caller.phone_number', 'from.phone_number', 'from.did_number', 'source.phone_number', 'source.did_number')
    : zoomCallField(call, 'callee_number', 'callee_did_number', 'callee.phone_number', 'to.phone_number', 'to.did_number', 'destination.phone_number', 'destination.did_number');
  return usableZoomPhone(direct) || usableZoomPhone(zoomCallPartyNumber(party)) || zoomCallPhoneCandidates(call, role)[0]?.phone || '';
}

function zoomCallParty(call = {}, role = 'caller') {
  const regex = role === 'caller' ? /caller|from|source/i : /callee|to|target|destination/i;
  return zoomCallParticipants(call).find(item => regex.test(`${item.role || ''} ${item.type || ''} ${item.direction || ''}`)) || {};
}

function normalizeZoomCallRecord(db, account, call = {}) {
  const caller = zoomCallParty(call, 'caller');
  const callee = zoomCallParty(call, 'callee');
  const callerNumber = zoomCallBestNumber(call, 'caller', caller);
  const calleeNumber = zoomCallBestNumber(call, 'callee', callee);
  const startedAt = zoomCallField(call, 'start_time', 'date_time', 'startTime', 'call_start_time', 'answer_start_time') || new Date().toISOString();
  const callKey = String(call.call_history_uuid || call.call_history_id || call.call_id || call.id || [startedAt, callerNumber, calleeNumber, call.duration].join('|'));
  const direction = String(call.direction || call.call_direction || '').toLowerCase() || 'unknown';
  const ownerName = String(call.owner?.name || call.user_name || call.extension_name || call.user?.name || '').trim();
  const participants = zoomCallParticipants(call).map(item => ({
    role: item.role || item.type || item.direction || '',
    name: zoomCallPartyName(item),
    number: zoomCallPartyNumber(item),
    email: normalizeEmail(item.email || item.user_email || ''),
    extension: String(item.extension_number || item.extension || '').trim()
  })).filter(item => item.name || item.number || item.email || item.extension);
  const record = {
    id: `ZC-${numericHash(`${account.accountId}|${callKey}`)}`,
    zoom_call_id: String(call.call_id || callKey),
    zoom_call_history_uuid: String(call.call_history_uuid || call.call_history_id || call.id || ''),
    zoom_account_id: account.accountId,
    zoom_account_label: account.label,
    started_at: startedAt,
    direction,
    result: String(call.result || call.call_result || call.disposition || call.status || ''),
    duration: Number(call.duration || call.talk_time || call.total_duration || 0),
    caller_name: String(zoomCallField(call, 'caller_name', 'from.name', 'caller.name') || zoomCallPartyName(caller) || ''),
    caller_number: callerNumber,
    caller_digits: phoneDigits(callerNumber),
    callee_name: String(zoomCallField(call, 'callee_name', 'to.name', 'callee.name') || zoomCallPartyName(callee) || ''),
    callee_number: calleeNumber,
    callee_digits: phoneDigits(calleeNumber),
    owner_name: ownerName,
    owner_extension: String(call.extension_number || call.extension || call.owner?.extension_number || '').trim(),
    site_name: String(call.site?.name || ''),
    path: String(call.path || call.connect_type || call.call_type || call.call_path || ''),
    source: 'Zoom Phone',
    source_detail: [account.label, ownerName, String(call.site?.name || ''), String(call.path || call.connect_type || call.call_type || '')].filter(Boolean).join(' / '),
    call_type: String(call.call_type || call.type || call.connect_type || ''),
    department: String(call.department || call.cost_center || ''),
    participants,
    raw: call
  };
  const match = zoomCallLeadMatch(db, record);
  const lead = match.lead;
  if (lead) {
    record.lead_id = lead.id;
    record.lead_name = fullName(lead);
    record.matched_side = match.side;
    record.matched_number = match.number;
    record.matched_source = 'CRM lead phone';
  }
  return record;
}

async function fetchZoomAccountCallHistory(auth, account, maxCalls = 1000, options = {}) {
  const calls = [];
  const warnings = [];
  for (const range of zoomCallHistoryRanges(options)) {
    if (calls.length >= maxCalls) break;
    let nextPageToken = '';
    while (calls.length < maxCalls) {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        page_size: String(Math.max(1, Math.min(100, maxCalls - calls.length))),
        time_type: 'start_time'
      });
      if (nextPageToken) params.set('next_page_token', nextPageToken);
      try {
        const result = await fetchZoomJson(`https://api.zoom.us/v2/phone/call_history?${params}`, { headers: auth, timeoutMs: 20000, attempts: 1 }, `Zoom phone calls for ${account.label}`);
        const pageCalls = result.call_history || result.call_logs || result.calls || [];
        calls.push(...pageCalls);
        nextPageToken = result.next_page_token || '';
        if (!nextPageToken || !pageCalls.length) break;
      } catch (error) {
        warnings.push(error.message || 'Zoom Phone call history failed.');
        break;
      }
    }
  }
  return { calls, warnings };
}

async function importZoomCalls(db, user, maxCalls = zoomCallMaxRecords(), options = {}) {
  db.zoom ||= { imported_meeting_ids: [] };
  db.zoom.calls ||= [];
  const accounts = zoomAccounts();
  if (!accounts.length) throw statusError(400, 'Zoom credentials are not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env.');
  const existing = new Map((db.zoom.calls || []).map(call => {
    const hydrated = hydrateZoomStoredCall(db, call);
    return [hydrated.id, hydrated];
  }));
  let scanned = 0, importedCalls = 0, updatedCalls = 0;
  const warnings = [];
  for (const account of accounts) {
    if (scanned >= maxCalls) break;
    const accessToken = await zoomAccessToken(account);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const result = await fetchZoomAccountCallHistory(auth, account, maxCalls - scanned, options);
    warnings.push(...result.warnings);
    for (const item of result.calls) {
      const record = normalizeZoomCallRecord(db, account, item);
      scanned += 1;
      if (existing.has(record.id)) {
        existing.set(record.id, { ...existing.get(record.id), ...record, updated_at: new Date().toISOString() });
        updatedCalls += 1;
      } else {
        existing.set(record.id, { ...record, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        importedCalls += 1;
      }
      if (scanned >= maxCalls) break;
    }
  }
  db.zoom.calls = [...existing.values()].sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0)).slice(0, Math.max(zoomCallMaxRecords(options), existing.size));
  db.zoom.last_call_sync_at = new Date().toISOString();
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Zoom calls synced', 'integration', 'Zoom Phone', `${importedCalls} created, ${updatedCalls} updated, ${scanned} scanned across ${accounts.length} accounts`);
  if (options.save !== false) await saveDb(db);
  return {
    imported_calls: importedCalls,
    updated_calls: updatedCalls,
    scanned,
    accounts: accounts.length,
    call_history_months: zoomCallHistoryMonths(options),
    warnings: [...new Set(warnings.filter(Boolean))],
    reconciliation,
    last_sync_at: db.zoom.last_call_sync_at
  };
}

function hydrateZoomStoredCall(db, call = {}) {
  if ((call.caller_number && call.callee_number) || !call.raw) return call;
  const account = {
    accountId: call.zoom_account_id || call.raw.zoom_account_id || 'zoom',
    label: call.zoom_account_label || call.raw.zoom_account_label || 'Zoom'
  };
  const normalized = normalizeZoomCallRecord(db, account, call.raw);
  return {
    ...call,
    ...normalized,
    id: call.id || normalized.id,
    created_at: call.created_at,
    updated_at: call.updated_at,
    raw: call.raw
  };
}

async function fetchZoomReportMeetings(auth, account, host, maxMeetings = 100, options = {}) {
  if (!zoomIncludeHistory()) return { meetings: [], warning: '' };
  const meetings = [];
  const ranges = zoomReportHistoryRanges(options);
  for (const range of ranges) {
    if (meetings.length >= maxMeetings) break;
    let nextPageToken = '';
    while (meetings.length < maxMeetings) {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        page_size: String(Math.max(1, Math.min(100, maxMeetings - meetings.length)))
      });
      if (nextPageToken) params.set('next_page_token', nextPageToken);
      try {
        const list = await fetchZoomJson(`https://api.zoom.us/v2/report/users/${encodeURIComponent(host.id || zoomUserId())}/meetings?${params}`, { headers: auth, timeoutMs: 12000, attempts: 1 }, `Zoom history for ${account.label} / ${host.label || host.id}`);
        meetings.push(...(list.meetings || []));
        nextPageToken = list.next_page_token || '';
        if (!nextPageToken || !(list.meetings || []).length) break;
      } catch (error) {
        if ([400, 401, 403, 404].includes(Number(error.status || 0))) return { meetings, warning: error.message || 'Zoom history scope is unavailable.' };
        throw error;
      }
    }
  }
  return { meetings, warning: '', ranges };
}

async function importZoomMeetings(db, user, maxMeetings = 25, options = {}) {
  db.zoom ||= { imported_meeting_ids: [] };
  db.zoom.sync_state ||= {};
  const meetings = [];
  const seenMeetings = new Set();
  const leadByEmail = zoomLeadByEmailMap(db);
  const attendeeAvailability = { registrantsUnavailable: new Set(), participantsUnavailable: new Set() };
  const accounts = zoomAccounts();
  if (!accounts.length) throw statusError(400, 'Zoom credentials are not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env.');
  let hostCount = 0;
  let importedAttendees = 0;
  let importedPhones = 0;
  const historyWarnings = [];
  const meetingTypes = zoomMeetingTypes();
  for (const account of accounts) {
    if (meetings.length >= maxMeetings) break;
    const accessToken = await zoomAccessToken(account);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const hosts = await fetchZoomMeetingHosts(auth, Number(process.env.ZOOM_MAX_USERS || 100), account);
    hostCount += hosts.length;
    for (const host of hosts) {
      if (meetings.length >= maxMeetings) break;
      const syncKey = `${account.accountId}:${host.id || zoomUserId()}`;
      const previousSyncState = db.zoom.sync_state[syncKey] || {};
      db.zoom.sync_state[syncKey] = {
        ...previousSyncState,
        zoom_account_id: account.accountId,
        zoom_account_label: account.label,
        zoom_user_id: host.id || zoomUserId(),
        zoom_user_label: host.label || host.id || zoomUserId(),
        last_attempt_at: new Date().toISOString(),
        status: 'running'
      };
      for (const meetingType of meetingTypes) {
        if (meetings.length >= maxMeetings) break;
        let nextPageToken = '';
        while (meetings.length < maxMeetings) {
          const params = new URLSearchParams({
            type: meetingType,
            page_size: String(Math.max(1, Math.min(100, maxMeetings - meetings.length)))
          });
          if (nextPageToken) params.set('next_page_token', nextPageToken);
          let list;
          try {
            list = await fetchZoomJson(`https://api.zoom.us/v2/users/${encodeURIComponent(host.id || zoomUserId())}/meetings?${params}`, { headers: auth, timeoutMs: 20000 }, `Zoom meetings for ${account.label} / ${host.label || host.id} / ${meetingType}`);
          } catch (error) {
            historyWarnings.push(error.message || `Zoom meetings failed for ${host.label || host.id} / ${meetingType}`);
            break;
          }
          for (const meeting of list.meetings || []) {
            const key = `${account.accountId}-${host.id || zoomUserId()}-${meeting.uuid || meeting.id || meeting.topic || 'meeting'}-${meeting.start_time || meeting.created_at || ''}`;
            if (seenMeetings.has(key)) continue;
            seenMeetings.add(key);
            const enrichedMeeting = await enrichZoomMeetingWithAttendees(auth, account, host, { ...meeting, host_id: host.id, host_label: host.label, zoom_account_id: account.accountId, zoom_account_label: account.label, zoom_list_type: meetingType }, leadByEmail, historyWarnings, attendeeAvailability);
            importedAttendees += enrichedMeeting.zoom_attendee_count || 0;
            importedPhones += enrichedMeeting.zoom_phone_count || 0;
            meetings.push(enrichedMeeting);
            if (meetings.length >= maxMeetings) break;
          }
          nextPageToken = list.next_page_token || '';
          if (!nextPageToken || !(list.meetings || []).length) break;
        }
      }
      if (zoomIncludeHistory() && meetings.length < maxMeetings) {
        const reportDisabled = previousSyncState.report_history_unavailable && zoomReportUnsupportedWarning(previousSyncState.last_error);
        const history = reportDisabled
          ? { meetings: [], warning: '', ranges: [], skipped: true }
          : await fetchZoomReportMeetings(auth, account, host, maxMeetings - meetings.length, { ...options, sync_state: previousSyncState });
        if (history.warning) {
          if (!zoomReportUnsupportedWarning(history.warning)) historyWarnings.push(history.warning);
          db.zoom.sync_state[syncKey] = {
            ...db.zoom.sync_state[syncKey],
            status: 'warning',
            last_error: history.warning,
            report_history_unavailable: zoomReportUnsupportedWarning(history.warning),
            last_report_ranges: history.ranges || []
          };
        } else {
          db.zoom.sync_state[syncKey] = {
            ...db.zoom.sync_state[syncKey],
            status: 'ok',
            initial_backfill_completed: history.skipped ? Boolean(previousSyncState.initial_backfill_completed) : true,
            last_successful_sync_at: new Date().toISOString(),
            last_error: history.skipped ? (previousSyncState.last_error || '') : '',
            report_history_unavailable: history.skipped ? Boolean(previousSyncState.report_history_unavailable) : false,
            last_report_ranges: history.ranges || []
          };
        }
        for (const meeting of history.meetings || []) {
          const key = `${account.accountId}-${host.id || zoomUserId()}-${meeting.uuid || meeting.id || meeting.topic || 'meeting'}-${meeting.start_time || meeting.created_at || ''}`;
          if (seenMeetings.has(key)) continue;
          seenMeetings.add(key);
          const enrichedMeeting = await enrichZoomMeetingWithAttendees(auth, account, host, { ...meeting, duration: meeting.duration || meeting.total_minutes, status: meeting.status || 'past', host_id: host.id, host_label: host.label, zoom_account_id: account.accountId, zoom_account_label: account.label, zoom_list_type: 'report_history' }, leadByEmail, historyWarnings, attendeeAvailability);
          importedAttendees += enrichedMeeting.zoom_attendee_count || 0;
          importedPhones += enrichedMeeting.zoom_phone_count || 0;
          meetings.push(enrichedMeeting);
          if (meetings.length >= maxMeetings) break;
        }
      }
    }
  }
  let importedEvents = 0, updatedEvents = 0;
  for (const meeting of meetings.slice(0, maxMeetings)) {
    const meetingId = String(meeting.id || '').trim();
    const meetingUuid = String(meeting.uuid || '').trim();
    const startAt = meeting.start_time || meeting.created_at || new Date().toISOString();
    const recordForMatch = {
      name: meeting.topic || 'Zoom meeting',
      start_at: startAt,
      location: 'Zoom',
      zoom_meeting_id: meetingId,
      zoom_meeting_uuid: meetingUuid
    };
    let existing = (db.events || []).find(item => meetingId && String(item.zoom_meeting_id || '') === meetingId && (!item.zoom_account_id || !meeting.zoom_account_id || String(item.zoom_account_id) === String(meeting.zoom_account_id))) ||
      (db.events || []).find(item => meetingUuid && String(item.zoom_meeting_uuid || '') === meetingUuid && (!item.zoom_account_id || !meeting.zoom_account_id || String(item.zoom_account_id) === String(meeting.zoom_account_id))) ||
      findSpreadsheetEvent(db, recordForMatch);
    const record = {
      id: existing?.id || nextId('EV', [db.events]),
      zoom_meeting_id: meetingId,
      zoom_meeting_uuid: meetingUuid,
      zoom_host_id: meeting.host_id || '',
      zoom_host_label: meeting.host_label || '',
      zoom_account_id: meeting.zoom_account_id || existing?.zoom_account_id || '',
      zoom_account_label: meeting.zoom_account_label || existing?.zoom_account_label || '',
      zoom_list_type: meeting.zoom_list_type || existing?.zoom_list_type || '',
      name: meeting.topic || 'Zoom meeting',
      location: 'Zoom',
      start_at: startAt,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      end_at: meeting.duration ? new Date(new Date(startAt).getTime() + Number(meeting.duration || 0) * 60000).toISOString() : existing?.end_at || null,
      campaign: [meeting.zoom_account_label || 'Zoom', meeting.host_label].filter(Boolean).join(' - '),
      capacity: Math.max(Number(existing?.capacity || 0), Number(meeting.zoom_attendees?.length || 0)),
      registrations: Math.max(Number(existing?.registrations || 0), Number(existing?.attendees?.length || 0), Number(meeting.zoom_attendees?.length || 0)),
      attendance: Math.max(Number(existing?.attendance || 0), Number((meeting.zoom_attendees || []).filter(attendee => attendee.attended_at || String(attendee.status || '').toLowerCase() === 'attended').length || 0)),
      attendees: mergeEventAttendees(existing?.attendees || [], meeting.zoom_attendees || []),
      description: meeting.agenda || existing?.description || '',
      status: meeting.status || existing?.status || '',
      timezone: meeting.timezone || existing?.timezone || '',
      meeting_link: meeting.join_url || existing?.meeting_link || existing?.zoom_link || '',
      zoom_link: meeting.join_url || existing?.zoom_link || existing?.meeting_link || ''
    };
    if (existing) {
      Object.assign(existing, record);
      updatedEvents += 1;
    } else {
      db.events.push(record);
      importedEvents += 1;
    }
    if (meetingId && !(db.zoom.imported_meeting_ids || []).includes(meetingId)) {
      db.zoom.imported_meeting_ids = [...(db.zoom.imported_meeting_ids || []), meetingId];
    }
  }
  db.zoom.last_sync_at = new Date().toISOString();
  db.zoom.user_id = zoomSyncAllUsers() ? `all users across ${accounts.length} accounts` : (process.env.ZOOM_USER_ID || 'me');
  db.zoom.accounts = accounts.length;
  const reportHistorySkipped = Object.values(db.zoom.sync_state || {}).filter(item => item?.report_history_unavailable).length;
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Zoom meetings synced', 'integration', 'Zoom', `${importedEvents} created, ${updatedEvents} updated, ${meetings.length} scanned from ${hostCount} users across ${accounts.length} accounts, ${importedAttendees} attendees, ${importedPhones} phones (${meetingTypes.join(', ')}${zoomIncludeHistory() ? ', report_history' : ''})`);
  if (options.save !== false) await saveDb(db);
  return {
    imported_events: importedEvents,
    updated_events: updatedEvents,
    scanned: meetings.length,
    imported_attendees: importedAttendees,
    imported_phones: importedPhones,
    users: hostCount,
    accounts: accounts.length,
    history: zoomIncludeHistory(),
    report_history_months: zoomReportHistoryMonths(options),
    history_months: zoomReportHistoryMonths(options),
    history_from: options.history_from || process.env.ZOOM_HISTORY_FROM || '',
    history_warnings: [...new Set(historyWarnings)],
    report_history_skipped: reportHistorySkipped,
    all_users: zoomSyncAllUsers(),
    reconciliation,
    last_sync_at: db.zoom.last_sync_at
  };
}

function metaFieldMap(lead) {
  const fields = {};
  for (const field of lead.field_data || []) {
    const key = String(field.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    fields[key] = Array.isArray(field.values) ? field.values.join(', ') : String(field.values || '');
  }
  return fields;
}

function metaPick(fields, names, fallback = '') {
  for (const name of names) {
    if (fields[name]) return fields[name];
  }
  return fallback;
}

function programmeForMetaLead(db, fields) {
  return programmeForText(db, Object.values(fields).join(' '));
}

function createOrUpdateMetaLead(db, user, lead, form) {
  const fields = metaFieldMap(lead);
  const email = metaPick(fields, ['email', 'email_address', 'work_email']).toLowerCase();
  const phone = metaPick(fields, ['phone_number', 'phone', 'mobile_number', 'mobile']);
  const full = metaPick(fields, ['full_name', 'name'], '').trim();
  const first = metaPick(fields, ['first_name'], full.split(/\s+/)[0] || 'Meta');
  const last = metaPick(fields, ['last_name'], full.split(/\s+/).slice(1).join(' ') || 'Lead');
  const programme = programmeForMetaLead(db, fields);
  const result = ensureLeadRecord(db, user, {
    first_name: first,
    last_name: last,
    programme_id: programme.id,
    email: email || `${lead.id}@meta.local`,
    employer: metaPick(fields, ['company_name', 'company', 'employer']),
    phone,
    city: metaPick(fields, ['city', 'location', 'postcode']),
    stage: 'New lead',
    priority: 'P2',
    source_first_touch: 'Meta',
    source_lead_capture: 'Meta',
    contact_permission: 'Granted',
    created_at: lead.created_time || new Date().toISOString(),
    meta_lead_id: lead.id,
    meta_form_id: form.id,
    meta_form_name: form.name || ''
  }, {
    taskTitle: `Follow up Meta lead from ${form.name || 'Lead Ads'}`,
    taskKind: 'Follow-up'
  });
  return result;
}

async function importMetaLeads(db, user, maxLeads = 50) {
  if (!metaConfigured()) throw statusError(400, 'Meta credentials are not configured.');
  const auth = { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` };
  const formIds = String(process.env.META_FORM_IDS || '').split(',').map(item => item.trim()).filter(Boolean);
  let forms = formIds.map(id => ({ id, name: `Meta form ${id}` }));
  if (!forms.length) {
    const formList = await fetchJson(metaUrl(`/${process.env.META_PAGE_ID}/leadgen_forms`, { fields: 'id,name,status', limit: '100' }), { headers: auth });
    forms = formList.data || [];
  }
  let imported = 0;
  let scanned = 0;
  for (const form of forms) {
    if (scanned >= maxLeads) break;
    const limit = String(Math.max(1, Math.min(100, maxLeads - scanned)));
    const list = await fetchJson(metaUrl(`/${form.id}/leads`, { fields: 'id,created_time,field_data,ad_name,form_id,platform', limit }), { headers: auth });
    for (const lead of list.data || []) {
      scanned += 1;
      if ((db.meta.imported_lead_ids || []).includes(lead.id)) continue;
      const result = createOrUpdateMetaLead(db, user, lead, form);
      db.meta.imported_lead_ids = [...(db.meta.imported_lead_ids || []), lead.id];
      if (result.created) imported += 1;
    }
    if (!(db.meta.imported_form_ids || []).includes(form.id)) db.meta.imported_form_ids = [...(db.meta.imported_form_ids || []), form.id];
  }
  db.meta.last_sync_at = new Date().toISOString();
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Meta leads synced', 'integration', 'Meta', `${imported} new leads from ${forms.length} forms`);
  await saveDb(db);
  return { imported, scanned, forms: forms.length, reconciliation, last_sync_at: db.meta.last_sync_at };
}

function apolloOrgName(person = {}) {
  return person.organization?.name || person.account?.name || person.company || '';
}

function createOrUpdateApolloLead(db, user, person) {
  const id = String(person.id || person.person_id || '').trim();
  const email = normalizeEmail(person.email) || (id ? `${id}@apollo.local` : '');
  const first = person.first_name || person.firstName || nameParts(person.name || '', email).first_name || 'Apollo';
  const last = person.last_name || person.lastName || nameParts(person.name || '', email).last_name || 'Prospect';
  const programme = programmeForText(db, [person.title, person.headline, person.seniority, apolloOrgName(person), process.env.APOLLO_KEYWORDS].filter(Boolean).join(' '));
  return ensureLeadRecord(db, user, {
    first_name: first,
    last_name: last,
    programme_id: programme.id,
    email,
    employer: apolloOrgName(person),
    phone: person.phone || person.sanitized_phone || person.mobile_phone || '',
    city: [person.city, person.state, person.country].filter(Boolean).join(', '),
    stage: 'New lead',
    priority: 'P3',
    source_first_touch: 'Apollo',
    source_lead_capture: 'Apollo',
    contact_permission: 'Unknown',
    created_at: new Date().toISOString(),
    apollo_person_id: id
  }, {
    taskTitle: `Qualify Apollo prospect: ${first} ${last}`.trim(),
    taskKind: 'Follow-up'
  });
}

async function importApolloPeople(db, user, maxPeople = 25) {
  if (!apolloConfigured()) throw statusError(400, 'Apollo API key is not configured. Add APOLLO_API_KEY to .env.');
  db.apollo ||= { imported_person_ids: [] };
  const list = await fetchJson(apolloSearchUrl(maxPeople), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': process.env.APOLLO_API_KEY
    },
    body: '{}'
  });
  const people = list.people || list.contacts || list.results || [];
  let imported = 0, updated = 0, scanned = 0;
  for (const person of people.slice(0, maxPeople)) {
    scanned += 1;
    const id = String(person.id || person.person_id || '').trim();
    if (id && (db.apollo.imported_person_ids || []).includes(id)) continue;
    const result = createOrUpdateApolloLead(db, user, person);
    if (id) db.apollo.imported_person_ids = [...(db.apollo.imported_person_ids || []), id];
    if (result.created) imported += 1;
    else if (result.lead) updated += 1;
  }
  db.apollo.last_sync_at = new Date().toISOString();
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Apollo prospects synced', 'integration', 'Apollo', `${imported} created, ${updated} updated, ${scanned} scanned`);
  await saveDb(db);
  return { imported, updated, scanned, reconciliation, last_sync_at: db.apollo.last_sync_at };
}

function zohoSyncModules() {
  const configured = String(process.env.ZOHO_SYNC_MODULES || DEFAULT_ZOHO_MODULES.join(','))
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return configured.length ? [...new Set(configured)] : DEFAULT_ZOHO_MODULES;
}

function zohoRecordId(moduleName, record = {}) {
  return `${moduleName}:${String(record.id || record.Id || '').trim()}`;
}

function zohoRecordNameParts(record = {}) {
  const full = record.Full_Name || record.Full_Name__s || record.Name || [record.First_Name, record.Last_Name].filter(Boolean).join(' ');
  const email = normalizeEmail(record.Email || record.Email_Address || '');
  return {
    first_name: record.First_Name || nameParts(full || '', email).first_name || 'Zoho',
    last_name: record.Last_Name || nameParts(full || '', email).last_name || 'Contact'
  };
}

function zohoRecordEmail(record = {}) {
  return normalizeEmail(record.Email || record.Email_Address || record.Secondary_Email || '');
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

// One page of stored Zoho records, read straight from app_zoho_records so the UI never
// has to hold a whole module in memory.
// Zoho Contacts as a list: only the columns a list renders plus the linked lead id, never the
// raw Zoho payload. Search and paging run in PostgreSQL.
async function loadContactPage(options = {}, trace = null) {
  await perfPhase(trace, 'contacts_storage', () => ensureStorage());
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 100;
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  const cursor = decodePageCursor(options.cursor, 'contact cursor');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const search = String(options.search || '').trim().slice(0, 200);
  if (!postgresPool || !usesPostgresStorage()) return { items: [], total: includeTotal ? 0 : null, limit, offset, hasMore: false, nextOffset: offset, next_cursor: '' };
  const params = [];
  const where = [`z.module = 'Contacts'`];
  const bind = value => { params.push(value); return `$${params.length}`; };
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, char => `\\${char}`)}%`);
    where.push(`(z.title ilike ${term} or z.email ilike ${term} or z.phone ilike ${term} or z.company ilike ${term})`);
  }
  if (cursor?.key || cursor?.id) {
    const key = String(cursor.key || cursor.id || '');
    if (cursor.modified_time) {
      const modifiedParam = bind(cursor.modified_time);
      const keyParam = bind(key);
      where.push(`(z.modified_time < ${modifiedParam}::timestamptz or (z.modified_time = ${modifiedParam}::timestamptz and z.key > ${keyParam}) or z.modified_time is null)`);
    } else {
      where.push(`(z.modified_time is null and z.key > ${bind(key)})`);
    }
  }
  const whereSql = where.join(' and ');
  const [count, rows] = await Promise.all([
    includeTotal ? timedPostgresQuery(trace, 'contacts_count', `select count(*)::int as total from app_zoho_records z where ${whereSql}`, params) : Promise.resolve(null),
    // Page first, then look up the linked lead for those rows only (indexed on the Zoho key).
    timedPostgresQuery(trace, 'contacts_page',
      `with page as materialized (
         select z.key, z.zoho_id, z.title as name, z.email, z.phone, z.company, z.owner_name, z.status, z.created_time, z.modified_time
         from app_zoho_records z where ${whereSql}
         order by z.modified_time desc nulls last, z.key
         limit $${params.length + 1}
       )
       select page.*, lead.id as lead_id
       from page
       left join lateral (select l.id from app_leads l where l.data->>'zoho_record_id' = page.key and ${activeLeadCondition('l')} limit 1) lead on true
       order by page.modified_time desc nulls last, page.key`,
      [...params, limit + 1]
    )
  ]);
  return perfPhase(trace, 'mapping', async () => {
    const items = rows.rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.rows.length > limit && last?.key ? encodePageCursor({ modified_time: last.modified_time || null, key: last.key }) : '';
    return {
      items,
      total: count ? Number(count.rows[0]?.total || 0) : null,
      limit,
      offset,
      hasMore: Boolean(nextCursor),
      has_more: Boolean(nextCursor),
      nextOffset: offset + items.length,
      next_offset: offset + items.length,
      nextCursor,
      next_cursor: nextCursor
    };
  });
}

async function loadZohoRecordPage(options = {}) {
  await ensureStorage();
  const limit = Math.max(1, Math.min(Number(options.limit || 200), 500));
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const moduleName = String(options.module || '').trim();
  const search = String(options.search || '').trim().slice(0, 200);
  if (!postgresPool || !usesPostgresStorage()) {
    const db = await loadDb();
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
    postgresPool.query(`select count(*)::int as total from app_zoho_records ${whereSql}`, params),
    postgresPool.query(
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

async function zohoRecordsPayloadDbUnsafe(db = {}) {
  if (!postgresPool || !usesPostgresStorage()) return zohoRecordsPayload(db);
  await ensureZohoRecordsTable();
  const records = await postgresPool.query(
    `select data
     from app_zoho_records
     order by modified_time desc nulls last, synced_at desc nulls last, key
     limit $1`,
    [ZOHO_RECORDS_PREVIEW_LIMIT]
  );
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
  payload.limit = ZOHO_RECORDS_PREVIEW_LIMIT;
  payload.preview_limited = true;
  return payload;
}

async function zohoRecordsPayloadDb(db = {}) {
  try {
    return await promiseTimeout(
      zohoRecordsPayloadDbUnsafe(db),
      ZOHO_RECORDS_PREVIEW_TIMEOUT_MS,
      'Zoho records preview timed out while connecting to the database.'
    );
  } catch (error) {
    if (error?.code === 'KBC_TIMEOUT' || postgresConnectionLost(error)) {
      console.error(`Zoho records preview unavailable: ${error.message || error}`);
      return zohoRecordsPreviewFallback(db, error);
    }
    throw error;
  }
}

async function loadZohoWorkspaceState() {
  if (!usesPostgresStorage()) return loadDb();
  await ensureStorage();
  const result = await postgresPool.query(
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
  const programme = programmeForText(db, zohoRecordText(record));
  return ensureLeadRecord(db, user, {
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

async function fetchZohoRecordPage(db, moduleName, page = 1, maxRecords = ZOHO_SYNC_BATCH_SIZE, pageToken = '', options = {}) {
  const limit = Math.max(1, Math.min(Number(maxRecords || ZOHO_SYNC_BATCH_SIZE), 200));
  const safePage = Math.max(1, Math.min(Number(page || 1), ZOHO_SYNC_MAX_PAGES_PER_MODULE));
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
    return fetchJson(url, { headers, timeoutMs: 30000 });
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
  if (!zohoConfigured()) throw statusError(400, 'Zoho CRM credentials are not configured. Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.');
  db.zoho ||= { imported_record_ids: [] };
  const connection = zohoConnectionDiagnostics({ headers: {}, socket: {} }, db);
  console.info(`[zoho] sync connection status=${connection.status} record=${connection.connectionRecordExists} refresh=${connection.refreshTokenStored} access_expired=${connection.accessTokenExpired} accounts=${connection.accountsServer || 'missing'} api_domain=${connection.apiDomain || 'missing'}`);
  if (!connection.connected) throw statusError(401, connection.status === 'reauthorization_required' ? zohoReconnectRequiredMessage() : `Zoho CRM is not ready to sync (${connection.status}).`);
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
  const reconciliation = reconcileImportedData(db, user);
  addAudit(db, user, 'Zoho CRM synced', 'integration', 'Zoho CRM', `${imported} created, ${updated} updated, ${scanned} scanned`);
  await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, preserveApollo: true });
  return { imported, updated, scanned, modules: module_results, warnings, reconciliation, last_sync_at: db.zoho.last_sync_at };
}

function zohoSyncConnectionId() {
  return 'main';
}

function zohoSyncJobId() {
  return `zoho_sync_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function zohoSyncCursor(values = {}, batchSize = ZOHO_SYNC_BATCH_SIZE) {
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
  const batchSize = Math.max(1, Math.min(Number(state.batchSize || ZOHO_SYNC_BATCH_SIZE), 200));
  const moduleIndex = Math.max(0, Math.min(Number(state.moduleIndex || 0), modules.length));
  const moduleResults = state.moduleResults || {};
  const cursors = {};
  modules.forEach((moduleName, index) => {
    if (state.cursors?.[moduleName]) {
      cursors[moduleName] = zohoSyncCursor(state.cursors[moduleName], batchSize);
    } else if (state.cursors) {
      cursors[moduleName] = zohoSyncCursor({}, ZOHO_SYNC_BATCH_SIZE);
    } else if (index < moduleIndex) {
      // Jobs created before per-module cursors walked the modules one at a time.
      cursors[moduleName] = zohoSyncCursor({ done: true, skipped: moduleResults[moduleName]?.skipped }, batchSize);
    } else if (index === moduleIndex) {
      cursors[moduleName] = zohoSyncCursor({ page: row.current_page, pageToken: row.next_page_token }, batchSize);
    } else {
      cursors[moduleName] = zohoSyncCursor({}, ZOHO_SYNC_BATCH_SIZE);
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
  return Number.isFinite(time) ? new Date(time - ZOHO_INCREMENTAL_OVERLAP_MS).toISOString() : null;
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

async function loadZohoConnectionState(client = postgresPool) {
  await ensureIntegrationJobsTable(client);
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
    ['main', Boolean(row.demo), jsonValue(row.stages || []), jsonValue(row.sources || []), jsonValue(row.gmail || {}), jsonValue(row.eventbrite || {}), jsonValue(meta)]
  );
  dbCache = null;
}

async function latestZohoSyncJob(connectionId = zohoSyncConnectionId()) {
  await ensureStorage();
  if (!postgresPool) return null;
  await ensureIntegrationJobsTable();
  const result = await postgresPool.query(
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
  await ensureStorage();
  if (!postgresPool) return null;
  await ensureIntegrationJobsTable();
  const result = await postgresPool.query(`select * from integration_jobs where id = $1 and provider = 'zoho' limit 1`, [jobId]);
  return result.rows[0] || null;
}

async function createOrResumeZohoSyncJob(req, user, options = {}) {
  await ensureStorage();
  if (!postgresPool) throw statusError(500, 'Zoho background sync requires PostgreSQL storage.');
  await ensureIntegrationJobsTable();
  if (!zohoConfigured()) throw statusError(400, 'Zoho CRM credentials are not configured. Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.');
  const connectionId = zohoSyncConnectionId();
  const client = await postgresPool.connect();
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
      throw statusError(401, connection.status === 'reauthorization_required' ? zohoReconnectRequiredMessage() : `Zoho CRM is not ready to sync (${connection.status}).`);
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
    const batchSize = Math.max(1, Math.min(Number(options.batch_size || options.batchSize || ZOHO_SYNC_BATCH_SIZE), 200));
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
      [id, connectionId, modules[0] || null, modules.length, user.id, jsonValue(state)]
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
  if (isExcludedLeadSender(email, record.First_Name, record.Last_Name)) return { added: 0, updated: 0 };
  const names = zohoRecordNameParts(record);
  const programme = programmeForText({ programmes: [] }, zohoRecordText(record));
  const incoming = {
    first_name: names.first_name,
    last_name: names.last_name,
    full_name: `${names.first_name} ${names.last_name}`.trim(),
    programme: programme.name,
    programme_id: programme.id,
    level: programme.level,
    email: normalizeEmail(email),
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
    `select ${leadSoftDelete.enabled ? 'coalesce(m.data, l.data)' : 'l.data'} as data from app_leads l
     ${leadSoftDelete.enabled ? 'left join app_leads m on m.id = l.merged_into_id and m.deleted_at is null' : ''}
     where l.data->>'zoho_record_id' = $1
        or ($2 <> '' and lower(coalesce(l.email, '')) = $2)
     order by case when l.data->>'zoho_record_id' = $1 then 0 else 1 end
     limit 1`,
    [recordId, incoming.email]
  );
  let lead = existing.rows[0]?.data || null;
  let added = 0;
  if (lead) {
    mergeLeadData(lead, incoming);
  } else {
    let id = leadIdForEmail({ leads: [] }, incoming.email);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const taken = await client.query(`select data from app_leads where id = $1 limit 1`, [id]);
      if (!taken.rows[0] || normalizeEmail(taken.rows[0].data?.email) === incoming.email) break;
      id = emailLeadId(`${incoming.email}:${recordId}`, attempt);
    }
    lead = { ...incoming, id, person_id: id };
    addLeadSource(lead, 'Zoho CRM', { provider_id: recordId, captured_at: incoming.created_at });
    added = 1;
  }
  lead.full_name = fullName(lead);
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
    [lead.id, lead.person_id || lead.id, lead.first_name || null, lead.last_name || null, lead.email || null, lead.employer || null, lead.phone || null, lead.city || null, lead.programme_id || null, lead.programme || null, lead.level || null, lead.owner_id || null, lead.owner || null, lead.stage || null, lead.priority || null, lead.source_first_touch || null, lead.source_lead_capture || null, lead.contact_permission || null, lead.created_at || null, lead.next_action_at || null, jsonValue(lead)]
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
      [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, jsonValue(task)]
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
    if (isExcludedLeadSender(email, record.First_Name, record.Last_Name)) continue;
    const names = zohoRecordNameParts(record);
    const programme = programmeForText({ programmes: [] }, zohoRecordText(record));
    incomingRows.push({
      first_name: names.first_name,
      last_name: names.last_name,
      full_name: `${names.first_name} ${names.last_name}`.trim(),
      programme: programme.name,
      programme_id: programme.id,
      level: programme.level,
      email: normalizeEmail(email),
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
    `select ${leadSoftDelete.enabled ? 'coalesce(m.data, l.data)' : 'l.data'} as data,
       l.data->>'zoho_record_id' as matched_zoho_id, lower(l.email) as matched_email
     from app_leads l
     ${leadSoftDelete.enabled ? 'left join app_leads m on m.id = l.merged_into_id and m.deleted_at is null' : ''}
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
    for (const key of [row.matched_email, lead.email]) if (key) byEmail.set(normalizeEmail(key), lead);
  }
  const touched = new Map();
  let added = 0;
  let updated = 0;
  const usedIds = new Set(byId.keys());
  for (const incoming of incomingRows) {
    let lead = byZoho.get(incoming.zoho_record_id) || byEmail.get(incoming.email) || null;
    if (lead) {
      mergeLeadData(lead, incoming);
      updated += 1;
    } else {
      let id = leadIdForEmail({ leads: [] }, incoming.email);
      for (let attempt = 0; usedIds.has(id) && attempt < 20; attempt += 1) id = emailLeadId(`${incoming.email}:${incoming.zoho_record_id}`, attempt);
      usedIds.add(id);
      lead = { ...incoming, id, person_id: id };
      addLeadSource(lead, 'Zoho CRM', { provider_id: incoming.zoho_record_id, captured_at: incoming.created_at });
      // Later rows in this batch with the same email or record join this lead instead of
      // creating a second one.
      if (incoming.zoho_record_id) byZoho.set(incoming.zoho_record_id, lead);
      if (incoming.email) byEmail.set(incoming.email, lead);
      added += 1;
    }
    lead.full_name = fullName(lead);
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
    [jsonValue(leadRows)]
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
    [audit.id, audit.occurred_at, audit.actor, audit.action, audit.entity, audit.entity_id, jsonValue(audit)]
  );
}

function scheduleZohoSyncWorker(jobId = null, delayMs = ZOHO_SYNC_WORKER_YIELD_MS) {
  if (!postgresPool || !ZOHO_SYNC_WORKER_ENABLED) return;
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
  const result = await postgresPool.query(
    `update integration_jobs
     set locked_by = $2, locked_until = now() + ($3 || ' milliseconds')::interval, updated_at = now()
     where id = $1
       and provider = 'zoho'
       and status in ('queued', 'running')
       and (locked_by is null or locked_by = $2 or locked_until is null or locked_until < now())
     returning *`,
    [jobId, ZOHO_WORKER_ID, String(ZOHO_JOB_LEASE_MS)]
  );
  return result.rows[0] || null;
}

async function renewZohoSyncLease(ctx) {
  const result = await postgresPool.query(
    `update integration_jobs
     set locked_until = now() + ($3 || ' milliseconds')::interval
     where id = $1 and locked_by = $2
     returning status`,
    [ctx.jobId, ZOHO_WORKER_ID, String(ZOHO_JOB_LEASE_MS)]
  );
  if (result.rows[0]?.status !== 'running') ctx.stop = true;
}

async function releaseZohoSyncJob(jobId) {
  await postgresPool.query(
    `update integration_jobs set locked_by = null, locked_until = null where id = $1 and locked_by = $2`,
    [jobId, ZOHO_WORKER_ID]
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
  for (let attempt = 0; attempt < ZOHO_FETCH_ATTEMPTS; attempt += 1) {
    if (ctx.stop) throw statusError(499, 'Zoho sync stopped.');
    try {
      return await fetchZohoRecordPage(ctx.dbLike, moduleName, cursor.page, cursor.limit, cursor.pageToken || '', { modifiedSince: cursor.modifiedSince || '' });
    } catch (error) {
      lastError = error;
      const status = Number(error.status || 0);
      if (![429, 500, 502, 503, 504].includes(status) || attempt === ZOHO_FETCH_ATTEMPTS - 1) throw error;
      await wait(status === 429 ? 30000 * (attempt + 1) : 3000 * (attempt + 1));
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
    upsertZohoRecordRows(postgresPool, rows),
    leadModule ? upsertZohoLeadsFromRecords(postgresPool, ctx.user, moduleName, records) : Promise.resolve({ added: 0, updated: 0, failed: 0 })
  ]);
  dbCache = null;
  return leads;
}

async function persistZohoTokenIfChanged(ctx) {
  const zoho = ctx.dbLike.zoho || {};
  if ((zoho.access_token || '') === ctx.savedAccessToken) return;
  ctx.savedAccessToken = zoho.access_token || '';
  const latest = await loadZohoConnectionState();
  await saveZohoConnectionState(postgresPool, { ...latest, ...zohoNewerTokenFields(zoho, latest) });
}

function zohoNewerTokenFields(candidate = {}, current = {}) {
  if (!candidate.access_token || Number(candidate.expires_at || 0) <= Number(current.expires_at || 0)) return {};
  return { access_token: candidate.access_token, expires_at: candidate.expires_at, api_domain: candidate.api_domain || current.api_domain };
}

// One progress write per page: counters, this module's cursor and results, and the lease.
async function recordZohoModuleProgress(ctx, moduleName, cursor, results, delta, options = {}) {
  const result = await postgresPool.query(
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
      ZOHO_WORKER_ID,
      moduleName,
      cursor.page,
      cursor.pageToken || null,
      Number(delta.scanned || 0),
      Number(delta.added || 0),
      Number(delta.updated || 0),
      Number(delta.failed || 0),
      options.moduleFinished ? 1 : 0,
      jsonValue(cursor),
      jsonValue(results),
      jsonValue(options.warning ? [options.warning] : []),
      String(ZOHO_JOB_LEASE_MS)
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
    if (more && next.page > ZOHO_SYNC_MAX_PAGES_PER_MODULE) throw statusError(500, `Zoho pagination safety limit reached for ${moduleName}.`);
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
  const current = await postgresPool.query(
    `select * from integration_jobs where id = $1 and locked_by = $2 and status = 'running'`,
    [ctx.jobId, ZOHO_WORKER_ID]
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
  await saveZohoConnectionState(postgresPool, {
    ...latest,
    ...zohoNewerTokenFields(ctx.dbLike.zoho, latest),
    sync_marks: marks,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    connected: true,
    reauthorization_required: false
  });
  await insertZohoSyncAudit(postgresPool, `${state.mode} sync: ${Number(row.records_scanned || 0)} scanned, ${Number(row.records_added || 0)} created, ${Number(row.records_updated || 0)} updated`);
  await postgresPool.query(
    `update integration_jobs
     set status = 'completed', completed_at = now(), current_module = null, next_page_token = null,
         last_progress_at = now(), updated_at = now()
     where id = $1 and locked_by = $2 and status = 'running'`,
    [ctx.jobId, ZOHO_WORKER_ID]
  );
}

async function runZohoSyncWorker(jobId = null) {
  await ensureStorage();
  if (!postgresPool) return;
  await ensureIntegrationJobsTable();
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
      if (current && ['queued', 'running'].includes(current.status)) retryDelay = ZOHO_JOB_LEASE_MS;
      return;
    }
    if (job.retry_after_at && new Date(job.retry_after_at).getTime() > Date.now()) {
      retryDelay = Math.max(1000, new Date(job.retry_after_at).getTime() - Date.now());
      return;
    }
    const state = zohoSyncState(job);
    await postgresPool.query(
      `update integration_jobs
       set status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1,
           last_error = null, retry_after_at = null, state = $3::jsonb, updated_at = now()
       where id = $1 and locked_by = $2`,
      [target, ZOHO_WORKER_ID, jsonValue(state)]
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
    const runners = Array.from({ length: Math.min(ZOHO_SYNC_MODULE_CONCURRENCY, queue.length) }, async () => {
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
        await postgresPool.query(
          `update integration_jobs
           set status = 'queued', retry_after_at = now() + ($2 || ' milliseconds')::interval,
               last_error = $3, updated_at = now()
           where id = $1 and provider = 'zoho'`,
          [target, String(retryDelay), safeMessage]
        );
      } else if (/oauth|token|reauthorization|refresh/i.test(safeMessage)) {
        await postgresPool.query(`update integration_jobs set status = 'failed', last_error = $2, completed_at = now(), updated_at = now() where id = $1 and provider = 'zoho'`, [target, zohoReconnectRequiredMessage()]);
      } else {
        await postgresPool.query(`update integration_jobs set status = 'failed', last_error = $2, completed_at = now(), updated_at = now() where id = $1 and provider = 'zoho'`, [target, safeMessage]);
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
  await ensureStorage();
  if (!postgresPool) return;
  await ensureIntegrationJobsTable();
  const active = await postgresPool.query(
    `select id from integration_jobs
     where provider = 'zoho'
       and type = 'crm_sync'
       and status in ('queued', 'running')
     order by updated_at desc
     limit $1`,
    [ZOHO_SYNC_CONCURRENCY]
  );
  for (const row of active.rows) scheduleZohoSyncWorker(row.id, 1000);
}

// After the first full import, keep app_zoho_records current with small incremental runs.
function scheduleZohoAutoSync(delayMs = ZOHO_AUTO_SYNC_INTERVAL_MS) {
  if (!ZOHO_AUTO_SYNC_ENABLED || !usesPostgresStorage()) return;
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
  await ensureStorage();
  if (!postgresPool) return;
  const zoho = await loadZohoConnectionState();
  // Only incremental runs are automatic; the first full import is started from the UI.
  if (!Object.keys(zoho.sync_marks || {}).length) return;
  await createOrResumeZohoSyncJob({ headers: {}, socket: {} }, { id: 'system', name: 'Zoho Auto Sync' }, { mode: 'incremental' });
}

async function cancelZohoSyncJob(jobId) {
  await ensureStorage();
  if (!postgresPool) throw statusError(500, 'Zoho background sync requires PostgreSQL storage.');
  await ensureIntegrationJobsTable();
  const result = await postgresPool.query(
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

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index).trim()), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) reject(statusError(413, 'Request is too large.'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        // Handlers read fields off the body, so null and bare values count as an empty one.
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(statusError(400, 'Invalid JSON body.'));
      }
    });
  });
}

function createPerfTrace(route, startedAt = performance.now()) {
  return {
    route,
    started_at: startedAt,
    stages: [],
    counters: {},
    bytes: 0,
    status: 0
  };
}

function perfAdd(trace, name, ms, meta = {}) {
  if (!trace) return;
  const stage = { name, ms, ...meta };
  if (stage.start_ms === undefined) {
    stage.start_ms = Number(Math.max(0, performance.now() - trace.started_at - Number(ms || 0)).toFixed(1));
  }
  trace.stages.push(stage);
}

async function perfPhase(trace, name, fn, meta = {}) {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    perfAdd(trace, name, performance.now() - started, meta);
  }
}

function perfCount(trace, name, by = 1) {
  if (!trace) return;
  trace.counters[name] = Number(trace.counters[name] || 0) + by;
}

async function timedPostgresQuery(trace, label, sql, params = [], attempts = 2) {
  if (!trace) return postgresPool.query(sql, params);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const acquireStarted = performance.now();
    let client = null;
    const beforeAcquire = postgresPoolStats();
    try {
      client = await postgresPool.connect();
      perfAdd(trace, `${label}_pool_acquire`, performance.now() - acquireStarted, {
        pool_before: beforeAcquire,
        pool_after: postgresPoolStats(),
        query_name: `${label}_pool_acquire`
      });
      const queryStarted = performance.now();
      const result = await client.query(sql, params);
      perfAdd(trace, `${label}_query`, performance.now() - queryStarted, {
        rows: result.rowCount ?? result.rows?.length ?? 0,
        sql: sqlSummary(sql),
        sql_full: sql,
        params,
        query_name: label
      });
      perfCount(trace, 'postgres_queries');
      return result;
    } catch (error) {
      lastError = error;
      perfAdd(trace, `${label}_error`, performance.now() - acquireStarted);
      if (!postgresConnectionLost(error) || attempt >= attempts - 1) throw error;
      console.error(`Postgres query connection lost; reconnecting: ${error.message || error}`);
      await resetPostgresPool();
      await getPostgresPool();
    } finally {
      if (client) {
        try {
          client.release();
        } catch {}
      }
    }
  }
  throw lastError;
}

async function timedPostgresQueryWithStatementTimeout(trace, label, sql, params = [], timeoutMs = 5000, attempts = 2) {
  if (!trace || !Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) return timedPostgresQuery(trace, label, sql, params, attempts);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const acquireStarted = performance.now();
    let client = null;
    const beforeAcquire = postgresPoolStats();
    try {
      client = await postgresPool.connect();
      perfAdd(trace, `${label}_pool_acquire`, performance.now() - acquireStarted, {
        pool_before: beforeAcquire,
        pool_after: postgresPoolStats(),
        query_name: `${label}_pool_acquire`
      });
      const queryStarted = performance.now();
      await client.query('begin');
      await client.query(`set local statement_timeout = ${Math.round(Number(timeoutMs))}`);
      const result = await client.query({
        text: sql,
        values: params,
        query_timeout: Math.round(Number(timeoutMs) + 1000)
      });
      await client.query('commit');
      perfAdd(trace, `${label}_query`, performance.now() - queryStarted, {
        rows: result.rowCount ?? result.rows?.length ?? 0,
        sql: sqlSummary(sql),
        sql_full: sql,
        params,
        statement_timeout_ms: Math.round(Number(timeoutMs)),
        query_name: label
      });
      perfCount(trace, 'postgres_queries');
      return result;
    } catch (error) {
      lastError = error;
      try { if (client) await client.query('rollback'); } catch {}
      perfAdd(trace, `${label}_error`, performance.now() - acquireStarted, {
        sql: sqlSummary(sql),
        statement_timeout_ms: Math.round(Number(timeoutMs)),
        query_name: label
      });
      if (!postgresConnectionLost(error) || attempt >= attempts - 1) throw error;
      console.error(`Postgres query connection lost; reconnecting: ${error.message || error}`);
      await resetPostgresPool();
      await getPostgresPool();
    } finally {
      if (client) {
        try {
          client.release();
        } catch {}
      }
    }
  }
  throw lastError;
}

function perfDuration(trace, name) {
  if (!trace) return 0;
  return trace.stages
    .filter(stage => stage.name === name || stage.name.startsWith(`${name}_`))
    .reduce((sum, stage) => sum + Number(stage.ms || 0), 0);
}

function perfDurationEnding(trace, suffix) {
  if (!trace) return 0;
  return trace.stages
    .filter(stage => stage.name.endsWith(suffix))
    .reduce((sum, stage) => sum + Number(stage.ms || 0), 0);
}

function perfDurationPrefix(trace, prefix) {
  if (!trace) return 0;
  return trace.stages
    .filter(stage => stage.name === prefix || stage.name.startsWith(prefix))
    .reduce((sum, stage) => sum + Number(stage.ms || 0), 0);
}

function sqlSummary(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

async function tracedPostgresPoolQuery(trace, label, sql, params = []) {
  const started = performance.now();
  try {
    const result = await postgresPool.query(sql, params);
    perfAdd(trace, `${label}_query`, performance.now() - started, {
      rows: result.rowCount ?? result.rows?.length ?? 0,
      sql: sqlSummary(sql),
      sql_full: sql,
      params,
      query_name: label
    });
    perfCount(trace, 'postgres_queries');
    return result;
  } catch (error) {
    perfAdd(trace, `${label}_error`, performance.now() - started, {
      sql: sqlSummary(sql),
      query_name: label
    });
    throw error;
  }
}

function bootstrapQueryBreakdown(trace) {
  if (!trace) return [];
  return trace.stages
    .filter(stage => stage.name.endsWith('_query'))
    .map(stage => ({
      query_name: stage.query_name || stage.name.replace(/_query$/, ''),
      start_ms: Number(Number(stage.start_ms || 0).toFixed(1)),
      duration_ms: Number(Number(stage.ms || 0).toFixed(1)),
      returned_rows: Number(stage.rows || 0),
      sql: stage.sql || ''
    }));
}

function perfCounters(trace) {
  return trace ? { ...trace.counters } : {};
}

function eventLoopDelayMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1e18) return 0;
  return Number((number / 1e6).toFixed(1));
}

function eventLoopSnapshot(reset = false) {
  const utilization = perfHooksPerformance.eventLoopUtilization && eventLoopUtilizationBaseline
    ? perfHooksPerformance.eventLoopUtilization(eventLoopUtilizationBaseline)
    : null;
  const snapshot = {
    delay_mean_ms: eventLoopDelayMs(eventLoopDelayMonitor.mean),
    delay_p95_ms: eventLoopDelayMs(eventLoopDelayMonitor.percentile(95)),
    delay_p99_ms: eventLoopDelayMs(eventLoopDelayMonitor.percentile(99)),
    delay_max_ms: eventLoopDelayMs(eventLoopDelayMonitor.max),
    utilization: utilization ? Number(utilization.utilization.toFixed(4)) : null
  };
  if (reset) {
    eventLoopDelayMonitor.reset();
    if (perfHooksPerformance.eventLoopUtilization) {
      eventLoopUtilizationBaseline = perfHooksPerformance.eventLoopUtilization();
    }
  }
  return snapshot;
}

function formatServerTiming(trace) {
  if (!trace) return '';
  const keys = ['pre_handler', 'middleware', 'body_parse', 'middleware_cookie_gate', 'cookie_parse', 'auth_storage', 'auth_session_lookup', 'auth_session_join', 'auth_session_cache', 'auth_session_touch', 'bootstrap_storage', 'bootstrap_db', 'emails_handler_start', 'emails_before_sql', 'emails_after_sql', 'emails_storage', 'gmail_api_calls', 'monitoring_storage', 'external_api', 'leads_sql', 'mapping', 'permissions', 'serialize', 'response_headers', 'response_write', 'response_end'];
  const parts = [];
  const dbAcquire = perfDurationEnding(trace, '_pool_acquire');
  const dbQuery = perfDurationEnding(trace, '_query');
  const mainQuery = trace.stages
    .filter(stage => /_page_query$|_payload_query$/.test(stage.name) || stage.name === 'monitoring_main_query')
    .reduce((sum, stage) => sum + Number(stage.ms || 0), 0);
  const countQuery = trace.stages
    .filter(stage => /_count_query$|_counts_query$/.test(stage.name))
    .reduce((sum, stage) => sum + Number(stage.ms || 0), 0);
  const secondaryQuery = Math.max(0, dbQuery - mainQuery - countQuery);
  const auth = perfDurationPrefix(trace, 'auth_') + perfDuration(trace, 'cookie_parse');
  const query = dbQuery;
  const db = dbAcquire + dbQuery;
  const leadsQuery = perfDuration(trace, 'leads_sql');
  const snapshotRead = perfDuration(trace, 'monitoring_snapshot_read_query');
  const snapshotAgeStage = trace.stages.find(stage => stage.name === 'snapshot_age');
  const snapshotMemoryCache = trace.stages.find(stage => stage.name === 'monitoring_snapshot_memory_cache');
  const snapshotReadJoin = trace.stages.find(stage => stage.name === 'monitoring_snapshot_read_join');
  const emailPathStage = trace.stages.find(stage => stage.name === 'email_path');
  const gmailApiCallsStage = trace.stages.find(stage => stage.name === 'gmail_api_calls');
  if (auth > 0) parts.push(`auth;dur=${auth.toFixed(1)}`);
  if (db > 0) parts.push(`db;dur=${db.toFixed(1)}`);
  if (query > 0) parts.push(`query;dur=${query.toFixed(1)}`);
  if (snapshotRead > 0) parts.push(`snapshot-read;dur=${snapshotRead.toFixed(1)}`);
  if (snapshotMemoryCache) parts.push(`monitoring-snapshot-memory-cache;dur=0`);
  if (snapshotReadJoin) parts.push(`monitoring-snapshot-read-join;dur=0`);
  if (snapshotAgeStage) parts.push(`snapshot-age;dur=0;desc="${Math.round(Number(snapshotAgeStage.age_ms || 0))}ms-${snapshotAgeStage.state || 'UNKNOWN'}"`);
  if (emailPathStage) parts.push(`email-path;dur=0;desc="${String(emailPathStage.path || 'unknown').replace(/"/g, '')}"`);
  if (gmailApiCallsStage) parts.push(`gmail-api-calls;dur=0;desc="${Number(gmailApiCallsStage.calls || 0)}"`);
  if (mainQuery > 0) parts.push(`main-query;dur=${mainQuery.toFixed(1)}`);
  if (countQuery > 0) parts.push(`count-query;dur=${countQuery.toFixed(1)}`);
  if (secondaryQuery > 0) parts.push(`secondary-query;dur=${secondaryQuery.toFixed(1)}`);
  if (leadsQuery > 0) parts.push(`leads-query;dur=${leadsQuery.toFixed(1)}`);
  if (dbAcquire > 0) parts.push(`db-acquire;dur=${dbAcquire.toFixed(1)}`);
  if (dbQuery > 0) parts.push(`db-query;dur=${dbQuery.toFixed(1)}`);
  for (const key of keys) {
    const value = perfDuration(trace, key);
    if (value > 0) parts.push(`${key.replace(/_/g, '-')};dur=${value.toFixed(1)}`);
  }
  for (const stage of trace.stages) {
    if (!/_query$|_pool_acquire$/.test(stage.name)) continue;
    const safeName = stage.name.replace(/_/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase();
    parts.push(`${safeName};dur=${Number(stage.ms || 0).toFixed(1)}`);
  }
  const total = performance.now() - trace.started_at;
  parts.push(`node-total;dur=${total.toFixed(1)}`);
  parts.push(`total;dur=${total.toFixed(1)}`);
  return parts.join(', ');
}

function logPerfTrace(trace) {
  if (!API_PERF_TRACE_ENABLED || !trace) return;
  const total = performance.now() - trace.started_at;
  const stages = trace.stages.map(stage => {
    const meta = stage.rows !== undefined ? ` rows=${stage.rows}` : '';
    const pool = stage.pool_before ? ` pool=${stage.pool_before.totalCount}/${stage.pool_before.idleCount}/${stage.pool_before.waitingCount}->${stage.pool_after?.totalCount}/${stage.pool_after?.idleCount}/${stage.pool_after?.waitingCount}` : '';
    return `${stage.name}=${stage.ms.toFixed(1)}ms${meta}${pool}`;
  }).join(' ');
  const queryCount = trace.counters.postgres_queries || 0;
  const pool = postgresPoolStats();
  const loop = eventLoopSnapshot(false);
  console.log(`[PERF] ${trace.route} status=${trace.status || 0} total=${total.toFixed(1)}ms bytes=${trace.bytes || 0} pg_queries=${queryCount} pool=${pool.totalCount}/${pool.idleCount}/${pool.waitingCount} loop_p95=${loop.delay_p95_ms}ms loop_p99=${loop.delay_p99_ms}ms loop_max=${loop.delay_max_ms}ms loop_util=${loop.utilization} ${stages}`);
}

// List endpoints return tens to hundreds of KB of JSON, which gzip shrinks roughly 8x.
const JSON_GZIP_MIN_BYTES = 8 * 1024;

function sendJson(res, value, status = 200, headers = {}, trace = null) {
  const serializeStarted = performance.now();
  const body = JSON.stringify(value);
  perfAdd(trace, 'serialize', performance.now() - serializeStarted, { bytes: Buffer.byteLength(body) });
  if (trace) {
    trace.bytes = Buffer.byteLength(body);
    trace.status = status;
    headers = { ...headers, 'Server-Timing': formatServerTiming(trace) };
  }
  const acceptsGzip = /\bgzip\b/i.test(String(res.req?.headers?.['accept-encoding'] || ''));
  const writeStarted = performance.now();
  if (acceptsGzip && body.length >= JSON_GZIP_MIN_BYTES) {
    perfAdd(trace, 'response_headers', 0);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ...headers });
    res.end(zlib.gzipSync(body));
    perfAdd(trace, 'response_write', performance.now() - writeStarted, { gzip: true });
    perfAdd(trace, 'response_end', Math.max(0, performance.now() - trace?.started_at || 0));
    logPerfTrace(trace);
    return;
  }
  perfAdd(trace, 'response_headers', 0);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
  perfAdd(trace, 'response_write', performance.now() - writeStarted, { gzip: false });
  perfAdd(trace, 'response_end', Math.max(0, performance.now() - trace?.started_at || 0));
  logPerfTrace(trace);
}

function requestPath(req) {
  try { return new URL(req.url, `http://${req.headers.host}`).pathname; }
  catch { return req.url || ''; }
}

function sessionCookie(req, sid, maxAge = SESSION_TTL / 1000) {
  const secure = requestIsSecure(req) ? '; Secure' : '';
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function recordApiError(req, error) {
  const status = error.status || 500;
  monitoringState.api_errors.unshift({
    occurred_at: new Date().toISOString(),
    route: requestPath(req),
    method: req.method,
    status,
    message: error.message || 'Server error.'
  });
  monitoringState.api_errors = monitoringState.api_errors.slice(0, 25);
}

function recordApiTiming(req, status, startedAt) {
  const durationMs = performance.now() - startedAt;
  const route = requestPath(req);
  const timing = {
    occurred_at: new Date().toISOString(),
    route,
    method: req.method,
    status,
    duration_ms: Number(durationMs.toFixed(1))
  };
  monitoringState.api_timings.unshift(timing);
  monitoringState.api_timings = monitoringState.api_timings.slice(0, 50);
  if (durationMs >= API_TIMING_WARN_MS) {
    console.warn(`[timing] ${req.method} ${route} ${status} ${durationMs.toFixed(1)}ms`);
  }
}

// Only browser assets that live in the web root are public.
// Secrets and internal files (.env, .env.hostinger), data/scripts/sql/src/dist folders,
// deploy snapshots, backups and archives are never served, even though they sit next to
// the frontend files on disk.
const PUBLIC_STATIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.webmanifest', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);
const PUBLIC_STATIC_BLOCKED_NAMES = new Set(['server.js']);
const PUBLIC_STATIC_DEFAULT_FILE = 'index.html';
const PUBLIC_ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);
const PUBLIC_ASSET_PREFIX = 'assets/images/';

function publicStaticFile(pathname) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(pathname || ''));
  } catch {
    return null;
  }
  if (!decoded || decoded === '/') return PUBLIC_STATIC_DEFAULT_FILE;
  if (!decoded.startsWith('/')) return null;
  const segments = decoded.slice(1).split('/');
  if (segments.length > 1) {
    const assetName = segments.join('/');
    if (assetName.startsWith(PUBLIC_ASSET_PREFIX) && !segments.some(segment => !segment || segment.startsWith('.') || segment.includes('\\'))) {
      const ext = path.extname(assetName).toLowerCase();
      return PUBLIC_ASSET_EXTENSIONS.has(ext) ? assetName : null;
    }
    return null;
  }
  const name = segments[0];
  if (!name || name.startsWith('.') || PUBLIC_STATIC_BLOCKED_NAMES.has(name.toLowerCase())) return null;
  const ext = path.extname(name).toLowerCase();
  if (!PUBLIC_STATIC_EXTENSIONS.has(ext)) return null;
  return name;
}

// Sent with every response. HTML pages also get the Content-Security-Policy in serveStatic.
function applySecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (requestIsSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

// Pages run their own script files only. An inline script (offline.html has one) is allowed by
// its hash, taken from the HTML being sent so it always matches. Browsers hash the script text
// with LF line endings, whatever the file on disk uses.
function contentSecurityPolicy(html) {
  const inlineScripts = [...String(html).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...inlineScripts].join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

function serveStatic(req, res) {
  applySecurityHeaders(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, { error: 'Not found.' }, 404);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = publicStaticFile(url.pathname);
  if (!name) return sendJson(res, { error: 'Not found.' }, 404);
  const filePath = path.resolve(ROOT, name);
  const rootPath = path.resolve(ROOT);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) return sendJson(res, { error: 'Not found.' }, 404);
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, { error: 'Not found.' }, 404);
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': mime[ext] || 'application/octet-stream' };
    if (ext === '.html') headers['Content-Security-Policy'] = contentSecurityPolicy(content.toString('utf8'));
    res.writeHead(200, headers);
    res.end(content);
  });
}

// Errors raised on purpose (statusError) and plain messages are shown to the user. Database,
// network and programming errors describe the inside of the server, so the caller gets a
// generic message and the real one goes to the log.
function isInternalError(error) {
  if (!error || error.status) return false;
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError || error instanceof SyntaxError) return true;
  return Boolean(error.code || error.errno || error.syscall || error.severity);
}

function publicErrorMessage(error) {
  return isInternalError(error) ? 'Server error. Please try again.' : error?.message || 'Server error.';
}

async function handleApi(req, res) {
  applySecurityHeaders(req, res);
  // API answers hold workspace data; a handler that wants caching sets its own header.
  res.setHeader('Cache-Control', 'no-store');
  const handlerEntry = performance.now();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;
  const method = req.method;
  const traceableRoutes = new Set(['/api/health', '/api/bootstrap', '/api/leads', '/api/tasks', '/api/emails', '/api/events', '/api/zoom/events', '/api/applications', '/api/meetings', '/api/activity', '/api/contacts', '/api/monitoring', '/api/dashboard/monitoring', '/api/debug/db-ping', '/api/debug/ping']);
  const requestEntry = Number(req.__requestEntryAt || handlerEntry);
  const trace = method === 'GET' && traceableRoutes.has(route) ? createPerfTrace(route, requestEntry) : null;
  req.__perfTrace = trace;
  perfAdd(trace, 'pre_handler', Math.max(0, handlerEntry - requestEntry));
  const middlewareStarted = performance.now();
  let middlewareRecorded = false;
  const finishMiddleware = () => {
    if (middlewareRecorded) return;
    middlewareRecorded = true;
    perfAdd(trace, 'middleware', Math.max(0, performance.now() - middlewareStarted));
  };
  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await perfPhase(trace, 'body_parse', () => readBody(req)) : {};

  if (route === '/api/health' && method === 'GET') {
    finishMiddleware();
    return sendJson(res, { ok: true }, 200, {}, trace);
  }
  if (route === '/api/debug/ping' && method === 'GET') {
    if (!API_DEBUG_ENDPOINTS_ENABLED) throw statusError(404, 'API route not found.');
    finishMiddleware();
    return sendJson(res, { ok: true }, 200, {}, trace);
  }
  if (route === '/api/signup') throw statusError(404, 'Sign up is disabled. Ask the developer to invite your account.');
  const publicRoutes = new Set(['/api/login', '/api/password/forgot', '/api/password/reset', '/api/integrations/gmail/callback', '/api/integrations/eventbrite/callback', '/api/integrations/zoho/callback']);
  if (!publicRoutes.has(route)) {
    const cookieGateStarted = performance.now();
    const hasSessionCookie = Boolean(parseCookies(req).sid);
    perfAdd(trace, 'middleware_cookie_gate', performance.now() - cookieGateStarted);
    if (!hasSessionCookie) throw statusError(401, 'Sign in to continue.');
  }
  finishMiddleware();
  let lightweightMatch = null;
  if (route === '/api/login' && method === 'POST') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) throw statusError(400, 'Email and password are required.');
    const loginLimits = loginThrottleLimits(req, email);
    assertAuthThrottle(loginLimits);
    const publishedDefault = password === LEGACY_DEFAULT_ADMIN_PASSWORD;
    let user = publishedDefault ? null : await findLoginUser(email);
    if (!publishedDefault && (!user || !verifyPassword(password, user.password_hash))) {
      user = await forceConfiguredDeveloperLogin(email, password);
    }
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordAuthThrottle(loginLimits);
      if (isDeveloperEmail(email) && !developerPasswordConfigured()) {
        throw statusError(500, 'Developer password is not configured on this deployment. Add DEV_PANEL_PASSWORD and redeploy.');
      }
      throw statusError(401, 'Email or password is incorrect.');
    }
    authThrottle.delete(loginLimits[0][0]);
    const sid = await createSession(user);
    sendJson(res, { ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(req, sid) });
    recordPostgresLogin(user, req).catch(error => console.error(`Login audit failed: ${error.message || error}`));
    return;
  }
  if (route === '/api/bootstrap' && method === 'GET') {
    const timings = {};
    const user = await currentSessionUser(req, trace);
    const payload = await loadBootstrapPayload(user, timings, trace);
    if (url.searchParams.get('debug_timing') === 'true') {
      requireDeveloperAccess(req, user);
      payload._debug = {
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          pre_handler_ms: Number(perfDuration(trace, 'pre_handler').toFixed(1)),
          middleware_ms: Number(perfDuration(trace, 'middleware').toFixed(1)),
          auth_ms: Number((perfDuration(trace, 'auth_session_lookup') + perfDuration(trace, 'auth_session_join') + perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          db_query_ms: Number(perfDurationEnding(trace, '_query').toFixed(1)),
          serialize_ms: 0
        },
        counters: perfCounters(trace),
        queries: bootstrapQueryBreakdown(trace),
        event_loop: eventLoopSnapshot(false)
      };
    }
    // Visible in the browser's Network > Timing panel.
    return sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/debug/db-ping' && method === 'GET') {
    const user = await currentSessionUser(req, trace);
    requireDeveloperAccess(req, user);
    await perfPhase(trace, 'debug_storage', () => ensureStorage(trace));
    if (!postgresPool || !usesPostgresStorage()) throw statusError(400, 'PostgreSQL storage is not configured.');
    const poolBefore = postgresPoolStats();
    const result = await timedPostgresQuery(trace, 'debug_select1', 'select 1 as ok');
    const poolAfter = postgresPoolStats();
    return sendJson(res, {
      ok: result.rows[0]?.ok === 1,
      database: databaseSafeMetadata(),
      pool_before: poolBefore,
      pool_after: poolAfter,
      timings: {
        node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
        pre_handler_ms: Number(perfDuration(trace, 'pre_handler').toFixed(1)),
        middleware_ms: Number(perfDuration(trace, 'middleware').toFixed(1)),
        auth_ms: Number((perfDuration(trace, 'auth_session_lookup') + perfDuration(trace, 'auth_session_join') + perfDuration(trace, 'auth_session_cache')).toFixed(1)),
        db_acquire_ms: Number(perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
        db_query_ms: Number(perfDurationEnding(trace, '_query').toFixed(1)),
        total_ms: Number((performance.now() - trace.started_at).toFixed(1))
      },
      event_loop: eventLoopSnapshot(url.searchParams.get('reset_event_loop') === 'true')
    }, 200, {}, trace);
  }
  if (route === '/api/dashboard/summary' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardCockpitSummaryDb(parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/admin-overview' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardAdminOverviewDb(parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/totals' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadDashboardTotalsDb({ today_start: url.searchParams.get('today_start'), tomorrow_start: url.searchParams.get('tomorrow_start') }));
  }
  if ((route === '/api/dashboard/monitoring' || route === '/api/monitoring') && method === 'GET') {
    try {
      await currentSessionUser(req, trace);
      return sendJson(res, await loadDashboardMonitoringDb({ today_start: url.searchParams.get('today_start'), tomorrow_start: url.searchParams.get('tomorrow_start') }, trace), 200, {}, trace);
    } catch (error) {
      if (error.status === 400) throw error;
      console.error(`[monitoring] request failed ${error.query_name || ''}: ${error.stack || error.message || error}`);
      return sendJson(res, {
        error: error.code || 'monitoring_query_failed',
        message: 'Unable to load monitoring data.'
      }, error.status || 500, {}, trace);
    }
  }
  // Recent activity (audit trail), newest first; same data as the Today widget.
  if (route === '/api/activity' && method === 'GET') {
    const user = await currentSessionUser(req, trace);
    return sendJson(res, await loadDashboardActivityDb(parseDashboardFilters(url, user), url.searchParams.get('limit') || 20), 200, {}, trace);
  }
  if (route === '/api/contacts' && method === 'GET') {
    await currentSessionUser(req, trace);
    return sendJson(res, await loadContactPage({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      cursor: url.searchParams.get('cursor'),
      search: url.searchParams.get('search'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/dashboard/pipeline' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardPipelineDb(parseDashboardFilters(url, user)));
  }
  if (route === '/api/dashboard/my-work' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardMyWorkDb(parseDashboardFilters(url, user), user));
  }
  if (route === '/api/dashboard/priority-leads' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardPriorityLeadsDb(parseDashboardFilters(url, user)));
  }
  if (route === '/api/dashboard/source-performance' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardSourcePerformanceDb(parseDashboardFilters(url, user)));
  }
  if (route === '/api/dashboard/integrations' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardIntegrationsDb(user));
  }
  if (route === '/api/dashboard/activity' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardActivityDb(parseDashboardFilters(url, user), url.searchParams.get('limit')));
  }
  if (route === '/api/dashboard/search' && method === 'GET') {
    const user = await currentSessionUser(req);
    return sendJson(res, await loadDashboardSearchDb(url.searchParams.get('q'), user));
  }
  if (route === '/api/leads' && method === 'GET') {
    const user = await currentSessionUser(req, trace);
    const params = Object.fromEntries(['cursor', 'limit', 'search', 'stage', 'owner_id', 'programme_id', 'lead_source', 'created_from', 'created_to', 'sort', 'dir', 'include_total']
      .map(name => [name, url.searchParams.get(name)]));
    const payload = await loadLeadPage(params, trace);
    if (url.searchParams.get('debug_timing') === 'true') {
      requireDeveloperAccess(req, user);
      payload._debug = {
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          pre_handler_ms: Number(perfDuration(trace, 'pre_handler').toFixed(1)),
          middleware_ms: Number(perfDuration(trace, 'middleware').toFixed(1)),
          auth_ms: Number((perfDuration(trace, 'auth_session_lookup') + perfDuration(trace, 'auth_session_join') + perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          leads_query_ms: Number(perfDuration(trace, 'leads_sql').toFixed(1)),
          serialize_ms: 0
        },
        counters: perfCounters(trace),
        queries: bootstrapQueryBreakdown(trace),
        event_loop: eventLoopSnapshot(false)
      };
    }
    return sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/tasks' && method === 'GET') {
    await currentSessionUser(req, trace);
    const params = Object.fromEntries(['limit', 'status', 'offset', 'cursor', 'today_start', 'tomorrow_start', 'bucket', 'search', 'owner_id', 'lead_id', 'due_before', 'due_after', 'include_counts']
      .map(name => [name, url.searchParams.get(name)]));
    return sendJson(res, await loadTaskPage(params, trace), 200, {}, trace);
  }
  lightweightMatch = route.match(/^\/api\/events\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await currentSessionUser(req, trace);
    return sendJson(res, await loadEventDetailDb(decodeURIComponent(lightweightMatch[1]), trace), 200, {}, trace);
  }
  if (route === '/api/events' && method === 'GET') {
    await currentSessionUser(req, trace);
    return sendJson(res, await loadEventPage({
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      upcoming: url.searchParams.get('upcoming'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/developer/config' && method === 'GET') {
    const user = await currentSessionUser(req);
    requireDeveloperAccess(req, user);
    return sendJson(res, developerConfig(req, await loadDeveloperConfigDb()));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await currentSessionUser(req, trace);
    return sendJson(res, await loadEmailDetail(lightweightMatch[1]), 200, {}, trace);
  }
  if (route === '/api/emails' && method === 'GET') {
    const emailsHandlerStarted = performance.now();
    const externalFetchBefore = { ...externalFetchCounters };
    perfAdd(trace, 'emails_handler_start', 0, { pool: postgresPoolStats() });
    const user = await currentSessionUser(req, trace);
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
    perfAdd(trace, 'emails_before_sql', performance.now() - emailsHandlerStarted, {
      pool: postgresPoolStats(),
      request: safeEmailRequestParams(params)
    });
    const payload = await loadEmailPage(params, trace);
    perfAdd(trace, 'emails_after_sql', performance.now() - emailsHandlerStarted, { pool: postgresPoolStats() });
    perfAdd(trace, 'gmail_api_calls', 0, { calls: externalFetchCounters.gmail - Number(externalFetchBefore.gmail || 0) });
    if (url.searchParams.get('debug_timing') === 'true') {
      requireDeveloperAccess(req, user);
      const filters = normalizeEmailPageOptions(params);
      payload._debug = {
        request: safeEmailRequestParams(params, filters),
        email_path: trace.stages.find(stage => stage.name === 'email_path')?.path || 'unknown',
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          auth_ms: Number((perfDuration(trace, 'auth_session_lookup') + perfDuration(trace, 'auth_session_join') + perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          emails_page_query_ms: Number(perfDuration(trace, 'emails_page_query').toFixed(1)),
          email_filter_query_ms: Number(perfDuration(trace, 'email_filter_query').toFixed(1)),
          fallback_query_ms: Number(perfDuration(trace, 'fallback_query').toFixed(1)),
          secondary_query_ms: Number(Math.max(0, perfDurationEnding(trace, '_query') - perfDuration(trace, 'emails_page_query') - perfDuration(trace, 'emails_count_query')).toFixed(1)),
          gmail_state_query_ms: Number(perfDuration(trace, 'gmail_state_query').toFixed(1)),
          mapping_ms: Number(perfDuration(trace, 'mapping').toFixed(1)),
          serialize_ms: 0
        },
        pool: postgresPoolStats(),
        external_api_calls: {
          gmail: externalFetchCounters.gmail - Number(externalFetchBefore.gmail || 0),
          google: externalFetchCounters.google - Number(externalFetchBefore.google || 0),
          zoho: externalFetchCounters.zoho - Number(externalFetchBefore.zoho || 0),
          zoom: externalFetchCounters.zoom - Number(externalFetchBefore.zoom || 0),
          eventbrite: externalFetchCounters.eventbrite - Number(externalFetchBefore.eventbrite || 0),
          meta: externalFetchCounters.meta - Number(externalFetchBefore.meta || 0),
          apollo: externalFetchCounters.apollo - Number(externalFetchBefore.apollo || 0)
        },
        counters: perfCounters(trace),
        queries: bootstrapQueryBreakdown(trace),
        event_loop: eventLoopSnapshot(false)
      };
    }
    return sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/users' && method === 'POST') {
    const user = await currentSessionUser(req);
    requireDeveloperAccess(req, user);
    return sendJson(res, await createWorkspaceUser(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (lightweightMatch && method === 'POST') {
    const user = await currentSessionUser(req);
    requireDeveloperAccess(req, user);
    return sendJson(res, await resetWorkspaceUserPassword(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)\/role$/);
  if (lightweightMatch && method === 'PATCH') {
    const user = await currentSessionUser(req);
    requireDeveloperAccess(req, user);
    return sendJson(res, await updateWorkspaceUserRole(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/users\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE') {
    const user = await currentSessionUser(req);
    requireDeveloperAccess(req, user);
    return sendJson(res, await deleteWorkspaceUser(lightweightMatch[1], user));
  }
  if (route === '/api/applications' && method === 'GET') {
    await currentSessionUser(req, trace);
    return sendJson(res, await loadApplicationListDb({
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
  if (route === '/api/applications' && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await createApplicationFastDb(body, user), 201);
  }
  if (route === '/api/leads' && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    const result = await createLeadFastDb(body, user);
    return sendJson(res, result, result.created ? 201 : 200);
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)$/);
  if (lightweightMatch && method === 'GET' && usesPostgresStorage()) {
    await currentSessionUser(req);
    await ensureStorage();
    return sendJson(res, await loadLeadDetailDb(decodeURIComponent(lightweightMatch[1])));
  }
  if (lightweightMatch && method === 'PATCH' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await updateLeadFastDb(lightweightMatch[1], body, user));
  }
  if (lightweightMatch && method === 'DELETE' && postgresPool) {
    const user = await currentSessionUser(req);
    if (!permissionsForUser(user).sales) throw statusError(403, 'You do not have permission to delete leads.');
    return sendJson(res, await deleteLeadFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await addProgrammeOpportunityFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await addLeadNoteFastDb(lightweightMatch[1], body, user), 201);
  }
  if (route === '/api/tasks' && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await createTaskFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await completeTaskFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/tasks\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && postgresPool) {
    const user = await currentSessionUser(req);
    if (!permissionsForUser(user).sales) throw statusError(403, 'You do not have permission to delete tasks.');
    return sendJson(res, await deleteTaskFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await checkInAttendeeFastDb(lightweightMatch[1], user));
  }
  if (route === '/api/calls' && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await logCallFastDb(body, user));
  }
  if (route === '/api/emails' && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await recordEmailFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)\/resolve$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await resolveEmailFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)\/read$/);
  if (lightweightMatch && method === 'PATCH' && postgresPool) {
    await currentSessionUser(req);
    return sendJson(res, await updateEmailReadStateFastDb(lightweightMatch[1], body));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && postgresPool) {
    const user = await currentSessionUser(req);
    if (!permissionsForUser(user).sales) throw statusError(403, 'You do not have permission to delete emails.');
    return sendJson(res, await deleteEmailFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    await currentSessionUser(req);
    return sendJson(res, await uploadEvidenceFastDb(lightweightMatch[1], body), 201);
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await reviewEvidenceFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && postgresPool) {
    const user = await currentSessionUser(req);
    if (!permissionsForUser(user).review && !permissionsForUser(user).sales) throw statusError(403, 'You do not have permission to delete evidence.');
    return sendJson(res, await deleteEvidenceFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/evidence\/([^/]+)\/file$/);
  if (lightweightMatch && method === 'GET' && postgresPool) {
    await currentSessionUser(req);
    return sendEvidenceFileFastDb(lightweightMatch[1], res);
  }
  lightweightMatch = route.match(/^\/api\/document-templates\/([^/]+)\/file$/);
  if (lightweightMatch && method === 'GET') {
    await currentSessionUser(req);
    return sendDocumentTemplateFile(decodeURIComponent(lightweightMatch[1]), res);
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await reviewApplicationFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/contract$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    await currentSessionUser(req);
    return sendJson(res, await verifyContractFastDb(lightweightMatch[1], body));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)\/enrol$/);
  if (lightweightMatch && method === 'POST' && postgresPool) {
    const user = await currentSessionUser(req);
    return sendJson(res, await enrolApplicationFastDb(lightweightMatch[1], body, user));
  }
  lightweightMatch = route.match(/^\/api\/applications\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && postgresPool) {
    const user = await currentSessionUser(req);
    if (!permissionsForUser(user).review && !permissionsForUser(user).sales) throw statusError(403, 'You do not have permission to delete applications.');
    return sendJson(res, await deleteApplicationFastDb(lightweightMatch[1], user));
  }
  if (route === '/api/zoom/events' && method === 'GET') {
    await currentSessionUser(req, trace);
    const page = await loadZoomEventPageDb({ limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'), search: url.searchParams.get('search') }, trace);
    return sendJson(res, { events: page.items, has_more: page.has_more, hasMore: page.hasMore, next_cursor: page.next_cursor, nextCursor: page.nextCursor, limit: page.limit }, 200, {}, trace);
  }
  // Zoom meetings under the generic name; default page of 50, newest first.
  if (route === '/api/meetings' && method === 'GET') {
    await currentSessionUser(req, trace);
    return sendJson(res, await loadZoomEventPageDb({
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
    await currentSessionUser(req);
    return sendJson(res, await loadZoomCallPageDb(url.searchParams.get('limit'), url.searchParams.get('offset')));
  }
  if (route === '/api/zoom/numbers' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadZoomNumberPageDb(url.searchParams.get('limit'), url.searchParams.get('offset')));
  }
  if (route === '/api/audit' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, { audit: await loadAuditListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/attribution' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, { attribution: await loadAttributionListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/password/reset' && method === 'POST') {
    const resetLimits = [[`reset-address:${requestIp(req)}`, PASSWORD_RESET_ATTEMPTS_PER_ADDRESS]];
    assertAuthThrottle(resetLimits);
    recordAuthThrottle(resetLimits);
    return sendJson(res, await resetPasswordWithTokenFastDb(body));
  }
  if (route === '/api/logout' && method === 'POST') {
    await currentSessionUser(req);
    const sid = parseCookies(req).sid;
    await deleteSession(sid);
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (route === '/api/password' && method === 'POST') {
    const user = await currentSessionUser(req);
    return sendJson(res, await changeOwnPassword(user, body), 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (route === '/api/integrations/zoho/sync' && method === 'POST') {
    const user = await currentSessionUser(req);
    const started = performance.now();
    const job = await createOrResumeZohoSyncJob(req, user, body);
    const payload = zohoSyncJobPayload(job);
    return sendJson(res, { success: true, ...payload, acceptedMs: Math.round(performance.now() - started) }, 202);
  }
  if (route === '/api/integrations/zoho/records/page' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadZohoRecordPage({
      module: url.searchParams.get('module'),
      search: url.searchParams.get('search'),
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset')
    }));
  }
  if (route === '/api/integrations/zoho/sync-status' && method === 'GET') {
    await currentSessionUser(req);
    const job = await latestZohoSyncJob();
    if (job && ['queued', 'running'].includes(job.status)) scheduleZohoSyncWorker(job.id, 0);
    return sendJson(res, zohoSyncJobPayload(job));
  }
  lightweightMatch = route.match(/^\/api\/integrations\/zoho\/sync-status\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await currentSessionUser(req);
    const job = await getZohoSyncJob(decodeURIComponent(lightweightMatch[1]));
    if (!job) throw statusError(404, 'Zoho sync job not found.');
    if (['queued', 'running'].includes(job.status)) scheduleZohoSyncWorker(job.id, 0);
    return sendJson(res, zohoSyncJobPayload(job));
  }
  lightweightMatch = route.match(/^\/api\/integrations\/zoho\/sync\/([^/]+)\/cancel$/);
  if (lightweightMatch && method === 'POST') {
    await currentSessionUser(req);
    const job = await cancelZohoSyncJob(decodeURIComponent(lightweightMatch[1]));
    if (!job) throw statusError(404, 'Zoho sync job not found.');
    return sendJson(res, { success: true, ...zohoSyncJobPayload(job) });
  }
  if (route === '/api/integrations/zoho/status' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, zohoSafeStatus(req, await loadZohoWorkspaceState()));
  }
  if (route === '/api/integrations/zoho/diagnostics' && method === 'GET') {
    const user = await currentSessionUser(req);
    const canInspect = permissionsForUser(user).developer || permissions(user.role).admin;
    if (!canInspect) throw statusError(403, 'Developer access is required.');
    return sendJson(res, zohoConnectionDiagnostics(req, await loadZohoWorkspaceState()));
  }
  if (route === '/api/integrations/zoho/records' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await zohoRecordsPayloadDb(await loadZohoWorkspaceState()));
  }
  if (route === '/api/password/forgot' && method === 'POST') {
    // Checked here, before the full workspace load that the handler below needs.
    const forgotLimits = [
      [`forgot-address:${requestIp(req)}`, PASSWORD_FORGOT_REQUESTS_PER_ADDRESS],
      [`forgot-email:${normalizeEmail(body.email)}`, PASSWORD_FORGOT_REQUESTS_PER_EMAIL]
    ];
    assertAuthThrottle(forgotLimits);
    recordAuthThrottle(forgotLimits);
  }
  const loadDbStart = performance.now();
  const db = await loadDb();
  const loadDbMs = performance.now() - loadDbStart;
  if (/^\/api\/(?:leads|tasks|applications|attendees|calls|emails|evidence)/.test(route) && ['POST', 'PATCH', 'DELETE'].includes(method)) {
    console.warn(`[perf] ${method} ${route} used legacy loadDb path in ${loadDbMs.toFixed(1)}ms`);
  }
  if (route === '/api/password/forgot' && method === 'POST') {
    if (!postgresPool) throw statusError(500, 'Password reset requires Neon/PostgreSQL storage.');
    const email = normalizeEmail(body.email);
    if (!email) throw statusError(400, 'Email is required.');
    const user = db.users.find(item => normalizeEmail(item.email) === email);
    if (user) {
      const resetsTable = sqlIdentifier(POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
      const token = crypto.randomBytes(32).toString('base64url');
      await postgresPool.query(
        `insert into ${resetsTable} (user_id, email, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 minutes')`,
        [user.id, email, tokenHash(token)]
      );
      try {
        await sendPasswordResetMail(db, req, user, token);
      } catch (error) {
        console.error(`Password reset email failed for ${email}: ${error.message}`);
        if (!isLocalRequest(req)) throw error;
        return sendJson(res, {
          ok: true,
          message: 'Email delivery is not configured. Opening a local reset link instead.',
          reset_url: resetUrl(req, token),
          delivery_error: error.message
        });
      }
    }
    return sendJson(res, { ok: true, message: 'If this email is registered, a reset link has been sent.' });
  }
  const user = await currentSessionUser(req);
  if (route === '/api/leads/reconcile' && method === 'POST') {
    const summary = reconcileImportedData(db, user);
    await saveDb(db);
    return sendJson(res, { ok: true, summary });
  }
  if (route === '/api/monitoring/system' && method === 'GET') {
    const now = Date.now();
    const since = new Date(now - 24 * 60 * 60 * 1000);
    return sendJson(res, {
      storage: storageMode(),
      uptime_ms: now - serverStartedAt.getTime(),
      started_at: serverStartedAt.toISOString(),
      last_save_at: monitoringState.last_save_at,
      api_errors: monitoringState.api_errors,
      api_error_count: monitoringState.api_errors.length,
      api_timings: monitoringState.api_timings,
      background_jobs: {
        gmail: gmailAutoSyncState,
        events: eventAutoSyncState,
        zoom: zoomAutoSyncState
      },
      audit_24h: (db.audit || []).filter(item => new Date(item.occurred_at || 0) >= since).length
    });
  }
  // GET /api/bootstrap and GET /api/developer/config are handled by the lightweight
  // handlers earlier in this function. They intentionally return before this point so a
  // full workspace is never loaded for a page refresh.
  if (route === '/api/integrations/gmail/status' && method === 'GET') {
    const gmailNeedsReconnect = Boolean(db.gmail?.reconnect_required || db.gmail?.last_error);
    return sendJson(res, {
      configured: gmailConfigured(),
      connected: Boolean(db.gmail?.connected && !gmailNeedsReconnect),
      email: db.gmail?.email || null,
      last_sync_at: db.gmail?.last_sync_at || null,
      reconnect_required: gmailNeedsReconnect,
      last_error: gmailNeedsReconnect ? 'Gmail token expired or revoked. Reconnect Gmail from Settings.' : null,
      auto_sync: gmailAutoSyncState,
      import_enabled: GMAIL_IMPORT_ENABLED,
      redirect_uri: gmailRedirectUri(req)
    });
  }
  if (route === '/api/integrations/gmail/connect' && method === 'GET') {
    if (!gmailConfigured()) throw statusError(400, 'Gmail credentials are not configured. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env.');
    const sid = parseCookies(req).sid;
    const session = await getSession(sid);
    if (!session) throw statusError(401, 'Sign in to continue.');
    const gmailState = crypto.randomBytes(16).toString('hex');
    await patchSession(sid, { gmail_state: gmailState });
    res.writeHead(302, { Location: gmailAuthUrl(req, gmailState) });
    return res.end();
  }
  if (route === '/api/integrations/gmail/callback' && method === 'GET') {
    const sid = parseCookies(req).sid;
    const session = await getSession(sid);
    if (!session || !session.gmail_state || session.gmail_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?gmail=session-expired' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw statusError(400, url.searchParams.get('error') || 'Gmail did not return an authorization code.');
    const token = await exchangeGmailCode(req, code);
    const profile = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token.access_token}` } });
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
    addAudit(db, user, 'Gmail connected', 'integration', 'Gmail', db.gmail.email);
    await saveDb(db);
    res.writeHead(302, { Location: '/#/zoho?connected=1' });
    return res.end();
  }
  if (route === '/api/integrations/gmail/sync' && method === 'POST') {
    if (!GMAIL_IMPORT_ENABLED) throw statusError(403, 'Gmail import is paused. Existing emails remain available.');
    let result;
    try {
      result = await importGmailMessages(db, user, Number(body.max_results || 10), {
        latest: body.latest === undefined ? true : Boolean(body.latest),
        skipTrash: Boolean(body.skip_trash),
        forceTrash: Boolean(body.force_trash)
      });
    } catch (error) {
      if (gmailReconnectError(error.message)) throw await markGmailReconnectRequired(db, error.message);
      throw error;
    }
    return sendJson(res, result);
  }
  if (route === '/api/integrations/eventbrite/status' && method === 'GET') {
    return sendJson(res, {
      configured: eventbriteConfigured() || eventbritePrivateTokenConfigured(),
      connected: Boolean(db.eventbrite?.connected || eventbritePrivateTokenConfigured()),
      name: db.eventbrite?.name || null,
      last_sync_at: db.eventbrite?.last_sync_at || null,
      auto_sync: eventAutoSyncState,
      redirect_uri: eventbriteRedirectUri(req)
    });
  }
  if (route === '/api/integrations/eventbrite/connect' && method === 'GET') {
    if (!eventbriteConfigured()) throw statusError(400, 'Eventbrite credentials are not configured. Add EVENTBRITE_CLIENT_ID and EVENTBRITE_CLIENT_SECRET to .env.');
    const sid = parseCookies(req).sid;
    const session = await getSession(sid);
    if (!session) throw statusError(401, 'Sign in to continue.');
    const eventbriteState = crypto.randomBytes(16).toString('hex');
    await patchSession(sid, { eventbrite_state: eventbriteState });
    res.writeHead(302, { Location: eventbriteAuthUrl(req, eventbriteState) });
    return res.end();
  }
  if (route === '/api/integrations/eventbrite/callback' && method === 'GET') {
    const sid = parseCookies(req).sid;
    const session = await getSession(sid);
    if (!session || !session.eventbrite_state || session.eventbrite_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?eventbrite=session-expired' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw statusError(400, url.searchParams.get('error') || 'Eventbrite did not return an authorization code.');
    const token = await exchangeEventbriteCode(req, code);
    const profile = await fetchJson('https://www.eventbriteapi.com/v3/users/me/', { headers: { Authorization: `Bearer ${token.access_token}` } });
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
    addAudit(db, user, 'Eventbrite connected', 'integration', 'Eventbrite', db.eventbrite.name);
    await saveDb(db);
    res.writeHead(302, { Location: '/#/settings' });
    return res.end();
  }
  if (route === '/api/integrations/eventbrite/sync' && method === 'POST') {
    const result = await importEventbriteEvents(db, user, Number(body.max_events || 10), { save: false });
    await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, deleteEventIds: result.deleted_event_ids || [] });
    return sendJson(res, result);
  }
  if (route === '/api/events/import' && method === 'POST') {
    if (!permissions(user.role).sales) throw statusError(403, 'You do not have permission to import events.');
    const result = await importSpreadsheetEvents(db, user, body);
    await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
    return sendJson(res, result, 201);
  }
  if (route === '/api/integrations/zoom/status' && method === 'GET') {
    const accounts = zoomAccounts();
    return sendJson(res, {
      configured: zoomConfigured(),
      connected: zoomConfigured(),
      user_id: zoomSyncAllUsers() ? `all users across ${accounts.length} accounts` : (process.env.ZOOM_USER_ID || 'me'),
      meeting_type: zoomMeetingType(),
      report_history_months: zoomReportHistoryMonths(),
      history_months: zoomReportHistoryMonths(),
      history_from: process.env.ZOOM_HISTORY_FROM || null,
      all_users: zoomSyncAllUsers(),
      accounts: accounts.length,
      last_sync_at: db.zoom?.last_sync_at || null,
      last_call_sync_at: db.zoom?.last_call_sync_at || null,
      auto_sync: zoomAutoSyncState
    });
  }
  if (route === '/api/integrations/zoom/sync' && method === 'POST') {
    const result = await importZoomMeetings(db, user, Number(body.max_meetings || body.max_events || process.env.ZOOM_MAX_MEETINGS || 500), {
      save: false,
      report_history_months: body.report_history_months || body.history_months,
      history_from: body.history_from
    });
    await saveEventImportTables(db, { preserveGmail: true });
    return sendJson(res, result);
  }
  if (route === '/api/zoom/calls' && method === 'GET') {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 50), 250));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const allCalls = (db.zoom?.calls || [])
      .map(call => hydrateZoomStoredCall(db, call))
      .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
    const calls = allCalls.slice(offset, offset + limit);
    return sendJson(res, {
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
    const result = await importZoomCalls(db, user, Number(body.max_calls || process.env.ZOOM_MAX_CALLS || 1000), {
      save: false,
      max_calls: body.max_calls,
      call_history_months: body.call_history_months
    });
    await saveEventImportTables(db, { preserveGmail: true });
    return sendJson(res, result);
  }
  if (route === '/api/integrations/meta/status' && method === 'GET') {
    return sendJson(res, {
      configured: metaConfigured(),
      connected: metaConfigured(),
      page_id: process.env.META_PAGE_ID || null,
      last_sync_at: db.meta?.last_sync_at || null
    });
  }
  if (route === '/api/integrations/meta/sync' && method === 'POST') {
    const result = await importMetaLeads(db, user, Number(body.max_leads || 50));
    return sendJson(res, result);
  }
  if (route === '/api/integrations/apollo/status' && method === 'GET') {
    return sendJson(res, {
      configured: apolloConfigured(),
      connected: apolloConfigured(),
      keywords: process.env.APOLLO_KEYWORDS || null,
      titles: csvEnv('APOLLO_PERSON_TITLES'),
      last_sync_at: db.apollo?.last_sync_at || null
    });
  }
  if (route === '/api/integrations/apollo/sync' && method === 'POST') {
    const result = await importApolloPeople(db, user, Number(body.max_people || body.max_leads || 25));
    return sendJson(res, result);
  }
  if (route === '/api/integrations/zoho/status' && method === 'GET') {
    return sendJson(res, zohoSafeStatus(req, db));
  }
  if (route === '/api/integrations/zoho/diagnostics' && method === 'GET') {
    const canInspect = permissionsForUser(user).developer || permissions(user.role).admin;
    if (!canInspect) throw statusError(403, 'Developer access is required.');
    return sendJson(res, zohoConnectionDiagnostics(req, db));
  }
  if (route === '/api/integrations/zoho/records' && method === 'GET') {
    return sendJson(res, await zohoRecordsPayloadDb(db));
  }
  if ((route === '/api/integrations/zoho/connect' || route === '/api/integrations/zoho/authorize') && method === 'GET') {
    const issues = zohoConfigIssues(req);
    if (issues.length) throw statusError(400, `Zoho OAuth configuration appears invalid. Verify ZOHO_CLIENT_ID and ZOHO_ACCOUNTS_URL. ${issues[0]}`);
    const sid = parseCookies(req).sid;
    const session = await getSession(sid);
    if (!session) throw statusError(401, 'Sign in to continue.');
    const zohoState = crypto.randomBytes(16).toString('hex');
    await patchSession(sid, { zoho_state: zohoState });
    const promptConsent = ['1', 'true', 'yes'].includes(String(url.searchParams.get('reauthorize') || url.searchParams.get('prompt_consent') || '').toLowerCase());
    console.info(`[zoho] authorize start prompt_consent=${promptConsent} accounts=${zohoAuthAccountsUrl()}`);
    res.writeHead(302, { Location: zohoAuthUrl(req, zohoState, { promptConsent }) });
    return res.end();
  }
  if (route === '/api/integrations/zoho/callback' && method === 'GET') {
    const sid = parseCookies(req).sid;
    const session = await getSession(sid);
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
      await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, preserveApollo: true });
      res.writeHead(302, { Location: '/#/settings?zoho=oauth-error' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw statusError(400, url.searchParams.get('error') || 'Zoho did not return an authorization code.');
    const callbackAccountsUrl = url.searchParams.get('accounts-server') || url.searchParams.get('accounts_server') || zohoAccountsUrl();
    const callbackLocation = url.searchParams.get('location') || url.searchParams.get('dc') || '';
    const previousZoho = db.zoho || db.meta?.zoho || {};
    const token = await exchangeZohoCode(req, code, callbackAccountsUrl);
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
      scope: token.scope || zohoScopes().join(','),
      api_domain: token.api_domain || previousZoho.api_domain || zohoApiBaseUrl(db),
      expires_at: Date.now() + ((token.expires_in || 3600) - 60) * 1000,
      connected_at: new Date().toISOString(),
      last_error: durableConnection ? null : 'Zoho did not return a refresh token. Reconnect with consent to store durable offline access.',
      imported_record_ids: previousZoho.imported_record_ids || [],
      records: previousZoho.records || {}
    };
    db.meta ||= {};
    db.meta.zoho = db.zoho;
    console.info(`[zoho] callback persisted connected=${db.zoho.connected} refresh_token=${Boolean(db.zoho.refresh_token)} accounts=${db.zoho.accounts_url} api_domain=${db.zoho.api_domain} location=${db.zoho.location || 'unknown'}`);
    addAudit(db, user, 'Zoho CRM connected', 'integration', 'Zoho CRM', db.zoho.api_domain || '');
    await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, preserveApollo: true });
    res.writeHead(302, { Location: durableConnection ? '/#/settings?zoho=connected' : '/#/zoho?zoho=reauthorization-required' });
    return res.end();
  }
  let match = route.match(/^\/api\/leads\/([^/]+)$/);
  if (match && method === 'GET') {
    const lead = leadFor(db, match[1]);
    return sendJson(res, { lead, timeline: timeline(db, lead) });
  }
  if (route === '/api/leads' && method === 'POST') {
    const programme = db.programmes.find(item => item.id === body.programme_id);
    if (!programme) throw statusError(400, 'Choose a programme.');
    const owner = db.users.find(item => item.id === body.owner_id) || user;
    const result = ensureLeadRecord(db, owner, {
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
    if (!result.lead) throw statusError(400, 'This sender is excluded from lead creation.');
    let automaticApplication = null;
    if (AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS && isEnrolledStage(result.lead.stage) && !(db.applications || []).some(app => app.lead_id === result.lead.id)) {
      const appId = nextId('A', [db.applications]);
      automaticApplication = automaticApplicationFromLead(appId, result.lead, user);
      db.applications.push(automaticApplication);
      db.attribution.unshift({ ...result.lead, programme: automaticApplication.programme, snapshot: { first_touch: result.lead.source_first_touch, lead_capture: result.lead.source_lead_capture, conversion_source: result.lead.source_lead_capture } });
      addAudit(db, user, 'Application auto-created for lead', 'lead', result.lead.id, appId);
    }
    addAudit(db, user, result.created ? 'Lead created' : 'Lead updated from duplicate submission', 'lead', result.lead.id);
    await saveDb(db);
    return sendJson(res, { id: result.lead.id, lead: result.lead, created: result.created, application: automaticApplication ? publicApplication(automaticApplication) : null }, result.created ? 201 : 200);
  }
  if (match && method === 'PATCH') {
    const lead = leadFor(db, match[1]);
    Object.assign(lead, { stage: body.stage, owner_id: body.owner_id, priority: body.priority });
    let automaticApplication = null;
    const existingApplication = (db.applications || []).find(app => app.lead_id === lead.id);
    if (AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS && isEnrolledStage(lead.stage) && !existingApplication) {
      const appId = nextId('A', [db.applications]);
      automaticApplication = automaticApplicationFromLead(appId, lead, user);
      db.applications.push(automaticApplication);
      db.attribution.unshift({ ...lead, programme: automaticApplication.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
      addAudit(db, user, 'Application auto-created for lead', 'lead', lead.id, appId);
    }
    addAudit(db, user, 'Opportunity updated', 'lead', lead.id, body.reason);
    await saveDb(db);
    return sendJson(res, { ok: true, lead, application: automaticApplication ? publicApplication(automaticApplication) : null });
  }

  match = route.match(/^\/api\/leads\/([^/]+)\/opportunities$/);
  if (match && method === 'POST') {
    const original = leadFor(db, match[1]);
    const programme = db.programmes.find(item => item.id === body.programme_id);
    if (!programme) throw statusError(400, 'Choose a programme.');
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
    addAudit(db, user, 'Programme opportunity linked', 'lead', original.id, programme.name);
    await saveDb(db);
    return sendJson(res, { id: original.id, created: false });
  }

  match = route.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (match && method === 'POST') {
    leadFor(db, match[1]);
    addAudit(db, user, 'Note added', 'lead', match[1], body.note);
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  if (route === '/api/tasks' && method === 'POST') {
    const lead = leadFor(db, body.lead_id);
    db.tasks.push({ id: nextId('T', [db.tasks]), title: body.title, lead_id: lead.id, kind: body.kind, status: 'Open', created_at: new Date().toISOString(), due_at: body.due_at, priority: body.priority, owner_id: body.owner_id });
    addAudit(db, user, 'Task created', 'lead', lead.id, body.title);
    await saveDb(db);
    return sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (match && method === 'POST') {
    const task = db.tasks.find(item => item.id === match[1]);
    if (!task) throw statusError(404, 'Task not found.');
    task.status = 'Done';
    task.completed_at = new Date().toISOString();
    addAudit(db, user, 'Task completed', 'lead', task.lead_id, task.title);
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
  if (match && method === 'POST') {
    const attendee = db.events.flatMap(event => event.attendees || []).find(item => item.id === match[1]);
    if (!attendee) throw statusError(404, 'Attendee not found.');
    attendee.attended_at = attendee.attended_at || new Date().toISOString();
    const lead = attendee.lead_id ? db.leads.find(item => item.id === attendee.lead_id) : null;
    if (lead) {
      db.tasks.push({
        id: nextId('T', [db.tasks]),
        title: `Follow up after event attendance`,
        lead_id: lead.id,
        kind: 'Follow-up',
        status: 'Open',
        created_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 86400000).toISOString(),
        priority: lead.priority,
        owner_id: lead.owner_id
      });
      addAudit(db, user, 'Event attendee checked in', 'lead', lead.id, `${attendee.first_name} ${attendee.last_name}`);
    }
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  if (route === '/api/calls' && method === 'POST') {
    const lead = leadFor(db, body.lead_id);
    addAudit(db, user, `Call ${body.outcome}`, 'lead', lead.id, body.note);
    if (body.follow_up) db.tasks.push({ id: nextId('T', [db.tasks]), title: body.next_action, lead_id: lead.id, kind: 'Follow-up', status: 'Open', created_at: new Date().toISOString(), due_at: body.due_at, priority: lead.priority, owner_id: lead.owner_id });
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  if (route === '/api/emails' && method === 'POST') {
    const lead = leadFor(db, body.lead_id);
    const received = new Date(body.received_at);
    db.emails.unshift({ id: nextId('E', [db.emails]), first_name: lead.first_name, last_name: lead.last_name, email: lead.email, lead_id: lead.id, subject: body.subject, body: body.body, owner: lead.owner, direction: 'inbound', response_at: null, due_at: new Date(received.getTime() + EMAIL_RESPONSE_SLA_MS).toISOString(), received_at: received.toISOString() });
    addAudit(db, user, 'Inbound email recorded', 'lead', lead.id, body.subject);
    await saveDb(db);
    return sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/emails\/([^/]+)\/resolve$/);
  if (match && method === 'POST') {
    const email = db.emails.find(item => item.id === match[1]);
    if (!email) throw statusError(404, 'Email not found.');
    const responseAt = new Date(body.response_at);
    email.response_at = Number.isNaN(responseAt.getTime()) || responseAt.getFullYear() <= 2000 ? new Date().toISOString() : responseAt.toISOString();
    email.response_note = body.note;
    addAudit(db, user, 'Email response recorded', 'lead', email.lead_id, body.note);
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/emails\/([^/]+)\/reply$/);
  if (match && method === 'POST') {
    const email = db.emails.find(item => item.id === match[1]);
    if (!email) throw statusError(404, 'Email not found.');
    const messageText = String(body.message || '').trim();
    if (!messageText) throw statusError(400, 'Response message is required.');
    const subject = /^re:/i.test(email.subject || '') ? email.subject : `Re: ${email.subject || '(No subject)'}`;
    const fromEmail = mailFromAddress(db);
    const fromName = mailFromName();
    const message = rawEmail({ from: encodeMailAddress(fromName, fromEmail), to: email.email, subject, text: messageText });
    try {
    await sendGmailApiMail(db, message);
  } catch (apiError) {
    await sendSmtpMail({ fromEmail, fromName, to: email.email, subject, text: messageText }).catch(smtpError => {
        throw statusError(400, emailDeliveryError(apiError, smtpError).message);
      });
    }
    email.response_at = new Date().toISOString();
    email.response_note = messageText;
    addAudit(db, user, 'Email response sent', 'lead', email.lead_id, subject);
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  if (route === '/api/applications' && method === 'POST') {
    const lead = leadFor(db, body.lead_id);
    const intake = db.intakes.find(item => item.id === body.intake_id);
    const alreadyEnrolled = Boolean(body.already_enrolled);
    const learner = applicationLearnerFromBody(body);
    const appId = nextId('A', [db.applications]);
    lead.stage = alreadyEnrolled ? 'Enrolled' : 'Application Submitted';
    const documentsNeedSignature = Boolean(body.documents_need_signature);
    const evidenceVerified = alreadyEnrolled && !documentsNeedSignature;
    const app = { id: appId, lead_id: lead.id, first_name: lead.first_name, last_name: lead.last_name, programme: lead.programme, intake: intake?.name || 'Next intake', status: alreadyEnrolled ? 'Enrolled' : 'In review', manager: user.name, member: lead.first_name, created_at: new Date().toISOString(), contract: evidenceVerified ? { status: 'Verified', note: 'Existing enrolled learner documents uploaded.' } : { status: 'Draft', note: documentsNeedSignature ? 'Documents uploaded for learner signature.' : undefined }, requirements: applicationRequirements(appId, body.evidence_files, { verified: evidenceVerified, reviewer: user.name }), learner };
    db.applications.push(app);
    let attribution = null;
    if (alreadyEnrolled) {
      attribution = { ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } };
      db.attribution.unshift(attribution);
    }
    addAudit(db, user, alreadyEnrolled ? 'Existing learner enrolled' : 'Application started', 'lead', lead.id);
    await saveDb(db);
    return sendJson(res, { ok: true, application: publicApplication(app), lead, attribution }, 201);
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const req = app.requirements.find(item => item.id === body.requirement_id);
    if (!req) throw statusError(404, 'Requirement not found.');
    req.latest = { id: nextId('ER', [db.applications.flatMap(a => a.requirements.map(r => r.latest).filter(Boolean))]), filename: body.filename, version: (req.latest?.version || 0) + 1, status: 'Pending', reviewer: null, content_base64: body.content_base64 };
    if (!app.learner) app.status = 'In review';
    await saveDb(db);
    return sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/evidence\/([^/]+)\/file$/);
  if (match && method === 'GET') {
    const req = db.applications.flatMap(app => app.requirements).find(item => item.latest?.id === match[1]);
    if (!req?.latest) throw statusError(404, 'Evidence not found.');
    const content = Buffer.from(req.latest.content_base64 || '', 'base64');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${req.latest.filename}"` });
    return res.end(content);
  }

  match = route.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (match && method === 'POST') {
    const req = db.applications.flatMap(app => app.requirements).find(item => item.latest?.id === match[1]);
    if (!req?.latest) throw statusError(404, 'Evidence not found.');
    req.latest.status = body.status;
    req.latest.reviewer = user.name;
    req.latest.review_note = body.note;
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const lead = leadFor(db, app.lead_id);
    app.status = body.status;
    lead.stage = body.status === 'Eligible' ? 'Ready for Enrolment' : 'Not Eligible';
    addAudit(db, user, 'Eligibility decision', 'lead', lead.id, body.status);
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/contract$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    app.contract = { status: 'Verified', signatory: body.signatory, signed_at: body.signed_at, note: body.note, consistency_confirmed: body.consistency_confirmed };
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/enrol$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const lead = leadFor(db, app.lead_id);
    app.status = 'Enrolled';
    app.learner = { external_reference: body.external_reference, enrolled_at: new Date().toISOString(), note: body.note };
    lead.stage = 'Enrolled';
    db.attribution.unshift({ ...lead, programme: app.programme, snapshot: { first_touch: lead.source_first_touch, lead_capture: lead.source_lead_capture, conversion_source: lead.source_lead_capture } });
    addAudit(db, user, 'Learner enrolled', 'lead', lead.id, body.external_reference);
    await saveDb(db);
    return sendJson(res, { ok: true });
  }

  throw statusError(404, 'API route not found.');
}

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  req.__requestEntryAt = startedAt;
  const apiRequest = requestPath(req).startsWith('/api/');
  if (apiRequest) res.once('finish', () => recordApiTiming(req, res.statusCode, startedAt));
  try {
    if (apiRequest) return await handleApi(req, res);
    return serveStatic(req, res);
  } catch (error) {
    if (apiRequest) recordApiError(req, error);
    const status = error.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${requestPath(req)} ${status}: ${isInternalError(error) ? error.stack || error.message : error.message}`);
    if (res.headersSent) return res.end();
    sendJson(res, { error: publicErrorMessage(error) }, status, error.headers || {}, req.__perfTrace || null);
  }
});

if (process.env.NEST_COMPAT_MODE !== 'true') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Kent Business College backend running on port ${PORT}`);
    startAutoSync();
    startMonitoringSnapshotScheduler();
    setTimeout(() => runEnrolledLeadApplicationBackfill(), 5000);
  });
}

module.exports = {
  handleApi,
  serveStatic,
  publicStaticFile,
  withoutIntegrationSecrets,
  startAutoSync,
  runEnrolledLeadApplicationBackfill,
  server,
  bootstrap,
  loadDb,
  saveDb,
  saveEventImportTables,
  saveGmailImportTables,
  importSpreadsheetEvents,
  importEventbriteEvents,
  importZoomMeetings,
  importZoomCalls,
  importGmailMessages,
  databaseSafeMetadata,
  ensureProgrammeCatalog,
  programmeForText,
  programmeForEvent,
  recalculate,
  publicErrorMessage,
  __securityTest: {
    authThrottle,
    assertAuthThrottle,
    recordAuthThrottle,
    loginThrottleLimits,
    contentSecurityPolicy,
    applySecurityHeaders,
    hashPassword,
    verifyPassword,
    initialAdminPassword,
    AUTH_THROTTLE_WINDOW_MS,
    LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS
  },
  __zohoTest: {
    zohoAccessTokenValid,
    zohoTokenUsable,
    zohoConnectionDiagnostics,
    zohoSafeStatus,
    mergeZohoState,
    zohoReconnectRequiredMessage,
    createOrResumeZohoSyncJob,
    runZohoSyncWorker,
    getZohoSyncJob,
    loadZohoRecordPage
  },
  __leadsTest: {
    loadLeadPage,
    loadLeadDetailDb,
    loadTaskPage,
    loadEventPage,
    loadBootstrapPayload,
    buildLeadPageQuery,
    bootstrapPayloadQuery,
    explainBootstrapAndLeads,
    loadDashboardSummaryDb,
    loadDashboardTotalsDb,
    loadDashboardMonitoringDb,
    refreshMonitoringSnapshotDb,
    ensureMonitoringSnapshotSchema,
    readMonitoringSnapshotState,
    refreshMonitoringSnapshotInBackground,
    loadEmailPage,
    buildFilteredEmailPageQuery,
    emailFilterSql,
    emailFiltersSqlCapable,
    normalizeEmailPageOptions,
    loadContactPage,
    loadApplicationListDb,
    loadZoomEventPageDb,
    explainRemainingPageQueries,
    databaseSafeMetadata
  }
};
