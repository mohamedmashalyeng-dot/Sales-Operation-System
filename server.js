'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
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
const memorySessions = new Map();
let mongoClient = null;
let mongoStateCollection = null;
let postgresPool = null;
let postgresUserSchemaReady = false;
let postgresSchemaReady = false;
let storageReady = null;
let dbCache = null;
let identityCleanupRunning = false;

const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const EMAIL_RESPONSE_SLA_MS = 48 * 60 * 60 * 1000;
const DEFAULT_DEVELOPER_EMAIL = 'mohamedmashalyeng@gmail.com';
const LEGACY_DEVELOPER_EMAILS = ['alteam.kbc@gmail.com'];
const GMAIL_IMPORT_ENABLED = String(process.env.GMAIL_IMPORT || 'true').toLowerCase() !== 'false';
const GMAIL_INCREMENTAL_ONLY = String(process.env.GMAIL_INCREMENTAL_ONLY || 'false').toLowerCase() === 'true';
const GMAIL_AUTO_SYNC_ENABLED = String(process.env.GMAIL_AUTO_SYNC || 'true').toLowerCase() !== 'false';
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
const EVENT_AUTO_SYNC_ENABLED = String(process.env.EVENT_AUTO_SYNC || 'true').toLowerCase() !== 'false';
const EVENTS_INCREMENTAL_ONLY = String(process.env.EVENTS_INCREMENTAL_ONLY || 'false').toLowerCase() === 'true';
const EVENT_AUTO_SYNC_INTERVAL_MS = Math.max(2 * 60 * 1000, Number(process.env.EVENT_AUTO_SYNC_INTERVAL_MS || 10 * 60 * 1000));
const EVENT_AUTO_SYNC_MAX_EVENTS = Math.max(1, Math.min(Number(process.env.EVENT_AUTO_SYNC_MAX_EVENTS || 10), 50));
const EVENTBRITE_DELETE_SCAN_PAGES = Math.max(1, Math.min(Number(process.env.EVENTBRITE_DELETE_SCAN_PAGES || 10), 50));
const EVENTS_SHEET_URL = process.env.EVENTS_SHEET_URL || '';
const ZOOM_REQUEST_DELAY_MS = Math.max(0, Number(process.env.ZOOM_REQUEST_DELAY_MS || 350));
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
const serverStartedAt = new Date();
const monitoringState = { last_save_at: null, api_errors: [] };

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
  '.ico': 'image/x-icon'
};

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function loadEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  const fileWins = new Set(['DEV_PANEL_PASSWORD', 'INITIAL_ADMIN_PASSWORD']);
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

