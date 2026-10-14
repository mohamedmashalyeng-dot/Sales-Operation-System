'use strict';

const fs = require('node:fs');
const Config = require('./config');
const State = require('./state');
const Http = require('./http');
const Perf = require('./perf');
const Auth = require('./auth');
const Workspace = require('./workspace');
const Audit = require('./audit');
const Programmes = require('./programmes');
const Leads = require('./leads');
const Tasks = require('./tasks');
const Emails = require('./emails');
const Events = require('./events');
const Applications = require('./applications');
const Monitoring = require('./monitoring');
const Zoom = require('./integrations/zoom');
const Zoho = require('./integrations/zoho');
const Dashboard = require('./dashboard');

let mongoClient = null;
let mongoStateCollection = null;
let postgresPoolWarmup = null;
let postgresSchemaReady = false;
let storageReady = null;
// When the cache was last filled from storage. Other processes (background workers,
// a second server sharing the same DATABASE_URL) write straight to the tables, so the
// cache must expire or those rows never become visible here.
let dbCacheLoadedAt = 0;
// Row ids present in the last full Postgres load, per table. Saves only delete rows
// that were loaded and then removed, never rows another writer inserted meanwhile.
const postgresLoadedIds = new Map();

function usesMongoStorage() {
  return /^mongodb(\+srv)?:\/\//i.test(Config.DATABASE_URL);
}

function usesPostgresStorage() {
  return /^postgres(ql)?:\/\//i.test(Config.DATABASE_URL);
}

function storageMode() {
  if (usesPostgresStorage()) return 'postgres';
  return usesMongoStorage() ? 'mongodb' : 'json-file';
}

function postgresSslMode(value) {
  try {
    return String(new URL(value).searchParams.get('sslmode') || '').toLowerCase();
  } catch {
    return '';
  }
}

function postgresUsesLibpqCompatSsl(value) {
  try {
    return String(new URL(value).searchParams.get('uselibpqcompat') || '').toLowerCase() === 'true';
  } catch {
    return false;
  }
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
  if (!Config.DATABASE_URL || !usesPostgresStorage()) return meta;
  try {
    const parsed = new URL(Config.DATABASE_URL);
    const host = parsed.hostname;
    meta.host_kind = /neon\.tech$/i.test(host) ? 'neon' : host ? 'other' : '';
    const sslMode = postgresSslMode(Config.DATABASE_URL);
    meta.ssl_configured = Boolean(sslMode && sslMode !== 'disable' && sslMode !== 'allow');
    meta.pooled_endpoint = /pooler|pool|pooled/i.test(host);
    const region = host.match(/\b([a-z]+-[a-z]+-\d)\b/i);
    meta.host_region_hint = region ? region[1] : '';
  } catch {}
  meta.pool_max = State.postgresPool?.options?.max || 10;
  meta.idle_timeout_ms = State.postgresPool?.options?.idleTimeoutMillis || Config.POSTGRES_POOL_IDLE_TIMEOUT_MS;
  meta.connection_timeout_ms = State.postgresPool?.options?.connectionTimeoutMillis || Config.POSTGRES_POOL_CONNECTION_TIMEOUT_MS;
  return meta;
}

function postgresPoolStats() {
  if (!State.postgresPool) return { max: Config.POSTGRES_POOL_MAX, totalCount: 0, idleCount: 0, waitingCount: 0 };
  return {
    max: State.postgresPool.options?.max || Config.POSTGRES_POOL_MAX,
    totalCount: State.postgresPool.totalCount,
    idleCount: State.postgresPool.idleCount,
    waitingCount: State.postgresPool.waitingCount
  };
}

