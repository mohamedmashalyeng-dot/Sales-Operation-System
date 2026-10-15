'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

loadEnv();

function normalizePostgresConnectionString(value) {
  if (!/^postgres(ql)?:\/\//i.test(value || '')) return value || '';
  try {
    const parsed = new URL(value);
    const sslMode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();
    const libpqCompat = String(parsed.searchParams.get('uselibpqcompat') || '').toLowerCase() === 'true';
    if (!libpqCompat && ['prefer', 'require', 'verify-ca'].includes(sslMode)) {
      parsed.searchParams.set('sslmode', 'verify-full');
      return parsed.toString();
    }
  } catch {}
  return value || '';
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'pathway-db.json');
const USE_LOCAL_JSON_DB = /^(1|true|yes|on)$/i.test(String(process.env.USE_LOCAL_JSON_DB || ''));
const DATABASE_URL = USE_LOCAL_JSON_DB
  ? ''
  : normalizePostgresConnectionString(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.MONGODB_URI || process.env.MONGO_URI || '');
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
const ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED = AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS && String(process.env.ENROLLED_LEAD_APPLICATION_BACKFILL ?? process.env.LEAD_APPLICATION_BACKFILL ?? 'false').toLowerCase() === 'true';
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
const ZOHO_SYNC_MAX_RECORDS_PER_MODULE = Math.max(0, Math.min(Number(process.env.ZOHO_SYNC_MAX_RECORDS_PER_MODULE || 25000), 1000000));
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
const ZOHO_AUTO_SYNC_INTERVAL_MS = Math.max(60 * 1000, Math.min(Number(process.env.ZOHO_AUTO_SYNC_INTERVAL_MS || 5 * 60 * 1000), 24 * 60 * 60 * 1000));
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
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'AI_MODEL',
    'CALL_EVALUATION_WEBHOOK_SECRET',
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

exports.ROOT = ROOT;
exports.PORT = PORT;
exports.HOST = HOST;
exports.DATA_DIR = DATA_DIR;
exports.DB_FILE = DB_FILE;
exports.USE_LOCAL_JSON_DB = USE_LOCAL_JSON_DB;
exports.DATABASE_URL = DATABASE_URL;
exports.DATABASE_NAME = DATABASE_NAME;
exports.MONGO_STATE_COLLECTION = MONGO_STATE_COLLECTION;
exports.POSTGRES_STATE_TABLE = POSTGRES_STATE_TABLE;
exports.POSTGRES_USERS_TABLE = POSTGRES_USERS_TABLE;
exports.POSTGRES_LOGIN_EVENTS_TABLE = POSTGRES_LOGIN_EVENTS_TABLE;
exports.POSTGRES_PASSWORD_RESETS_TABLE = POSTGRES_PASSWORD_RESETS_TABLE;
exports.POSTGRES_SESSIONS_TABLE = POSTGRES_SESSIONS_TABLE;
exports.SESSION_TTL = SESSION_TTL;
exports.SESSION_TOUCH_INTERVAL_MS = SESSION_TOUCH_INTERVAL_MS;
exports.SESSION_AUTH_CACHE_MS = SESSION_AUTH_CACHE_MS;
exports.LEAD_SOFT_DELETE_CONFIG = LEAD_SOFT_DELETE_CONFIG;
exports.DB_CACHE_TTL_MS = DB_CACHE_TTL_MS;
exports.GMAIL_SCOPES = GMAIL_SCOPES;
exports.DEFAULT_ZOHO_MODULES = DEFAULT_ZOHO_MODULES;
exports.DEFAULT_ZOHO_SCOPES = DEFAULT_ZOHO_SCOPES;
exports.EMAIL_RESPONSE_SLA_MS = EMAIL_RESPONSE_SLA_MS;
exports.EMAIL_LIST_STATEMENT_TIMEOUT_MS = EMAIL_LIST_STATEMENT_TIMEOUT_MS;
exports.DEFAULT_DEVELOPER_EMAIL = DEFAULT_DEVELOPER_EMAIL;
exports.LEGACY_DEVELOPER_EMAILS = LEGACY_DEVELOPER_EMAILS;
exports.AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS = AUTO_CREATE_APPLICATIONS_FOR_ENROLLED_LEADS;
exports.ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED = ENROLLED_LEAD_APPLICATION_BACKFILL_ENABLED;
exports.ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT = ENROLLED_LEAD_APPLICATION_BACKFILL_LIMIT;
exports.BACKGROUND_JOBS_ENABLED = BACKGROUND_JOBS_ENABLED;
exports.GMAIL_IMPORT_ENABLED = GMAIL_IMPORT_ENABLED;
exports.GMAIL_INCREMENTAL_ONLY = GMAIL_INCREMENTAL_ONLY;
exports.GMAIL_AUTO_SYNC_ENABLED = GMAIL_AUTO_SYNC_ENABLED;
exports.GMAIL_AUTO_SYNC_MODE = GMAIL_AUTO_SYNC_MODE;
exports.GMAIL_AUTO_SYNC_DAILY_TIME = GMAIL_AUTO_SYNC_DAILY_TIME;
exports.GMAIL_AUTO_SYNC_BATCH_SIZE = GMAIL_AUTO_SYNC_BATCH_SIZE;
exports.GMAIL_AUTO_SYNC_ACTIVE_MS = GMAIL_AUTO_SYNC_ACTIVE_MS;
exports.GMAIL_AUTO_SYNC_IDLE_MS = GMAIL_AUTO_SYNC_IDLE_MS;
exports.GMAIL_AUTO_SYNC_DAILY_BATCHES = GMAIL_AUTO_SYNC_DAILY_BATCHES;
exports.GMAIL_TRASH_SYNC_LIMIT = GMAIL_TRASH_SYNC_LIMIT;
exports.GMAIL_TRASH_SYNC_INTERVAL_MS = GMAIL_TRASH_SYNC_INTERVAL_MS;
exports.EVENT_AUTO_SYNC_ENABLED = EVENT_AUTO_SYNC_ENABLED;
exports.EVENTS_INCREMENTAL_ONLY = EVENTS_INCREMENTAL_ONLY;
exports.EVENT_AUTO_SYNC_INTERVAL_MS = EVENT_AUTO_SYNC_INTERVAL_MS;
exports.EVENT_AUTO_SYNC_MAX_EVENTS = EVENT_AUTO_SYNC_MAX_EVENTS;
exports.EVENTBRITE_DELETE_SCAN_PAGES = EVENTBRITE_DELETE_SCAN_PAGES;
exports.EVENTS_SHEET_URL = EVENTS_SHEET_URL;
exports.ZOOM_AUTO_SYNC_ENABLED = ZOOM_AUTO_SYNC_ENABLED;
exports.ZOOM_AUTO_SYNC_MEETINGS = ZOOM_AUTO_SYNC_MEETINGS;
exports.ZOOM_AUTO_SYNC_CALLS = ZOOM_AUTO_SYNC_CALLS;
exports.ZOOM_AUTO_SYNC_INTERVAL_MS = ZOOM_AUTO_SYNC_INTERVAL_MS;
exports.ZOOM_AUTO_SYNC_MAX_MEETINGS = ZOOM_AUTO_SYNC_MAX_MEETINGS;
exports.ZOOM_AUTO_SYNC_MAX_CALLS = ZOOM_AUTO_SYNC_MAX_CALLS;
exports.ZOOM_REQUEST_DELAY_MS = ZOOM_REQUEST_DELAY_MS;
exports.ZOHO_SYNC_BATCH_SIZE = ZOHO_SYNC_BATCH_SIZE;
exports.ZOHO_SYNC_CONCURRENCY = ZOHO_SYNC_CONCURRENCY;
exports.ZOHO_SYNC_WORKER_YIELD_MS = ZOHO_SYNC_WORKER_YIELD_MS;
exports.ZOHO_SYNC_MAX_PAGES_PER_MODULE = ZOHO_SYNC_MAX_PAGES_PER_MODULE;
exports.ZOHO_SYNC_MAX_RECORDS_PER_MODULE = ZOHO_SYNC_MAX_RECORDS_PER_MODULE;
exports.ZOHO_SYNC_MODULE_CONCURRENCY = ZOHO_SYNC_MODULE_CONCURRENCY;
exports.ZOHO_FETCH_ATTEMPTS = ZOHO_FETCH_ATTEMPTS;
exports.ZOHO_JOB_LEASE_MS = ZOHO_JOB_LEASE_MS;
exports.ZOHO_WORKER_ID = ZOHO_WORKER_ID;
exports.ZOHO_RECORDS_PREVIEW_LIMIT = ZOHO_RECORDS_PREVIEW_LIMIT;
exports.ZOHO_RECORDS_PREVIEW_TIMEOUT_MS = ZOHO_RECORDS_PREVIEW_TIMEOUT_MS;
exports.ZOHO_SYNC_WORKER_ENABLED = ZOHO_SYNC_WORKER_ENABLED;
exports.ZOHO_AUTO_SYNC_ENABLED = ZOHO_AUTO_SYNC_ENABLED;
exports.ZOHO_AUTO_SYNC_INTERVAL_MS = ZOHO_AUTO_SYNC_INTERVAL_MS;
exports.ZOHO_INCREMENTAL_OVERLAP_MS = ZOHO_INCREMENTAL_OVERLAP_MS;
exports.PROGRAMME_CATALOG = PROGRAMME_CATALOG;
exports.API_TIMING_WARN_MS = API_TIMING_WARN_MS;
exports.API_PERF_TRACE_ENABLED = API_PERF_TRACE_ENABLED;
exports.API_DEBUG_ENDPOINTS_ENABLED = API_DEBUG_ENDPOINTS_ENABLED;
exports.POSTGRES_POOL_MAX = POSTGRES_POOL_MAX;
exports.POSTGRES_POOL_WARM_CONNECTIONS = POSTGRES_POOL_WARM_CONNECTIONS;
exports.POSTGRES_POOL_IDLE_TIMEOUT_MS = POSTGRES_POOL_IDLE_TIMEOUT_MS;
exports.POSTGRES_POOL_CONNECTION_TIMEOUT_MS = POSTGRES_POOL_CONNECTION_TIMEOUT_MS;
exports.MONITORING_STATEMENT_TIMEOUT_MS = MONITORING_STATEMENT_TIMEOUT_MS;
exports.MONITORING_SNAPSHOT_TTL_MS = MONITORING_SNAPSHOT_TTL_MS;
exports.MONITORING_SNAPSHOT_ENABLED = MONITORING_SNAPSHOT_ENABLED;
exports.MONITORING_SNAPSHOT_PROACTIVE_ENABLED = MONITORING_SNAPSHOT_PROACTIVE_ENABLED;
exports.MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS = MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS;
exports.MONITORING_SNAPSHOT_REFRESH_LOCK_MS = MONITORING_SNAPSHOT_REFRESH_LOCK_MS;
exports.MONITORING_SNAPSHOT_MEMORY_CACHE_MS = MONITORING_SNAPSHOT_MEMORY_CACHE_MS;