function initialUsers() {
  const password_hash = hashPassword(process.env.INITIAL_ADMIN_PASSWORD || 'ChangeMeNow!2026');
  return [{
    id: 'local-user',
    name: process.env.INITIAL_ADMIN_NAME || 'Kent Alteam',
    email: process.env.INITIAL_ADMIN_EMAIL || 'alteam.kbc@gmail.com',
    role: process.env.INITIAL_ADMIN_ROLE || 'admin',
    password_hash
  }];
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
      temporary_password: config.password,
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
    user.temporary_password = config.password;
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

function seedDatabase() {
  const users = initialUsers();
  return recalculate({
    demo: false,
    users,
    programmes: PROGRAMME_CATALOG.map(item => ({ ...item })),
    stages: ['New lead', 'Qualified', 'Application Submitted', 'Eligibility', 'Ready for Enrolment', 'Enrolled', 'Not Eligible', 'Lost'],
    sources: ['Website', 'Referral', 'Event', 'Meta', 'LinkedIn', 'Cold outreach'],
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
    ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
  postgresPool.on('error', error => {
    console.error(`Postgres idle connection error: ${error.message || error}`);
  });
  postgresPool.on('connect', client => {
    client.on('error', error => {
      console.error(`Postgres client connection error: ${error.message || error}`);
    });
  });
  return postgresPool;
}

function postgresConnectionLost(error) {
  return /Connection terminated unexpectedly|ECONNRESET|Connection ended unexpectedly|Client has encountered a connection error/i.test(String(error?.message || error || ''));
}

async function resetPostgresPool() {
  const pool = postgresPool;
  postgresPool = null;
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

async function connectPostgresStorage() {
  await getPostgresPool();
  await ensurePostgresUserSchema();
  if (postgresSchemaReady || String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') {
    postgresSchemaReady = true;
    return postgresPool;
  }
  const table = sqlIdentifier(POSTGRES_STATE_TABLE, 'app_state');
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const loginEventsTable = sqlIdentifier(POSTGRES_LOGIN_EVENTS_TABLE, 'app_login_events');
  const passwordResetsTable = sqlIdentifier(POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
  await postgresPool.query(`
    create table if not exists ${table} (
      id text primary key,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await createPostgresAppTables();
  postgresSchemaReady = true;
  return postgresPool;
}

async function ensurePostgresUserSchema() {
  if (!postgresPool) return;
  if (postgresUserSchemaReady) return;
  const usersTable = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const sessionsTable = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
  await postgresPool.query(`
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
  await postgresPool.query(`alter table ${usersTable} add column if not exists temporary_password text`);
  await postgresPool.query(`alter table ${usersTable} add column if not exists invited_at timestamptz`);
  await postgresPool.query(`alter table ${usersTable} add column if not exists password_changed_at timestamptz`);
  await postgresPool.query(`
    create table if not exists ${sessionsTable} (
      id text primary key,
      user_id text not null,
      gmail_state text,
      eventbrite_state text,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await postgresPool.query(`create index if not exists ${sqlIdentifier(`${POSTGRES_SESSIONS_TABLE}_user_id_idx`, 'app_sessions_user_id_idx')} on ${sessionsTable} (user_id)`);
  await postgresPool.query(`create index if not exists ${sqlIdentifier(`${POSTGRES_SESSIONS_TABLE}_expires_at_idx`, 'app_sessions_expires_at_idx')} on ${sessionsTable} (expires_at)`);
  postgresUserSchemaReady = true;
}

async function ensureStorage() {
  if (!DATABASE_URL) return null;
  if (usesPostgresStorage()) {
    storageReady ||= connectPostgresStorage();
    return storageReady;
  }
  if (!usesMongoStorage()) throw statusError(500, 'Unsupported DATABASE_URL. Use a PostgreSQL/Neon URL that starts with postgresql:// or a MongoDB URL that starts with mongodb:// or mongodb+srv://.');
  storageReady ||= connectMongoStorage();
  return storageReady;
}

async function ensureUserStorage() {
  if (!DATABASE_URL) return null;
  if (usesPostgresStorage()) {
    await getPostgresPool();
    await ensurePostgresUserSchema();
    return postgresPool;
  }
  return ensureStorage();
}

async function createPostgresAppTables() {
  await postgresPool.query(`
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
  await postgresPool.query(`create table if not exists app_programmes (id text primary key, name text not null, level text, data jsonb not null default '{}'::jsonb)`);
  await postgresPool.query(`create table if not exists app_intakes (id text primary key, programme_id text, name text not null, data jsonb not null default '{}'::jsonb)`);
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await postgresPool.query(`
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
  await postgresPool.query(`
    create table if not exists app_attribution (
      id bigserial primary key,
      lead_id text,
      email text,
      programme text,
      data jsonb not null,
      created_at timestamptz not null default now()
    )
  `);
}

async function loadDb() {
  if (dbCache) return recalculate(cloneDb(dbCache));
  await ensureStorage();
  if (postgresPool) {
    const normalized = await loadPostgresTables();
    if (normalized) {
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
    attribution
  ] = await Promise.all([
    postgresPool.query(`select data from app_programmes order by id`),
    leadLimit > 0
      ? postgresPool.query(`select data from app_leads order by created_at desc nulls last, id limit $1`, [leadLimit])
      : postgresPool.query(`select data from app_leads order by created_at nulls last, id`),
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
      : postgresPool.query(`select data from app_attribution order by id desc`)
  ]);
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
    zoom: row.meta?.zoom || { imported_meeting_ids: [] },
    meta: row.meta || { imported_lead_ids: [], imported_form_ids: [] }
  };
  return db;
}

async function deleteMissingIds(client, table, ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  if (wanted.length) {
    await client.query(`delete from ${table} where not (id = any($1::text[]))`, [wanted]);
  } else {
    await client.query(`delete from ${table}`);
  }
}

async function savePostgresTables(db) {
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
      ['main', Boolean(db.demo), jsonValue(db.stages || []), jsonValue(db.sources || []), jsonValue(db.gmail || {}), jsonValue(db.eventbrite || {}), jsonValue({ ...(db.meta || {}), apollo: db.apollo || {}, zoom: db.zoom || {} })]
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
       removed_duplicates as (
         delete from app_emails existing
         using deduped incoming
         where incoming.gmail_message_id is not null
           and incoming.gmail_message_id <> ''
           and existing.gmail_message_id = incoming.gmail_message_id
           and existing.id <> incoming.id
         returning existing.id
       )
       insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       select id, lead_id, first_name, last_name, email, subject, body, owner, response_at::timestamptz, response_note, due_at::timestamptz, received_at::timestamptz, nullif(gmail_message_id, ''), data from deduped
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
      ['main', Boolean(db.demo), jsonValue(db.stages || []), jsonValue(db.sources || []), jsonValue(gmailState), jsonValue(db.eventbrite || {}), jsonValue({ ...(db.meta || {}), apollo: db.apollo || {}, zoom: db.zoom || {} })]
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
    await client.query('commit');
    dbCache = cloneDb(recalculate(db));
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
      ['main', Boolean(db.demo), jsonValue(db.stages || []), jsonValue(db.sources || []), jsonValue(db.gmail || {}), jsonValue(eventbriteState), jsonValue({ ...(db.meta || {}), apollo: db.apollo || {}, zoom: db.zoom || {} })]
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
       removed_duplicates as (
         delete from app_emails existing
         using deduped incoming
         where incoming.gmail_message_id is not null
           and incoming.gmail_message_id <> ''
           and existing.gmail_message_id = incoming.gmail_message_id
           and existing.id <> incoming.id
         returning existing.id
       )
       insert into app_emails (id, lead_id, first_name, last_name, email, subject, body, owner, response_at, response_note, due_at, received_at, gmail_message_id, data)
       select id, lead_id, first_name, last_name, email, subject, body, owner, response_at::timestamptz, response_note, due_at::timestamptz, received_at::timestamptz, nullif(gmail_message_id, ''), data from deduped
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
    dbCache = cloneDb(recalculate(db));
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
        insert into ${table} (id, name, email, role, password_hash, temporary_password, invited_at, password_changed_at, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
        on conflict (email) do update
        set name = excluded.name,
            role = excluded.role,
            password_hash = excluded.password_hash,
            temporary_password = excluded.temporary_password,
            invited_at = coalesce(${table}.invited_at, excluded.invited_at),
            password_changed_at = excluded.password_changed_at,
            updated_at = now()
      `,
      [user.id, user.name, normalizeEmail(user.email), user.role || 'sales', user.password_hash, user.temporary_password || null, dateValue(user.invited_at), dateValue(user.password_changed_at)]
    );
  }
}

async function hydratePostgresUsers(db) {
  if (!postgresPool) return db;
  const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
  const count = await postgresPool.query(`select count(*)::int as count from ${table}`);
  if (!count.rows[0]?.count && db.users?.length) await upsertPostgresUsers(db.users);
  const result = await postgresPool.query(`select id, name, email, role, password_hash, temporary_password, invited_at, password_changed_at from ${table} order by created_at, id`);
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
    temporary_password: config.password,
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
      `select id, name, email, role, password_hash, temporary_password, invited_at, password_changed_at from ${table} where email = $1 limit 1`,
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
  if (!configuredPassword || password !== configuredPassword) return null;
  const developerUser = configuredDeveloperUserRecord();
  if (!developerUser) return null;
  await ensureUserStorage();
  if (postgresPool) {
    await upsertPostgresUsers([developerUser]);
    const table = sqlIdentifier(POSTGRES_USERS_TABLE, 'app_users');
    const result = await postgresQuery(
      `select id, name, email, role, password_hash, temporary_password, invited_at, password_changed_at from ${table} where email = $1 limit 1`,
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
      `select id, name, email, role, password_hash, temporary_password, invited_at, password_changed_at from ${table} where id = $1 limit 1`,
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
      `insert into ${table} (id, user_id, expires_at, created_at, updated_at)
       values ($1, $2, $3, now(), now())`,
      [sid, user.id, expiresAt.toISOString()]
    );
  } else {
    memorySessions.set(sid, { user_id: user.id, expires_at: expiresAt.getTime() });
  }
  return sid;
}

async function getSession(sid) {
  if (!sid) return null;
  await ensureUserStorage();
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    const result = await postgresQuery(
      `select id, user_id, gmail_state, eventbrite_state, expires_at from ${table} where id = $1 limit 1`,
      [sid]
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
    if (session) session.expires_at = expiresAt.getTime();
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
           updated_at = now()
       where id = $1`,
      [sid, fields.gmail_state ?? null, fields.eventbrite_state ?? null]
    );
  } else {
    const session = memorySessions.get(sid);
    if (!session) throw statusError(401, 'Sign in to continue.');
    Object.assign(session, fields);
  }
}

async function deleteSession(sid) {
  if (!sid) return;
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(`delete from ${table} where id = $1`, [sid]);
    return;
  }
  memorySessions.delete(sid);
}

async function currentSessionUser(req) {
  const sid = parseCookies(req).sid;
  const session = await getSession(sid);
  if (!session) throw statusError(401, 'Sign in to continue.');
  const user = await findUserById(session.user_id);
  if (!user) throw statusError(401, 'Sign in to continue.');
  await touchSession(sid);
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
  if (postgresPool) {
    const table = sqlIdentifier(POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await postgresQuery(`delete from ${table} where user_id = $1`, [userId]);
    return;
  }
  for (const [sid, session] of memorySessions.entries()) {
    if (session.user_id === userId) memorySessions.delete(sid);
  }
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
  const { password_hash, temporary_password, ...safe } = user;
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
  if (/zoho|zoho crm|zoho contracts?/.test(text)) labels.push('Zoho');
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
    lead.source_history.push({ source, provider_id: detail.provider_id || '', captured_at: detail.captured_at || new Date().toISOString() });
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
  for (const key of ['eventbrite_attendee_id', 'meta_lead_id', 'meta_form_id', 'meta_form_name', 'apollo_person_id']) {
    if (incoming[key] && !target[key]) target[key] = incoming[key];
  }
  if (incoming.created_at && (!target.created_at || new Date(incoming.created_at) < new Date(target.created_at))) {
    target.created_at = incoming.created_at;
    target.source_first_touch = incoming.source_first_touch || target.source_first_touch;
  }
  if (incoming.source_lead_capture) target.source_lead_capture = incoming.source_lead_capture;
  addLeadSource(target, incoming.source_lead_capture || incoming.source_first_touch, {
    provider_id: incoming.gmail_message_id || incoming.eventbrite_attendee_id || incoming.meta_lead_id || incoming.apollo_person_id || '',
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
    provider_id: lead.gmail_message_id || lead.eventbrite_attendee_id || lead.meta_lead_id || lead.apollo_person_id || '',
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

function scheduleIdentityCleanup(db, user) {
  if (identityCleanupRunning) return;
  identityCleanupRunning = true;
  const snapshot = cloneDb(db);
  const actor = user ? { ...user } : null;
  setImmediate(async () => {
    try {
      const promoted = promoteEmailSendersToLeads(snapshot, actor);
      const deduped = dedupeLeadRecords(snapshot, actor);
      if (promoted.created || promoted.linked || deduped.merged || deduped.migrated || deduped.removed_excluded) await saveDb(snapshot);
    } catch (error) {
      console.error(`Lead identity cleanup failed: ${error.message}`);
    } finally {
      identityCleanupRunning = false;
    }
  });
}

function runIdentityCleanupInMemory(db, user) {
  const promoted = promoteEmailSendersToLeads(db, user);
  const deduped = dedupeLeadRecords(db, user);
  const changed = Boolean(promoted.created || promoted.linked || deduped.merged || deduped.migrated || deduped.removed_excluded);
  if (changed) {
    dbCache = cloneDb(recalculate(db));
    scheduleIdentityCleanup(db, user);
  }
  return changed;
}

function recalculate(db) {
  db.users ||= initialUsers();
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
  db.zoom ||= db.meta.zoom || { imported_meeting_ids: [] };
  db.meta.apollo = db.apollo;
  db.meta.zoom = db.zoom;
  if (!db.sources.includes('Meta')) db.sources.push('Meta');
  if (!db.sources.includes('Email')) db.sources.push('Email');
  if (!db.sources.includes('Apollo')) db.sources.push('Apollo');
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
  for (const lead of db.leads) {
    if (!inactiveStages.has(lead.stage)) active += 1;
    const source = lead.source_first_touch;
    if (!source) continue;
    const row = sourceStats.get(source) || { source, leads: 0, enrolled: 0 };
    row.leads += 1;
    if (lead.stage === 'Enrolled') row.enrolled += 1;
    sourceStats.set(source, row);
  }
  db.stats = {
    active,
    applications: db.applications.length,
    enrolled: db.applications.filter(app => app.learner).length,
    overdue: db.tasks.filter(task => task.status === 'Open' && new Date(task.due_at) < new Date()).length,
    unanswered: db.emails.filter(email => emailNeedsResponse(db, email)).length
  };
  db.source_counts = db.sources.map(source => sourceStats.get(source) || { source, leads: 0, enrolled: 0 }).filter(row => row.leads || row.enrolled);
  const gmailReady = gmailConfigured();
  const gmailStatus = db.gmail.connected ? 'Connected' : gmailReady ? 'Ready to connect' : 'Needs credentials';
  const gmailDetail = db.gmail.connected ? `Mailbox sync connected${db.gmail.email ? ` for ${db.gmail.email}` : ''}.` : gmailReady ? 'OAuth credentials are configured. Connect a mailbox from Settings.' : 'Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env to enable Gmail OAuth.';
  const eventbriteReady = eventbriteConfigured();
  const eventbriteTokenReady = eventbritePrivateTokenConfigured();
  const eventbriteConnected = db.eventbrite.connected || eventbriteTokenReady;
  const eventbriteStatus = eventbriteConnected ? 'Connected' : eventbriteReady ? 'Ready to connect' : 'Needs credentials';
  const eventbriteDetail = eventbriteConnected ? `Eventbrite sync connected${db.eventbrite.name ? ` for ${db.eventbrite.name}` : eventbriteTokenReady ? ' by private token' : ''}.` : eventbriteReady ? 'OAuth credentials are configured. Connect Eventbrite from Settings.' : 'Add EVENTBRITE_CLIENT_ID and EVENTBRITE_CLIENT_SECRET, or EVENTBRITE_PRIVATE_TOKEN, to .env to enable Eventbrite sync.';
  const metaReady = metaConfigured();
  const metaStatus = metaReady ? 'Connected' : 'Needs credentials';
  const metaDetail = metaReady ? `Meta Lead Ads sync is configured for page ${process.env.META_PAGE_ID}.` : 'Add META_ACCESS_TOKEN and META_PAGE_ID to .env to enable Meta Lead Ads sync.';
  const apolloReady = apolloConfigured();
  const apolloStatus = apolloReady ? 'Connected' : 'Needs credentials';
  const apolloDetail = apolloReady ? 'Apollo people search is configured with an API key.' : 'Add APOLLO_API_KEY to .env to enable Apollo prospect sync.';
  const zoomReady = zoomConfigured();
  const zoomStatus = zoomReady ? 'Connected' : 'Needs credentials';
  const zoomAccountCount = zoomAccounts().length;
  const zoomDetail = zoomReady ? `Zoom meetings sync is configured for ${zoomSyncAllUsers() ? 'all users' : process.env.ZOOM_USER_ID || 'me'} across ${zoomAccountCount} account${zoomAccountCount === 1 ? '' : 's'}.` : 'Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env to sync Zoom meetings.';
  db.integrations = [
    { name: 'Gmail', status: gmailStatus, detail: gmailDetail },
    { name: 'Eventbrite', status: eventbriteStatus, detail: eventbriteDetail },
    { name: 'Zoom', status: zoomStatus, detail: zoomDetail },
    { name: 'Meta', status: metaStatus, detail: metaDetail },
    { name: 'Apollo', status: apolloStatus, detail: apolloDetail }
  ];
  return db;
}

function bootstrap(db, user) {
  const copy = JSON.parse(JSON.stringify(recalculate(db)));
  delete copy.users;
  copy.user = publicUser(user);
  copy.permissions = permissionsForUser(user);
  copy.demoUser = user.email;
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
    data - 'body' - 'html' - 'html_body' - 'body_html' - 'attachments'
    || jsonb_build_object(
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
      'response_at', response_at,
      'response_note', coalesce(response_note, ''),
      'due_at', due_at,
      'gmail_message_id', coalesce(gmail_message_id, ''),
      'snippet', left(regexp_replace(coalesce(body, data->>'snippet', ''), '\\s+', ' ', 'g'), 260)
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
    if (!value?.id) return null;
    return {
      id: String(value.id),
      received_at: value.received_at ? new Date(value.received_at) : null
    };
  } catch {
    throw statusError(400, 'Invalid email cursor.');
  }
}

function encodeLeadCursor(lead) {
  if (!lead?.id) return '';
  return Buffer.from(JSON.stringify({
    created_at: lead.created_at || null,
    id: lead.id
  })).toString('base64url');
}

function decodeLeadCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!value?.id) return null;
    return {
      id: String(value.id),
      created_at: value.created_at ? new Date(value.created_at) : null
    };
  } catch {
    throw statusError(400, 'Invalid lead cursor.');
  }
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

async function loadLeadPage(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 100));
  const cursor = decodeLeadCursor(options.cursor);
  const filters = {
    search: String(options.search || '').trim(),
    stage: String(options.stage || '').trim(),
    owner_id: String(options.owner_id || options.ownerId || '').trim(),
    programme_id: String(options.programme_id || options.programmeId || '').trim()
  };
  await ensureStorage();
  if (!postgresPool || !usesPostgresStorage()) {
    const db = await loadDb();
    const rows = filterLocalLeads(db.leads || [], filters)
      .sort((a, b) => {
        const timeDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
        return timeDiff || String(a.id).localeCompare(String(b.id));
      });
    const cursorIndex = cursor ? rows.findIndex(item => item.id === cursor.id) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const items = rows.slice(startIndex, startIndex + limit);
    const next = rows[startIndex + limit];
    return {
      items,
      leads: items,
      total: rows.length,
      loaded: startIndex + items.length,
      next_cursor: next ? encodeLeadCursor(items[items.length - 1]) : '',
      limit,
      has_more: Boolean(next)
    };
  }
  const where = [];
  const params = [];
  const addParam = value => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.stage) where.push(`coalesce(stage, data->>'stage', '') = ${addParam(filters.stage)}`);
  if (filters.owner_id) where.push(`coalesce(owner_id, data->>'owner_id', '') = ${addParam(filters.owner_id)}`);
  if (filters.programme_id) where.push(`coalesce(programme_id, data->>'programme_id', '') = ${addParam(filters.programme_id)}`);
  if (filters.search) {
    const term = `%${filters.search.toLowerCase()}%`;
    where.push(`lower(concat_ws(' ', first_name, last_name, email, phone, employer, programme, stage, owner, data->>'full_name')) like ${addParam(term)}`);
  }
  const baseWhere = where.length ? `where ${where.join(' and ')}` : '';
  const totalParams = params.slice();
  const total = Number((await postgresPool.query(`select count(*)::int as total from app_leads ${baseWhere}`, totalParams)).rows[0]?.total || 0);
  if (cursor) {
    const cursorDateParam = addParam(cursor.created_at ? cursor.created_at.toISOString() : null);
    const cursorIdParam = addParam(cursor.id);
    where.push(`(
      (${cursorDateParam}::timestamptz is not null and (created_at < ${cursorDateParam}::timestamptz or (created_at = ${cursorDateParam}::timestamptz and id > ${cursorIdParam}) or created_at is null))
      or (${cursorDateParam}::timestamptz is null and created_at is null and id > ${cursorIdParam})
    )`);
  }
  const result = await postgresPool.query(
    `select data from app_leads
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by created_at desc nulls last, id
     limit ${addParam(limit + 1)}`,
    params
  );
  const rows = result.rows.map(item => item.data);
  const items = rows.slice(0, limit);
  return {
    items,
    leads: items,
    total,
    loaded: items.length,
    next_cursor: rows.length > limit ? encodeLeadCursor(items[items.length - 1]) : '',
    limit,
    has_more: rows.length > limit
  };
}

function dashboardSummaryFromDb(db) {
  const leads = db.leads || [];
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
      qualified: leads.filter(lead => /qualified/.test(String(lead.stage || '').toLowerCase())).length
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
      new: applications.filter(application => /new|draft|pending|submitted/i.test(String(application.status || ''))).length
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
        count(*) filter (where lower(coalesce(stage, data->>'stage', '')) like '%new%')::int as new,
        count(*) filter (where lower(coalesce(stage, data->>'stage', '')) like '%qualified%')::int as qualified
      from app_leads
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
        count(*) filter (where lower(coalesce(status, data->>'status', '')) ~ '(new|draft|pending|submitted)')::int as new
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

async function loadBootstrapDb() {
  if (!postgresPool || !usesPostgresStorage()) return loadDb();
  await ensureStorage();
  const emailLimit = Math.max(1, Math.min(Number(process.env.BOOTSTRAP_EMAIL_LIMIT || 50), 50));
  const data = await loadPostgresTables({
    leadLimit: Math.max(25, Number(process.env.BOOTSTRAP_LEAD_LIMIT || 25)),
    taskLimit: Math.max(25, Number(process.env.BOOTSTRAP_TASK_LIMIT || 25)),
    emailLimit: emailLimit + 1,
    eventLimit: Math.max(5, Number(process.env.BOOTSTRAP_EVENT_LIMIT || 10)),
    auditLimit: Math.max(25, Number(process.env.BOOTSTRAP_AUDIT_LIMIT || 25)),
    skipApplications: true,
    skipAudit: true,
    skipAttribution: true
  });
  if (!data) return loadDb();
  const hasMoreEmails = data.emails.length > emailLimit;
  data.emails = data.emails.slice(0, emailLimit);
  data.emails = data.emails.map(publicEmailSummary);
  data.email_paging = {
    loaded: data.emails.length,
    next_cursor: hasMoreEmails ? encodeEmailCursor(data.emails[data.emails.length - 1]) : '',
    limit: emailLimit,
    has_more: hasMoreEmails
  };
  return recalculate(data);
}

async function loadEmailPage(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 50));
  const cursor = decodeEmailCursor(options.cursor);
  const filters = {
    status: String(options.status || '').trim(),
    label: String(options.label || '').trim(),
    search: String(options.search || '').trim(),
    day: String(options.day || '').trim(),
    dateField: String(options.date_field || options.dateField || 'received').trim() === 'due' ? 'due' : 'received',
    sort: String(options.sort || 'newest').trim()
  };
  const hasFilters = Boolean(filters.status || filters.label || filters.search || filters.day || filters.dateField === 'due' || filters.sort !== 'newest');
  await ensureStorage();
  if (hasFilters) {
    const db = postgresPool ? {
      gmail: (await postgresPool.query(`select gmail from app_workspace where id = $1`, ['main'])).rows[0]?.gmail || {}
    } : await loadDb();
    const rows = postgresPool
      ? (await postgresPool.query(`select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id`)).rows.map(item => item.data)
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
    const total = Number((await postgresPool.query(`select count(*)::int as total from app_emails`)).rows[0]?.total || 0);
    const result = cursor
      ? await postgresPool.query(
        `select ${emailSummaryDataSql()} as data from app_emails
         where (
           ($2::timestamptz is not null and (received_at < $2::timestamptz or (received_at = $2::timestamptz and id > $3) or received_at is null))
           or ($2::timestamptz is null and received_at is null and id > $3)
         )
         order by received_at desc nulls last, id
         limit $1`,
        [limit + 1, cursor.received_at ? cursor.received_at.toISOString() : null, cursor.id]
      )
      : await postgresPool.query(
        `select ${emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id limit $1`,
        [limit + 1]
      );
    const rows = result.rows.map(item => item.data);
    const emails = rows.slice(0, limit).map(publicEmailSummary);
    return {
      emails,
      total,
      loaded: emails.length,
      next_cursor: rows.length > limit ? encodeEmailCursor(emails[emails.length - 1]) : '',
      limit,
      has_more: rows.length > limit
    };
  }
  const db = await loadDb();
  const rows = (db.emails || [])
    .slice()
    .sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
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
    `select id, name, email, role, password_hash, temporary_password, invited_at, password_changed_at from ${table} order by created_at, id`
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
      temporary_password: password,
      invited_at: new Date().toISOString(),
      password_changed_at: null
    };
    await upsertPostgresUsers([user]);
    dbCache = null;
    return { ok: true, user: publicUser(user), temporary_password: password };
  }
  const db = await loadDb();
  if (db.users.some(item => normalizeEmail(item.email) === email)) throw statusError(400, 'A user with this email already exists.');
  const user = { id: nextId('U', [db.users]), name, email, role, password_hash: hashPassword(password), temporary_password: password, invited_at: new Date().toISOString(), password_changed_at: null };
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
       set password_hash = $2, temporary_password = $3, password_changed_at = null, invited_at = coalesce(invited_at, now()), updated_at = now()
       where id = $1
       returning id, name, email, role, temporary_password, invited_at, password_changed_at`,
      [userId, hashPassword(password), password]
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
  target.temporary_password = password;
  target.password_changed_at = null;
  target.invited_at ||= new Date().toISOString();
  await clearUserSessions(target.id);
  addAudit(db, actor, 'Team member password reset', 'user', target.email);
  await saveDb(db);
  return { ok: true, user: publicUser(target), temporary_password: password };
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
      `update ${table} set role = $2, updated_at = now() where id = $1 returning id, name, email, role, temporary_password, invited_at, password_changed_at`,
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
      temporary_password: user.temporary_password || ''
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
  return (db.applications || [])
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

async function loadApplicationListDb() {
  await ensureStorage();
  if (postgresPool) {
    const result = await postgresPool.query(`select data from app_applications order by created_at desc nulls last, id`);
    return result.rows.map(item => publicApplication(item.data));
  }
  return loadApplicationList(await loadDb());
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
  await ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 2000), 5000));
  if (postgresPool) {
    const result = await postgresPool.query(
      `select data
       from app_events
       where coalesce(data->>'zoom_meeting_id', '') <> ''
          or coalesce(data->>'zoom_meeting_uuid', '') <> ''
          or lower(coalesce(location, data->>'location', '')) = 'zoom'
          or lower(coalesce(campaign, data->>'campaign', '')) like 'zoom%'
       order by start_at desc nulls last, id
       limit $1`,
      [safeLimit]
    );
    return result.rows.map(item => item.data);
  }
  return (await loadDb()).events
    .filter(isZoomEventRecord)
    .sort((a, b) => new Date(b.start_at || 0) - new Date(a.start_at || 0))
    .slice(0, safeLimit);
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

async function fetchJson(url, options = {}) {
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

function eventbriteAccessToken(db) {
  if (eventbritePrivateTokenConfigured()) return process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!db.eventbrite?.access_token) throw statusError(400, 'Eventbrite is not connected.');
  return db.eventbrite.access_token;
}

async function refreshGmailToken(db) {
  if (!db.gmail?.refresh_token) throw statusError(400, 'Gmail is not connected.');
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: db.gmail.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  db.gmail.access_token = token.access_token;
  db.gmail.expires_at = Date.now() + ((token.expires_in || 3600) - 60) * 1000;
  await saveGmailImportTables(db, { leadIds: [], taskIds: [], emailIds: [], auditIds: [], preserveEventbrite: true });
  return db.gmail.access_token;
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
  const quotaResponse = async () => {
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
    return { imported, imported_inbox: importedInbox, imported_sent: importedSent, labels_refreshed: labelsRefreshed, scanned, restored, ...historyResult, ...trashResult, since: GMAIL_INCREMENTAL_ONLY ? db.gmail.incremental_started_at : '2026-01-01', has_more: !latestOnly && Boolean(pageTokens.inbox || pageTokens.sent), quota_limited: true, retry_after_ms: 70000, last_sync_at: db.gmail.last_sync_at };
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
  return { imported, imported_inbox: importedInbox, imported_sent: importedSent, replies_resolved: repliesResolved, labels_refreshed: labelsRefreshed, scanned, restored, ...historyResult, ...trashResult, since: GMAIL_INCREMENTAL_ONLY ? db.gmail.incremental_started_at : '2026-01-01', has_more: !latestOnly && Boolean(pageTokens.inbox || pageTokens.sent), last_sync_at: db.gmail.last_sync_at };
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
        await saveEventImportTables(db, { preserveGmail: true, deleteEventIds: results.eventbrite.deleted_event_ids || [] });
      } catch (error) {
        results.eventbrite = { error: error.message || 'Eventbrite sync failed.' };
      }
    } else {
      results.eventbrite = { skipped: true, reason: 'Eventbrite is not configured.' };
    }
    if (EVENTS_SHEET_URL) {
      try {
        results.sheet = await importSpreadsheetEvents(db, user, { filename: 'auto-events-sheet', google_url: EVENTS_SHEET_URL });
        await saveEventImportTables(db, { preserveGmail: true });
      } catch (error) {
        results.sheet = { error: error.message || 'Sheet sync failed.' };
      }
    } else {
      results.sheet = { skipped: true, reason: 'EVENTS_SHEET_URL is not configured.' };
    }
    if (zoomConfigured()) {
      try {
        results.zoom = await importZoomMeetings(db, user, Number(process.env.ZOOM_MAX_MEETINGS || 500), { save: false });
        await saveEventImportTables(db, { preserveGmail: true });
      } catch (error) {
        results.zoom = { error: error.message || 'Zoom sync failed.' };
      }
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

function startAutoSync() {
  if (!GMAIL_AUTO_SYNC_ENABLED && !EVENT_AUTO_SYNC_ENABLED) {
    gmailAutoSyncState = { ...gmailAutoSyncState, enabled: false, mode: GMAIL_AUTO_SYNC_MODE, daily_time: GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
    eventAutoSyncState = { ...eventAutoSyncState, enabled: false, running: false, next_run_at: null };
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
  addAudit(db, user, 'Events imported from Excel', 'integration', 'Excel', `${eventMap.size} events, ${importedAttendees} attendees, ${linkedLeads} linked leads`);
  return { imported_events: importedEvents, updated_events: eventMap.size - importedEvents, imported_attendees: importedAttendees, linked_leads: linkedLeads };
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
  addAudit(db, user, 'Eventbrite synced', 'integration', 'Eventbrite', `${importedEvents} events, ${importedAttendees} attendees${deletedEventIds.size ? `, ${deletedEventIds.size} removed` : ''}${attendeeErrors ? `, ${attendeeErrors} attendee import warnings` : ''}`);
  if (options.save !== false) await saveDb(db);
  return { imported_events: importedEvents, imported_attendees: importedAttendees, deleted_events: deletedEventIds.size, deleted_event_ids: [...deletedEventIds], deletion_scan_complete: eventbriteIdScanComplete, scanned: events.length, attendee_errors: attendeeErrors, last_sync_at: db.eventbrite.last_sync_at };
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

function zoomCallParty(call = {}, role = 'caller') {
  const regex = role === 'caller' ? /caller|from|source/i : /callee|to|target|destination/i;
  return zoomCallParticipants(call).find(item => regex.test(`${item.role || ''} ${item.type || ''} ${item.direction || ''}`)) || {};
}

function normalizeZoomCallRecord(db, account, call = {}) {
  const caller = zoomCallParty(call, 'caller');
  const callee = zoomCallParty(call, 'callee');
  const callerNumber = String(zoomCallField(call, 'caller_number', 'from.phone_number', 'caller.phone_number') || caller.phone_number || caller.number || '').trim();
  const calleeNumber = String(zoomCallField(call, 'callee_number', 'to.phone_number', 'callee.phone_number') || callee.phone_number || callee.number || '').trim();
  const startedAt = zoomCallField(call, 'start_time', 'date_time', 'startTime', 'call_start_time', 'answer_start_time') || new Date().toISOString();
  const callKey = String(call.call_history_uuid || call.call_history_id || call.call_id || call.id || [startedAt, callerNumber, calleeNumber, call.duration].join('|'));
  const record = {
    id: `ZC-${numericHash(`${account.accountId}|${callKey}`)}`,
    zoom_call_id: String(call.call_id || callKey),
    zoom_call_history_uuid: String(call.call_history_uuid || call.call_history_id || call.id || ''),
    zoom_account_id: account.accountId,
    zoom_account_label: account.label,
    started_at: startedAt,
    direction: String(call.direction || call.call_direction || '').toLowerCase() || 'unknown',
    result: String(call.result || call.call_result || call.disposition || call.status || ''),
    duration: Number(call.duration || call.talk_time || call.total_duration || 0),
    caller_name: String(zoomCallField(call, 'caller_name', 'from.name', 'caller.name') || caller.name || ''),
    caller_number: callerNumber,
    callee_name: String(zoomCallField(call, 'callee_name', 'to.name', 'callee.name') || callee.name || ''),
    callee_number: calleeNumber,
    owner_name: String(call.owner?.name || call.user_name || call.extension_name || ''),
    site_name: String(call.site?.name || ''),
    path: String(call.path || call.connect_type || call.call_type || ''),
    raw: call
  };
  const lead = leadForZoomCall(db, record);
  if (lead) {
    record.lead_id = lead.id;
    record.lead_name = fullName(lead);
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
  const existing = new Map((db.zoom.calls || []).map(call => [call.id, call]));
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
  addAudit(db, user, 'Zoom calls synced', 'integration', 'Zoom Phone', `${importedCalls} created, ${updatedCalls} updated, ${scanned} scanned across ${accounts.length} accounts`);
  if (options.save !== false) await saveDb(db);
  return {
    imported_calls: importedCalls,
    updated_calls: updatedCalls,
    scanned,
    accounts: accounts.length,
    call_history_months: zoomCallHistoryMonths(options),
    warnings: [...new Set(warnings.filter(Boolean))],
    last_sync_at: db.zoom.last_call_sync_at
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
  addAudit(db, user, 'Meta leads synced', 'integration', 'Meta', `${imported} new leads from ${forms.length} forms`);
  await saveDb(db);
  return { imported, scanned, forms: forms.length, last_sync_at: db.meta.last_sync_at };
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
  addAudit(db, user, 'Apollo prospects synced', 'integration', 'Apollo', `${imported} created, ${updated} updated, ${scanned} scanned`);
  await saveDb(db);
  return { imported, updated, scanned, last_sync_at: db.apollo.last_sync_at };
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
        resolve(JSON.parse(body));
      } catch {
        reject(statusError(400, 'Invalid JSON body.'));
      }
    });
  });
}

function sendJson(res, value, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}

function sessionCookie(req, sid, maxAge = SESSION_TTL / 1000) {
  const secure = requestIsSecure(req) ? '; Secure' : '';
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function recordApiError(req, error) {
  const status = error.status || 500;
  monitoringState.api_errors.unshift({
    occurred_at: new Date().toISOString(),
    route: (() => {
      try { return new URL(req.url, `http://${req.headers.host}`).pathname; }
      catch { return req.url || ''; }
    })(),
    method: req.method,
    status,
    message: error.message || 'Server error.'
  });
  monitoringState.api_errors = monitoringState.api_errors.slice(0, 25);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return sendJson(res, { error: 'Not found.' }, 404);
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, { error: 'Not found.' }, 404);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;
  const method = req.method;
  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : {};

  if (route === '/api/health' && method === 'GET') return sendJson(res, { demo: false, storage: storageMode() });
  if (route === '/api/signup') throw statusError(404, 'Sign up is disabled. Ask the developer to invite your account.');
  const publicRoutes = new Set(['/api/login', '/api/password/forgot', '/api/password/reset']);
  if (!publicRoutes.has(route) && !parseCookies(req).sid) throw statusError(401, 'Sign in to continue.');
  let lightweightMatch = null;
  if (route === '/api/login' && method === 'POST') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!email || !password) throw statusError(400, 'Email and password are required.');
    let user = await findLoginUser(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      user = await forceConfiguredDeveloperLogin(email, password);
    }
    if (!user || !verifyPassword(password, user.password_hash)) {
      if (isDeveloperEmail(email) && !developerPasswordConfigured()) {
        throw statusError(500, 'Developer password is not configured on this deployment. Add DEV_PANEL_PASSWORD and redeploy.');
      }
      throw statusError(401, 'Email or password is incorrect.');
    }
    const sid = await createSession(user);
    sendJson(res, { ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionCookie(req, sid) });
    recordPostgresLogin(user, req).catch(error => console.error(`Login audit failed: ${error.message || error}`));
    return;
  }
  if (route === '/api/bootstrap' && method === 'GET') {
    const user = await currentSessionUser(req);
    const db = await loadBootstrapDb();
    const payload = bootstrap(db, user);
    payload.marketing = null;
    return sendJson(res, payload);
  }
  if (route === '/api/dashboard/summary' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadDashboardSummaryDb());
  }
  if (route === '/api/leads' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadLeadPage({
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
      search: url.searchParams.get('search'),
      stage: url.searchParams.get('stage'),
      owner_id: url.searchParams.get('owner_id'),
      programme_id: url.searchParams.get('programme_id')
    }));
  }
  if (route === '/api/developer/config' && method === 'GET') {
    const user = await currentSessionUser(req);
    requireDeveloperAccess(req, user);
    return sendJson(res, developerConfig(req, await loadDeveloperConfigDb()));
  }
  lightweightMatch = route.match(/^\/api\/emails\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadEmailDetail(lightweightMatch[1]));
  }
  if (route === '/api/emails' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, await loadEmailPage({
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
      label: url.searchParams.get('label'),
      search: url.searchParams.get('search'),
      day: url.searchParams.get('day'),
      date_field: url.searchParams.get('date_field'),
      sort: url.searchParams.get('sort')
    }));
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
    await currentSessionUser(req);
    return sendJson(res, { applications: await loadApplicationListDb() });
  }
  if (route === '/api/zoom/events' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, { events: await loadZoomEventListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/audit' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, { audit: await loadAuditListDb(url.searchParams.get('limit')) });
  }
  if (route === '/api/attribution' && method === 'GET') {
    await currentSessionUser(req);
    return sendJson(res, { attribution: await loadAttributionListDb(url.searchParams.get('limit')) });
  }
  const db = await loadDb();
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
  if (route === '/api/password/reset' && method === 'POST') {
    if (!postgresPool) throw statusError(500, 'Password reset requires Neon/PostgreSQL storage.');
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!token || !password) throw statusError(400, 'Reset token and new password are required.');
    if (password.length < 8) throw statusError(400, 'Password must be at least 8 characters.');
    const resetsTable = sqlIdentifier(POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
    const result = await postgresPool.query(
      `select * from ${resetsTable} where token_hash = $1 and used_at is null and expires_at > now() order by created_at desc limit 1`,
      [tokenHash(token)]
    );
    const reset = result.rows[0];
    if (!reset) throw statusError(400, 'This reset link is invalid or expired.');
    const user = db.users.find(item => item.id === reset.user_id);
    if (!user) throw statusError(400, 'This reset link is invalid or expired.');
    user.password_hash = hashPassword(password);
    user.temporary_password = '';
    user.password_changed_at = new Date().toISOString();
    await saveDb(db);
    await postgresPool.query(`update ${resetsTable} set used_at = now() where user_id = $1 and used_at is null`, [user.id]);
    await clearUserSessions(user.id);
    return sendJson(res, { ok: true });
  }
  const user = await currentSessionUser(req);
  if (route === '/api/logout' && method === 'POST') {
    const sid = parseCookies(req).sid;
    await deleteSession(sid);
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (route === '/api/developer/config' && method === 'GET') {
    requireDeveloperAccess(req, user);
    return sendJson(res, developerConfig(req, recalculate(db)));
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
      background_jobs: {
        gmail: gmailAutoSyncState,
        events: eventAutoSyncState
      },
      audit_24h: (db.audit || []).filter(item => new Date(item.occurred_at || 0) >= since).length
    });
  }
  if (route === '/api/bootstrap' && method === 'GET') {
    const changed = runIdentityCleanupInMemory(db, user);
    const payload = bootstrap(db, user);
    payload.marketing = await loadMarketingSummary();
    sendJson(res, payload);
    if (!changed) scheduleIdentityCleanup(db, user);
    return;
  }
  if (route === '/api/integrations/gmail/status' && method === 'GET') {
    return sendJson(res, {
      configured: gmailConfigured(),
      connected: Boolean(db.gmail?.connected),
      email: db.gmail?.email || null,
      last_sync_at: db.gmail?.last_sync_at || null,
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
    if (!session || !session.gmail_state || session.gmail_state !== url.searchParams.get('state')) throw statusError(401, 'Gmail connection session expired. Sign in and try again.');
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
      imported_message_ids: db.gmail?.imported_message_ids || []
    };
    addAudit(db, user, 'Gmail connected', 'integration', 'Gmail', db.gmail.email);
    await saveDb(db);
    res.writeHead(302, { Location: '/#/settings' });
    return res.end();
  }
  if (route === '/api/integrations/gmail/sync' && method === 'POST') {
    if (!GMAIL_IMPORT_ENABLED) throw statusError(403, 'Gmail import is paused. Existing emails remain available.');
    const result = await importGmailMessages(db, user, Number(body.max_results || 10), {
      latest: body.latest === undefined ? true : Boolean(body.latest),
      skipTrash: Boolean(body.skip_trash),
      forceTrash: Boolean(body.force_trash)
    });
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
    if (!session || !session.eventbrite_state || session.eventbrite_state !== url.searchParams.get('state')) throw statusError(401, 'Eventbrite connection session expired. Sign in and try again.');
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
    await saveEventImportTables(db, { preserveGmail: true, deleteEventIds: result.deleted_event_ids || [] });
    return sendJson(res, result);
  }
  if (route === '/api/events/import' && method === 'POST') {
    if (!permissions(user.role).sales) throw statusError(403, 'You do not have permission to import events.');
    const result = await importSpreadsheetEvents(db, user, body);
    await saveEventImportTables(db, { preserveGmail: true });
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
      last_sync_at: db.zoom?.last_sync_at || null
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
      .slice()
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
    addAudit(db, user, result.created ? 'Lead created' : 'Lead updated from duplicate submission', 'lead', result.lead.id);
    await saveDb(db);
    return sendJson(res, { id: result.lead.id, created: result.created }, result.created ? 201 : 200);
  }
  if (match && method === 'PATCH') {
    const lead = leadFor(db, match[1]);
    Object.assign(lead, { stage: body.stage, owner_id: body.owner_id, priority: body.priority });
    addAudit(db, user, 'Opportunity updated', 'lead', lead.id, body.reason);
    await saveDb(db);
    return sendJson(res, { ok: true });
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
    lead.stage = 'Application Submitted';
    db.applications.push({ id: nextId('A', [db.applications]), lead_id: lead.id, first_name: lead.first_name, last_name: lead.last_name, programme: lead.programme, intake: intake?.name || 'Next intake', status: 'In review', manager: user.name, member: lead.first_name, created_at: new Date().toISOString(), contract: { status: 'Draft' }, requirements: [{ id: nextId('R', [db.applications.flatMap(app => app.requirements)]), title: 'Proof of right to work', latest: null }, { id: nextId('R', [db.applications.flatMap(app => app.requirements), ['R-99']]), title: 'Employer sponsorship form', latest: null }], learner: null });
    addAudit(db, user, 'Application started', 'lead', lead.id);
    await saveDb(db);
    return sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/applications\/([^/]+)\/evidence$/);
  if (match && method === 'POST') {
    const app = appFor(db, match[1]);
    const req = app.requirements.find(item => item.id === body.requirement_id);
    if (!req) throw statusError(404, 'Requirement not found.');
    req.latest = { id: nextId('ER', [db.applications.flatMap(a => a.requirements.map(r => r.latest).filter(Boolean))]), filename: body.filename, version: (req.latest?.version || 0) + 1, status: 'Pending', reviewer: null, content_base64: body.content_base64 };
    app.status = 'In review';
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

  if (route === '/api/password' && method === 'POST') {
    if (!verifyPassword(body.current_password || '', user.password_hash)) throw statusError(400, 'Current password is incorrect.');
    user.password_hash = hashPassword(body.new_password || '');
    user.temporary_password = '';
    user.password_changed_at = new Date().toISOString();
    await saveDb(db);
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  throw statusError(404, 'API route not found.');
}

const server = http.createServer(async (req, res) => {
  try {
    if (new URL(req.url, `http://${req.headers.host}`).pathname.startsWith('/api/')) return await handleApi(req, res);
    return serveStatic(req, res);
  } catch (error) {
    if (new URL(req.url, `http://${req.headers.host}`).pathname.startsWith('/api/')) recordApiError(req, error);
    sendJson(res, { error: error.message || 'Server error.' }, error.status || 500);
  }
});

if (process.env.NEST_COMPAT_MODE !== 'true') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Kent Business College backend running on port ${PORT}`);
    startAutoSync();
  });
}

module.exports = {
  handleApi,
  serveStatic,
  startAutoSync,
  server,
  loadDb,
  saveDb,
  saveEventImportTables,
  saveGmailImportTables,
  importSpreadsheetEvents,
  importEventbriteEvents,
  importZoomMeetings,
  importZoomCalls,
  importGmailMessages,
  ensureProgrammeCatalog,
  programmeForText,
  programmeForEvent,
  recalculate
};