function warmPostgresPool(target = Config.POSTGRES_POOL_WARM_CONNECTIONS) {
  if (!State.postgresPool || target <= 0) return Promise.resolve();
  if (postgresPoolWarmup) return postgresPoolWarmup;
  postgresPoolWarmup = (async () => {
    const clients = [];
    try {
      await Promise.all(Array.from({ length: target }, async () => {
        const client = await State.postgresPool.connect();
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
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw Http.statusError(500, `Invalid SQL identifier: ${identifier}`);
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function connectMongoStorage() {
  if (mongoStateCollection) return mongoStateCollection;
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch {
    throw Http.statusError(500, 'DATABASE_URL is set for MongoDB, but the mongodb package is not installed. Run npm install and restart the backend.');
  }
  mongoClient = new MongoClient(Config.DATABASE_URL);
  await mongoClient.connect();
  mongoStateCollection = mongoClient.db(Config.DATABASE_NAME).collection(Config.MONGO_STATE_COLLECTION);
  return mongoStateCollection;
}

async function getPostgresPool() {
  if (State.postgresPool) return State.postgresPool;
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    throw Http.statusError(500, 'DATABASE_URL is set for PostgreSQL/Neon, but the pg package is not installed. Run npm install and restart the backend.');
  }
  State.postgresPool = new Pool({
    connectionString: Config.DATABASE_URL,
    ssl: postgresSslMode(Config.DATABASE_URL) === 'require' && !postgresUsesLibpqCompatSsl(Config.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: Config.POSTGRES_POOL_MAX,
    idleTimeoutMillis: Config.POSTGRES_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: Config.POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30000
  });
  wrapPostgresPoolQuery(State.postgresPool);
  State.postgresPool.on('error', error => {
    console.error(`Postgres idle connection error: ${error.message || error}`);
  });
  State.postgresPool.on('connect', client => {
    client.on('error', error => {
      console.error(`Postgres client connection error: ${error.message || error}`);
    });
  });
  warmPostgresPool().catch(() => null);
  return State.postgresPool;
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
        if (!postgresConnectionLost(error) || attempt > 0 || pool !== State.postgresPool) throw error;
        console.error(`Postgres pool query connection lost; reconnecting: ${error.message || error}`);
        await resetPostgresPool();
        await getPostgresPool();
        return State.postgresPool.query(sql, params);
      }
    }
    throw lastError;
  };
  return pool;
}

async function resetPostgresPool() {
  const pool = State.postgresPool;
  State.postgresPool = null;
  postgresPoolWarmup = null;
  postgresSchemaReady = false;
  State.postgresUserSchemaReady = false;
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
      return await State.postgresPool.query(sql, params);
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
  await Auth.ensurePostgresUserSchema(trace);
  if (String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') {
    await Leads.refreshLeadSoftDelete(trace, { force: true });
    postgresSchemaReady = true;
    return State.postgresPool;
  }
  if (postgresSchemaReady) {
    postgresSchemaReady = true;
    return State.postgresPool;
  }
  const table = sqlIdentifier(Config.POSTGRES_STATE_TABLE, 'app_state');
  const usersTable = sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const loginEventsTable = sqlIdentifier(Config.POSTGRES_LOGIN_EVENTS_TABLE, 'app_login_events');
  const passwordResetsTable = sqlIdentifier(Config.POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
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
  await Leads.refreshLeadSoftDelete(trace, { force: true });
  postgresSchemaReady = true;
  return State.postgresPool;
}

async function ensureStorage(trace = null) {
  if (!Config.DATABASE_URL) return null;
  if (usesPostgresStorage()) {
    storageReady ||= connectPostgresStorage(trace);
    return storageReady;
  }
  if (!usesMongoStorage()) throw Http.statusError(500, 'Unsupported DATABASE_URL. Use a PostgreSQL/Neon URL that starts with postgresql:// or a MongoDB URL that starts with mongodb:// or mongodb+srv://.');
  storageReady ||= connectMongoStorage();
  return storageReady;
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
  await tracedPostgresPoolQuery(trace, 'schema_notifications_table', `
    create table if not exists app_notifications (
      id text primary key,
      user_id text not null,
      type text not null,
      title text not null,
      message text,
      priority text not null default 'normal',
      entity_type text,
      entity_id text,
      route text,
      read_at timestamptz,
      created_at timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_notifications_user_read_created_index', `create index if not exists app_notifications_user_read_created_idx on app_notifications(user_id, read_at, created_at desc, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_notifications_user_created_index', `create index if not exists app_notifications_user_created_idx on app_notifications(user_id, created_at desc, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_saved_views_table', `
    create table if not exists app_saved_views (
      id text primary key,
      user_id text not null,
      entity_type text not null,
      name text not null,
      filters jsonb not null default '{}'::jsonb,
      sort text,
      is_default boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      data jsonb not null default '{}'::jsonb
    )
  `);
  await tracedPostgresPoolQuery(trace, 'schema_saved_views_user_entity_index', `create index if not exists app_saved_views_user_entity_idx on app_saved_views(user_id, entity_type, updated_at desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_table', Monitoring.monitoringSnapshotSchemaSql());
  await tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_expires_index', Monitoring.monitoringSnapshotExpiresIndexSql());
  await Zoho.ensureZohoRecordsTable(State.postgresPool, trace);
  await tracedPostgresPoolQuery(trace, 'schema_leads_stage_index', `create index if not exists app_leads_stage_idx on app_leads(stage)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_owner_id_index', `create index if not exists app_leads_owner_id_idx on app_leads(owner_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_created_at_index', `create index if not exists app_leads_created_at_idx on app_leads(created_at)`);
  // Dashboard date ranges read leads through this function and its index (see Dashboard.leadCapturedAtFunctionSql).
  await tracedPostgresPoolQuery(trace, 'schema_lead_captured_at_function', Dashboard.leadCapturedAtFunctionSql());
  await tracedPostgresPoolQuery(trace, 'schema_leads_captured_at_index', `create index if not exists app_leads_captured_at_idx on app_leads (kbc_lead_captured_at(data, created_at))`);
  // Serves the Leads list keyset pagination (ORDER BY created_at DESC, id DESC).
  await tracedPostgresPoolQuery(trace, 'schema_leads_cursor_index', `create index if not exists idx_app_leads_cursor on app_leads(created_at desc, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_lead_id_index', `create index if not exists app_tasks_lead_id_idx on app_tasks(lead_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_status_index', `create index if not exists app_tasks_status_idx on app_tasks(status)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_due_at_index', `create index if not exists app_tasks_due_at_idx on app_tasks(due_at)`);
  // Planner lists open tasks by due date and done tasks by completion (GET /api/tasks).
  await tracedPostgresPoolQuery(trace, 'schema_tasks_status_due_index', `create index if not exists app_tasks_status_due_idx on app_tasks(status, due_at, id)`);
  await tracedPostgresPoolQuery(trace, 'schema_tasks_owner_status_due_index', `create index if not exists app_tasks_owner_status_due_idx on app_tasks(owner_id, status, due_at)`);
  // The "all" and "done" task pages are ordered by this expression, newest first.
  await tracedPostgresPoolQuery(trace, 'schema_tasks_recent_index', `create index if not exists app_tasks_recent_idx on app_tasks ((coalesce(completed_at, due_at)) desc nulls last, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_applications_lead_id_index', `create index if not exists app_applications_lead_id_idx on app_applications(lead_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_applications_status_index', `create index if not exists app_applications_status_idx on app_applications(status)`);
  await tracedPostgresPoolQuery(trace, 'schema_applications_created_at_index', `create index if not exists app_applications_created_at_idx on app_applications(created_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_emails_received_at_index', `create index if not exists app_emails_received_at_idx on app_emails(received_at)`);
  // Holds only the unread emails that are not in the bin (a few dozen rows): the dashboard's
  // unread count reads them here. The condition is the one the dashboard query uses.
  await tracedPostgresPoolQuery(trace, 'schema_emails_unread_index', `create index if not exists app_emails_unread_idx on app_emails (received_at desc) where ${Dashboard.dashboardEmailNotTrashedSql('app_emails')} and ${Dashboard.dashboardEmailUnreadSql('app_emails')}`);
  await tracedPostgresPoolQuery(trace, 'schema_events_start_cursor_index', `create index if not exists app_events_start_cursor_idx on app_events(start_at desc nulls last, id desc)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_programme_id_index', `create index if not exists app_leads_programme_id_idx on app_leads(programme_id)`);
  await tracedPostgresPoolQuery(trace, 'schema_leads_source_capture_index', `create index if not exists app_leads_source_capture_idx on app_leads(source_lead_capture)`);
  await tracedPostgresPoolQuery(trace, 'schema_audit_occurred_at_index', `create index if not exists app_audit_occurred_at_idx on app_audit(occurred_at)`);
  await tracedPostgresPoolQuery(trace, 'schema_audit_entity_id_index', `create index if not exists app_audit_entity_id_idx on app_audit(entity_id)`);
  await ensureIntegrationJobsTable(State.postgresPool, trace);
  await Applications.seedDocumentTemplatesFromDisk();
}
let integrationJobsTableReady = null;

function ensureIntegrationJobsTable(client = State.postgresPool, trace = null) {
  if (!client) return Promise.resolve();
  integrationJobsTableReady ||= createIntegrationJobsTable(client, trace).catch(error => {
    integrationJobsTableReady = null;
    throw error;
  });
  return integrationJobsTableReady;
}

async function createIntegrationJobsTable(client, trace = null) {
  const q = client === State.postgresPool
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

async function loadDb(options = {}) {
  const partialLoad = Boolean(
    options.leadLimit || options.taskLimit || options.emailLimit || options.eventLimit ||
    options.auditLimit || options.skipApplications || options.skipAudit || options.skipAttribution
  );
  if (!partialLoad && State.dbCache && Date.now() - dbCacheLoadedAt < Config.DB_CACHE_TTL_MS) return Workspace.recalculate(cloneDb(State.dbCache));
  if (!partialLoad) {
    State.dbCache = null;
    dbCacheLoadedAt = Date.now();
  }
  await ensureStorage();
  if (State.postgresPool) {
    const normalized = await loadPostgresTables(options);
    if (normalized) {
      if (partialLoad) normalized.__partial_load = true;
      else rememberPostgresLoadedIds(normalized);
      await Auth.removeLegacyPostgresDeveloperUsers();
      const data = Workspace.recalculate(await Auth.hydratePostgresUsers(normalized));
      if (Auth.ensureConfiguredDeveloperUser(data)) await Auth.persistDeveloperBootstrap(data);
      if (!partialLoad) State.dbCache = cloneDb(data);
      return data;
    }
    const table = sqlIdentifier(Config.POSTGRES_STATE_TABLE, 'app_state');
    const legacy = await State.postgresPool.query(`select data from ${table} where id = $1`, ['main']);
    const seeded = legacy.rows[0]?.data ? Workspace.recalculate(legacy.rows[0].data) : Workspace.seedDatabase();
    await saveDb(seeded);
    await Auth.removeLegacyPostgresDeveloperUsers();
    const data = Workspace.recalculate(await Auth.hydratePostgresUsers(seeded));
    if (Auth.ensureConfiguredDeveloperUser(data)) await Auth.persistDeveloperBootstrap(data);
    State.dbCache = cloneDb(data);
    return data;
  }
  if (mongoStateCollection) {
    const record = await mongoStateCollection.findOne({ _id: 'main' });
    if (!record?.data) {
      const seeded = Workspace.seedDatabase();
      Auth.removeLegacyDeveloperUsers(seeded);
      Auth.ensureConfiguredDeveloperUser(seeded);
      await saveDb(seeded);
      State.dbCache = cloneDb(seeded);
      return seeded;
    }
    const data = Workspace.recalculate(record.data);
    const removedLegacy = Auth.removeLegacyDeveloperUsers(data);
    const ensuredDeveloper = Auth.ensureConfiguredDeveloperUser(data);
    const changed = removedLegacy || ensuredDeveloper;
    if (changed) await Auth.persistDeveloperBootstrap(data);
    State.dbCache = cloneDb(data);
    return data;
  }
  if (!fs.existsSync(Config.DATA_DIR)) fs.mkdirSync(Config.DATA_DIR, { recursive: true });
  if (!fs.existsSync(Config.DB_FILE)) await saveDb(Workspace.seedDatabase());
  const data = Workspace.recalculate(JSON.parse(fs.readFileSync(Config.DB_FILE, 'utf8')));
  const removedLegacy = Auth.removeLegacyDeveloperUsers(data);
  const ensuredDeveloper = Auth.ensureConfiguredDeveloperUser(data);
  const changed = removedLegacy || ensuredDeveloper;
  if (changed) await Auth.persistDeveloperBootstrap(data);
  State.dbCache = cloneDb(data);
  return data;
}

async function saveDb(db, options = {}) {
  if (db && (db.__partial || db.__partial_load)) throw Http.statusError(500, 'Refusing to save a partially loaded workspace. Load the full workspace first.');
  await ensureStorage();
  const data = Workspace.recalculate(db);
  if (State.postgresPool) {
    await Auth.upsertPostgresUsers(data.users);
    await savePostgresTables(data, options);
    State.dbCache = cloneDb(data);
    Monitoring.monitoringState.last_save_at = new Date().toISOString();
    return;
  }
  if (mongoStateCollection) {
    await mongoStateCollection.updateOne(
      { _id: 'main' },
      { $set: { data, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
      { upsert: true }
    );
    State.dbCache = cloneDb(data);
    Monitoring.monitoringState.last_save_at = new Date().toISOString();
    return;
  }
  if (!fs.existsSync(Config.DATA_DIR)) fs.mkdirSync(Config.DATA_DIR, { recursive: true });
  fs.writeFileSync(Config.DB_FILE, JSON.stringify(data, null, 2));
  State.dbCache = cloneDb(data);
  Monitoring.monitoringState.last_save_at = new Date().toISOString();
}

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

async function workspaceMetaForSave(client, db = {}, options = {}) {
  let meta = Workspace.workspaceMetaState(db);
  const shouldReadCurrentMeta = options.preserveMeta || options.preserveApollo || options.preserveZoom || options.preserveZoho || Array.isArray(meta.zoom?.calls);
  if (shouldReadCurrentMeta) {
    const current = await client.query(`select meta from app_workspace where id = $1`, ['main']);
    const currentMeta = current.rows[0]?.meta || {};
    if (options.preserveMeta) meta = { ...meta, ...currentMeta };
    if (options.preserveApollo) meta.apollo = currentMeta.apollo || meta.apollo || { imported_person_ids: [] };
    meta.zoho = options.preserveZoho
      ? Zoho.mergeZohoState(meta.zoho || {}, currentMeta.zoho || {})
      : Zoho.mergeZohoState(currentMeta.zoho || {}, meta.zoho || {});
    if (options.preserveZoom) meta.zoom = currentMeta.zoom || meta.zoom || { imported_meeting_ids: [] };
    else meta.zoom = Zoom.mergeZoomState(currentMeta.zoom || {}, meta.zoom || {});
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

function ensureIncrementalStart(container, key) {
  if (!container[key]) container[key] = new Date().toISOString();
  return new Date(container[key]);
}

async function loadPostgresTables(options = {}) {
  await Zoho.ensureZohoRecordsTable();
  const workspace = await State.postgresPool.query(`select * from app_workspace where id = $1`, ['main']);
  if (!workspace.rows[0]) return null;
  const seeded = Workspace.seedDatabase();
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
    State.postgresPool.query(`select data from app_programmes order by id`),
    // Merged leads never enter the in-memory workspace, so legacy dedupe/save paths cannot touch them.
    leadLimit > 0
      ? State.postgresPool.query(`select data from app_leads where ${Leads.activeLeadCondition()} order by created_at desc nulls last, id limit $1`, [leadLimit])
      : State.postgresPool.query(`select data from app_leads where ${Leads.activeLeadCondition()} order by created_at nulls last, id`),
    taskLimit > 0
      ? State.postgresPool.query(`select data from app_tasks order by case when status = 'Open' then 0 else 1 end, due_at nulls last, completed_at desc nulls last, id limit $1`, [taskLimit])
      : State.postgresPool.query(`select data from app_tasks order by due_at nulls last, id`),
    emailLimit > 0
      ? State.postgresPool.query(`select ${Emails.emailSummaryDataSql()} as data from app_emails order by received_at desc nulls last, id limit $1`, [emailLimit])
      : State.postgresPool.query(`select data from app_emails order by received_at desc nulls last, id`),
    options.skipApplications
      ? Promise.resolve({ rows: [] })
      : State.postgresPool.query(`select data from app_applications order by created_at nulls last, id`),
    eventLimit > 0
      ? State.postgresPool.query(`select data from app_events order by start_at desc nulls last, id limit $1`, [eventLimit])
      : State.postgresPool.query(`select data from app_events order by start_at nulls last, id`),
    State.postgresPool.query(`select data from app_intakes order by id`),
    options.skipAudit
      ? Promise.resolve({ rows: [] })
      : auditLimit > 0
      ? State.postgresPool.query(`select data from app_audit order by occurred_at desc nulls last, id limit $1`, [auditLimit])
      : State.postgresPool.query(`select data from app_audit order by occurred_at desc nulls last, id`),
    options.skipAttribution
      ? Promise.resolve({ rows: [] })
      : State.postgresPool.query(`select data from app_attribution order by id desc`),
    State.postgresPool.query(`
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
  const keepMerged = table === 'app_leads' ? ` and ${Leads.activeLeadCondition()}` : '';
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

async function pruneMissingPostgresIds(client, table, ids, options = {}) {
  if (options.pruneMissing === false) return;
  return deleteMissingIds(client, table, ids);
}

async function savePostgresTables(db, options = {}) {
  if (db && (db.__partial || db.__partial_load)) throw Http.statusError(500, 'Refusing full-table sync for a partially loaded workspace.');
  const programmeRows = Programmes.importProgrammeRows(db);
  const intakeRows = (db.intakes || []).map(item => ({ id: item.id, programme_id: item.programme_id || null, name: item.name, data: item }));
  const leadRows = Leads.importLeadRows(db);
  const taskRows = Tasks.importTaskRows(db);
  const emailRows = Emails.importEmailRows(db);
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
  const eventRows = Events.importEventRows(db);
  const auditRows = Audit.importAuditRows(db);
  const attributionRows = (db.attribution || []).map(item => ({
    lead_id: item.id || item.lead_id || null,
    email: Emails.normalizeEmail(item.email),
    programme: item.programme || null,
    data: item
  }));
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const metaState = Workspace.workspaceMetaState(db);
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
      ['main', Boolean(db.demo), Applications.jsonValue(db.stages || []), Applications.jsonValue(db.sources || []), Applications.jsonValue(db.gmail || {}), Applications.jsonValue(db.eventbrite || {}), Applications.jsonValue(metaState)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, level text, data jsonb)
       )
       insert into app_programmes (id, name, level, data)
       select id, name, level, data from rows
       on conflict (id) do update set name = excluded.name, level = excluded.level, data = excluded.data
       where app_programmes.name is distinct from excluded.name
          or app_programmes.level is distinct from excluded.level
          or app_programmes.data is distinct from excluded.data`,
      [Applications.jsonValue(programmeRows)]
    );
    await pruneMissingPostgresIds(client, 'app_programmes', programmeRows.map(item => item.id), options);
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, programme_id text, name text, data jsonb)
       )
       insert into app_intakes (id, programme_id, name, data)
       select id, programme_id, name, data from rows
       on conflict (id) do update set programme_id = excluded.programme_id, name = excluded.name, data = excluded.data
       where app_intakes.programme_id is distinct from excluded.programme_id
          or app_intakes.name is distinct from excluded.name
          or app_intakes.data is distinct from excluded.data`,
      [Applications.jsonValue(intakeRows)]
    );
    await pruneMissingPostgresIds(client, 'app_intakes', intakeRows.map(item => item.id), options);
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
         created_at = excluded.created_at, next_action_at = excluded.next_action_at, data = excluded.data
       where app_leads.person_id is distinct from excluded.person_id
          or app_leads.first_name is distinct from excluded.first_name
          or app_leads.last_name is distinct from excluded.last_name
          or app_leads.email is distinct from excluded.email
          or app_leads.employer is distinct from excluded.employer
          or app_leads.phone is distinct from excluded.phone
          or app_leads.city is distinct from excluded.city
          or app_leads.programme_id is distinct from excluded.programme_id
          or app_leads.programme is distinct from excluded.programme
          or app_leads.level is distinct from excluded.level
          or app_leads.owner_id is distinct from excluded.owner_id
          or app_leads.owner is distinct from excluded.owner
          or app_leads.stage is distinct from excluded.stage
          or app_leads.priority is distinct from excluded.priority
          or app_leads.source_first_touch is distinct from excluded.source_first_touch
          or app_leads.source_lead_capture is distinct from excluded.source_lead_capture
          or app_leads.contact_permission is distinct from excluded.contact_permission
          or app_leads.created_at is distinct from excluded.created_at
          or app_leads.next_action_at is distinct from excluded.next_action_at
          or app_leads.data is distinct from excluded.data`,
      [Applications.jsonValue(leadRows)]
    );
    await pruneMissingPostgresIds(client, 'app_leads', leadRows.map(item => item.id), options);
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
         owner_id = excluded.owner_id, data = excluded.data
       where app_tasks.title is distinct from excluded.title
          or app_tasks.lead_id is distinct from excluded.lead_id
          or app_tasks.kind is distinct from excluded.kind
          or app_tasks.status is distinct from excluded.status
          or app_tasks.due_at is distinct from excluded.due_at
          or app_tasks.completed_at is distinct from excluded.completed_at
          or app_tasks.priority is distinct from excluded.priority
          or app_tasks.owner_id is distinct from excluded.owner_id
          or app_tasks.data is distinct from excluded.data`,
      [Applications.jsonValue(taskRows)]
    );
    await pruneMissingPostgresIds(client, 'app_tasks', taskRows.map(item => item.id), options);
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
         gmail_message_id = excluded.gmail_message_id, data = excluded.data
       where app_emails.lead_id is distinct from excluded.lead_id
          or app_emails.first_name is distinct from excluded.first_name
          or app_emails.last_name is distinct from excluded.last_name
          or app_emails.email is distinct from excluded.email
          or app_emails.subject is distinct from excluded.subject
          or app_emails.body is distinct from excluded.body
          or app_emails.owner is distinct from excluded.owner
          or app_emails.response_at is distinct from excluded.response_at
          or app_emails.response_note is distinct from excluded.response_note
          or app_emails.due_at is distinct from excluded.due_at
          or app_emails.received_at is distinct from excluded.received_at
          or app_emails.gmail_message_id is distinct from excluded.gmail_message_id
          or app_emails.data is distinct from excluded.data`,
      [Applications.jsonValue(emailRows)]
    );
    await pruneMissingPostgresIds(client, 'app_emails', emailRows.map(item => item.id), options);
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
         requirements = excluded.requirements, learner = excluded.learner, data = excluded.data
       where app_applications.lead_id is distinct from excluded.lead_id
          or app_applications.first_name is distinct from excluded.first_name
          or app_applications.last_name is distinct from excluded.last_name
          or app_applications.programme is distinct from excluded.programme
          or app_applications.intake is distinct from excluded.intake
          or app_applications.status is distinct from excluded.status
          or app_applications.manager is distinct from excluded.manager
          or app_applications.member is distinct from excluded.member
          or app_applications.created_at is distinct from excluded.created_at
          or app_applications.contract is distinct from excluded.contract
          or app_applications.requirements is distinct from excluded.requirements
          or app_applications.learner is distinct from excluded.learner
          or app_applications.data is distinct from excluded.data`,
      [Applications.jsonValue(applicationRows)]
    );
    await pruneMissingPostgresIds(client, 'app_applications', applicationRows.map(item => item.id), options);
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
         attendees = excluded.attendees, data = excluded.data
       where app_events.name is distinct from excluded.name
          or app_events.start_at is distinct from excluded.start_at
          or app_events.location is distinct from excluded.location
          or app_events.campaign is distinct from excluded.campaign
          or app_events.capacity is distinct from excluded.capacity
          or app_events.registrations is distinct from excluded.registrations
          or app_events.attendance is distinct from excluded.attendance
          or app_events.attendees is distinct from excluded.attendees
          or app_events.data is distinct from excluded.data`,
      [Applications.jsonValue(eventRows)]
    );
    await pruneMissingPostgresIds(client, 'app_events', eventRows.map(item => item.id), options);
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
         entity = excluded.entity, entity_id = excluded.entity_id, data = excluded.data
       where app_audit.occurred_at is distinct from excluded.occurred_at
          or app_audit.actor is distinct from excluded.actor
          or app_audit.action is distinct from excluded.action
          or app_audit.entity is distinct from excluded.entity
          or app_audit.entity_id is distinct from excluded.entity_id
          or app_audit.data is distinct from excluded.data`,
      [Applications.jsonValue(auditRows)]
    );
    await pruneMissingPostgresIds(client, 'app_audit', auditRows.map(item => item.id), options);
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
        [Applications.jsonValue(attributionRows)]
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
        [Applications.jsonValue(attributionRows)]
      );
    } else {
      await client.query(`delete from app_attribution`);
    }
    await Zoho.upsertZohoRecordRows(client, Zoho.zohoRecordRows(db));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
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
  if (!State.postgresPool || !usesPostgresStorage()) throw Http.statusError(400, 'PostgreSQL storage is not configured.');
  const started = performance.now();
  const result = await State.postgresPool.query(`explain (analyze, buffers, format json) ${sql}`, values);
  const observedMs = performance.now() - started;
  const planJson = result.rows[0]?.['QUERY PLAN'];
  return {
    label,
    observed_ms: Number(observedMs.toFixed(1)),
    ...explainPlanSummary(planJson),
    sql: sqlSummary(sql)
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

async function timedPostgresQuery(trace, label, sql, params = [], attempts = 2) {
  if (!trace) return State.postgresPool.query(sql, params);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const acquireStarted = performance.now();
    let client = null;
    const beforeAcquire = postgresPoolStats();
    try {
      client = await State.postgresPool.connect();
      Perf.perfAdd(trace, `${label}_pool_acquire`, performance.now() - acquireStarted, {
        pool_before: beforeAcquire,
        pool_after: postgresPoolStats(),
        query_name: `${label}_pool_acquire`
      });
      const queryStarted = performance.now();
      const result = await client.query(sql, params);
      Perf.perfAdd(trace, `${label}_query`, performance.now() - queryStarted, {
        rows: result.rowCount ?? result.rows?.length ?? 0,
        sql: sqlSummary(sql),
        sql_full: sql,
        params,
        query_name: label
      });
      Perf.perfCount(trace, 'postgres_queries');
      return result;
    } catch (error) {
      lastError = error;
      Perf.perfAdd(trace, `${label}_error`, performance.now() - acquireStarted);
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
      client = await State.postgresPool.connect();
      Perf.perfAdd(trace, `${label}_pool_acquire`, performance.now() - acquireStarted, {
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
      Perf.perfAdd(trace, `${label}_query`, performance.now() - queryStarted, {
        rows: result.rowCount ?? result.rows?.length ?? 0,
        sql: sqlSummary(sql),
        sql_full: sql,
        params,
        statement_timeout_ms: Math.round(Number(timeoutMs)),
        query_name: label
      });
      Perf.perfCount(trace, 'postgres_queries');
      return result;
    } catch (error) {
      lastError = error;
      try { if (client) await client.query('rollback'); } catch {}
      Perf.perfAdd(trace, `${label}_error`, performance.now() - acquireStarted, {
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

function sqlSummary(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

async function tracedPostgresPoolQuery(trace, label, sql, params = []) {
  const started = performance.now();
  try {
    const result = await State.postgresPool.query(sql, params);
    Perf.perfAdd(trace, `${label}_query`, performance.now() - started, {
      rows: result.rowCount ?? result.rows?.length ?? 0,
      sql: sqlSummary(sql),
      sql_full: sql,
      params,
      query_name: label
    });
    Perf.perfCount(trace, 'postgres_queries');
    return result;
  } catch (error) {
    Perf.perfAdd(trace, `${label}_error`, performance.now() - started, {
      sql: sqlSummary(sql),
      query_name: label
    });
    throw error;
  }
}

exports.usesPostgresStorage = usesPostgresStorage;
exports.storageMode = storageMode;
exports.databaseSafeMetadata = databaseSafeMetadata;
exports.postgresPoolStats = postgresPoolStats;
exports.sqlIdentifier = sqlIdentifier;
exports.getPostgresPool = getPostgresPool;
exports.postgresConnectionLost = postgresConnectionLost;
exports.postgresQuery = postgresQuery;
exports.ensureStorage = ensureStorage;
exports.ensureIntegrationJobsTable = ensureIntegrationJobsTable;
exports.loadDb = loadDb;
exports.saveDb = saveDb;
exports.cloneDb = cloneDb;
exports.workspaceMetaForSave = workspaceMetaForSave;
exports.dbWithSavedMeta = dbWithSavedMeta;
exports.ensureIncrementalStart = ensureIncrementalStart;
exports.explainPostgresQuery = explainPostgresQuery;
exports.nextPostgresId = nextPostgresId;
exports.timedPostgresQuery = timedPostgresQuery;
exports.timedPostgresQueryWithStatementTimeout = timedPostgresQueryWithStatementTimeout;
exports.sqlSummary = sqlSummary;
exports.tracedPostgresPoolQuery = tracedPostgresPoolQuery;
