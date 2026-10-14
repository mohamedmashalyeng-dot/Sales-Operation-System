'use strict';

const crypto = require('node:crypto');
const Config = require('./config');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Workspace = require('./workspace');
const Audit = require('./audit');
const Emails = require('./emails');
const Gmail = require('./integrations/gmail');
const Eventbrite = require('./integrations/eventbrite');
const Zoom = require('./integrations/zoom');
const Meta = require('./integrations/meta');
const Apollo = require('./integrations/apollo');
const Zoho = require('./integrations/zoho');

const memorySessions = new Map();
const postgresSessionUserLookups = new Map();
const postgresSessionUserCache = new Map();
let sessionAuthCacheEpoch = 0;

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
  let user = db.users.find(item => Emails.normalizeEmail(item.email) === config.email);
  if (!user) {
    user = {
      id: Util.nextId('U', [db.users]),
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
  const normalized = Emails.normalizeEmail(email);
  return Config.LEGACY_DEVELOPER_EMAILS.includes(normalized);
}

function removeLegacyDeveloperUsers(db) {
  db.users ||= [];
  const before = db.users.length;
  db.users = db.users.filter(user => !isLegacyDeveloperEmail(user.email));
  return db.users.length !== before;
}

async function removeLegacyPostgresDeveloperUsers() {
  if (!State.postgresPool || !Config.LEGACY_DEVELOPER_EMAILS.length) return false;
  const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const emails = Config.LEGACY_DEVELOPER_EMAILS
    .map(Emails.normalizeEmail)
    .filter(Boolean);
  if (!emails.length) return false;
  const result = await State.postgresPool.query(`delete from ${table} where lower(email) = any($1::text[])`, [emails]);
  if (result.rowCount) State.dbCache = null;
  return Boolean(result.rowCount);
}

async function persistDeveloperBootstrap(data) {
  if (State.postgresPool) {
    await upsertPostgresUsers(data.users || []);
    return;
  }
  await Storage.saveDb(data);
}

function temporaryPassword() {
  return crypto.randomBytes(9).toString('base64url') + '#KBC1';
}

async function ensurePostgresUserSchema(trace = null) {
  if (!State.postgresPool) return;
  if (State.postgresUserSchemaReady) return;
  const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const sessionsTable = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
  const loginEventsTable = Storage.sqlIdentifier(Config.POSTGRES_LOGIN_EVENTS_TABLE, 'app_login_events');
  const passwordResetsTable = Storage.sqlIdentifier(Config.POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
  await Storage.tracedPostgresPoolQuery(trace, 'schema_users_table', `
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
  await Storage.tracedPostgresPoolQuery(trace, 'schema_users_temporary_password_column', `alter table ${usersTable} add column if not exists temporary_password text`);
  // Temporary passwords are no longer stored as plain text: clear the ones older versions saved.
  await Storage.tracedPostgresPoolQuery(trace, 'schema_users_clear_temporary_passwords', `update ${usersTable} set temporary_password = null where temporary_password is not null`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_users_invited_at_column', `alter table ${usersTable} add column if not exists invited_at timestamptz`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_users_password_changed_at_column', `alter table ${usersTable} add column if not exists password_changed_at timestamptz`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_sessions_table', `
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
  await Storage.tracedPostgresPoolQuery(trace, 'schema_sessions_token_hash_column', `alter table ${sessionsTable} add column if not exists token_hash text`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_sessions_zoho_state_column', `alter table ${sessionsTable} add column if not exists zoho_state text`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_sessions_user_id_index', `create index if not exists ${Storage.sqlIdentifier(`${Config.POSTGRES_SESSIONS_TABLE}_user_id_idx`, 'app_sessions_user_id_idx')} on ${sessionsTable} (user_id)`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_sessions_expires_at_index', `create index if not exists ${Storage.sqlIdentifier(`${Config.POSTGRES_SESSIONS_TABLE}_expires_at_idx`, 'app_sessions_expires_at_idx')} on ${sessionsTable} (expires_at)`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_sessions_token_hash_index', `create unique index if not exists ${Storage.sqlIdentifier(`${Config.POSTGRES_SESSIONS_TABLE}_token_hash_idx`, 'app_sessions_token_hash_idx')} on ${sessionsTable} (token_hash) where token_hash is not null`);
  await Storage.tracedPostgresPoolQuery(trace, 'schema_login_events_table', `
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
  await Storage.tracedPostgresPoolQuery(trace, 'schema_password_resets_table', `
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
  State.postgresUserSchemaReady = true;
}

async function ensureUserStorage(trace = null) {
  if (!Config.DATABASE_URL) return null;
  if (Storage.usesPostgresStorage()) {
    await Storage.getPostgresPool();
    if (String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') {
      State.postgresUserSchemaReady = true;
      return State.postgresPool;
    }
    await ensurePostgresUserSchema(trace);
    return State.postgresPool;
  }
  return Storage.ensureStorage(trace);
}
const dateValue = value => value ? new Date(value).toISOString() : null;

async function upsertPostgresUsers(users = []) {
  if (!State.postgresPool) return;
  const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  for (const user of users) {
    if (!user?.email || !user?.password_hash) continue;
    await State.postgresPool.query(
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
      [user.id, user.name, Emails.normalizeEmail(user.email), user.role || 'sales', user.password_hash, dateValue(user.invited_at), dateValue(user.password_changed_at)]
    );
  }
}

async function hydratePostgresUsers(db) {
  if (!State.postgresPool) return db;
  const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const count = await State.postgresPool.query(`select count(*)::int as count from ${table}`);
  if (!count.rows[0]?.count && db.users?.length) await upsertPostgresUsers(db.users);
  const result = await State.postgresPool.query(`select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} order by created_at, id`);
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
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const result = await Storage.postgresQuery(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} where email = $1 limit 1`,
      [Emails.normalizeEmail(email)]
    );
    return result.rows[0] || null;
  }
  const db = await Storage.loadDb();
  return db.users.find(item => Emails.normalizeEmail(item.email) === Emails.normalizeEmail(email)) || null;
}

async function forceConfiguredDeveloperLogin(email, password) {
  if (!isDeveloperEmail(email)) return null;
  const configuredPassword = configuredDeveloperPassword();
  if (!configuredPassword || !safeEqualText(password, configuredPassword)) return null;
  const developerUser = configuredDeveloperUserRecord();
  if (!developerUser) return null;
  await ensureUserStorage();
  if (State.postgresPool) {
    await upsertPostgresUsers([developerUser]);
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const result = await Storage.postgresQuery(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} where email = $1 limit 1`,
      [Emails.normalizeEmail(email)]
    );
    return result.rows[0] || developerUser;
  }
  const db = await Storage.loadDb();
  const existing = db.users.find(item => Emails.normalizeEmail(item.email) === Emails.normalizeEmail(email));
  if (existing) Object.assign(existing, developerUser, { id: existing.id });
  else db.users.push(developerUser);
  await Storage.saveDb(db);
  return existing || developerUser;
}

async function findUserById(id) {
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const result = await Storage.postgresQuery(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} where id = $1 limit 1`,
      [id]
    );
    return result.rows[0] || null;
  }
  const db = await Storage.loadDb();
  return db.users.find(item => item.id === id) || null;
}

async function createSession(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + Config.SESSION_TTL);
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await Storage.postgresQuery(
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
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    const result = await Storage.postgresQuery(
      `select id, user_id, gmail_state, eventbrite_state, zoho_state, expires_at, updated_at from ${table} where id = $1 or token_hash = $2 limit 1`,
      [sid, tokenHash(sid)]
    );
    const session = result.rows[0];
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await Storage.postgresQuery(`delete from ${table} where id = $1`, [sid]);
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
  const expiresAt = new Date(Date.now() + Config.SESSION_TTL);
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await Storage.postgresQuery(`update ${table} set expires_at = $2, updated_at = now() where id = $1`, [sid, expiresAt.toISOString()]);
  } else {
    const session = memorySessions.get(sid);
    if (session) {
      session.expires_at = expiresAt.getTime();
      session.updated_at = Date.now();
    }
  }
}

async function patchSession(sid, fields = {}) {
  if (!sid) throw Http.statusError(401, 'Sign in to continue.');
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await Storage.postgresQuery(
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
    if (!session) throw Http.statusError(401, 'Sign in to continue.');
    Object.assign(session, fields);
  }
}

async function deleteSession(sid) {
  if (!sid) return;
  sessionAuthCacheEpoch += 1;
  postgresSessionUserCache.delete(tokenHash(sid));
  postgresSessionUserLookups.delete(tokenHash(sid));
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await Storage.postgresQuery(`delete from ${table} where id = $1`, [sid]);
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
  const sid = Http.parseCookies(req).sid;
  Perf.perfAdd(trace, 'cookie_parse', performance.now() - cookieStarted);
  if (!sid) throw Http.statusError(401, 'Sign in to continue.');
  await Perf.perfPhase(trace, 'auth_storage', () => ensureUserStorage(trace));
  if (State.postgresPool) {
    const sessionsTable = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const sidHash = tokenHash(sid);
    const cached = postgresSessionUserCache.get(sidHash);
    if (cached && cached.expiresAt > Date.now()) {
      Perf.perfCount(trace, 'session_cache_hits');
      Perf.perfAdd(trace, 'auth_session_cache', 0);
      return { ...cached.user };
    }
    if (cached) postgresSessionUserCache.delete(sidHash);
    let joined = true;
    let lookup = postgresSessionUserLookups.get(sidHash);
    if (!lookup) {
      joined = false;
      Perf.perfCount(trace, 'session_cache_misses');
      Perf.perfCount(trace, 'session_lookup_started');
      const cacheEpoch = sessionAuthCacheEpoch;
      lookup = (async () => {
        const authStart = performance.now();
        const result = await Storage.timedPostgresQuery(
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
        if (!row) throw Http.statusError(401, 'Sign in to continue.');
        const updatedAt = new Date(row.session_updated_at || 0).getTime();
        if (!updatedAt || Date.now() - updatedAt > Config.SESSION_TOUCH_INTERVAL_MS) {
          await Storage.timedPostgresQuery(
            trace,
            'auth_session_touch',
            `update ${sessionsTable} set expires_at = $2, updated_at = now(), token_hash = coalesce(token_hash, $3) where id = $1`,
            [row.session_id, new Date(Date.now() + Config.SESSION_TTL).toISOString(), sidHash]
          );
        }
        const { session_id, expires_at, session_updated_at, ...user } = row;
        user.__auth_ms = performance.now() - authStart;
        if (Config.SESSION_AUTH_CACHE_MS > 0 && cacheEpoch === sessionAuthCacheEpoch) {
          const sessionExpiry = new Date(expires_at || 0).getTime() || 0;
          postgresSessionUserCache.set(sidHash, {
            user: { ...user },
            userId: user.id,
            expiresAt: Math.min(Date.now() + Config.SESSION_AUTH_CACHE_MS, sessionExpiry)
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
      Perf.perfCount(trace, 'auth_session_joined');
      Perf.perfCount(trace, 'session_lookup_joined');
    }
    const user = joined
      ? await Perf.perfPhase(trace, 'auth_session_join', () => lookup)
      : await lookup;
    return { ...user };
  }
  const session = await Perf.perfPhase(trace, 'auth_session_lookup', () => getSession(sid));
  if (!session) throw Http.statusError(401, 'Sign in to continue.');
  const user = await Perf.perfPhase(trace, 'auth_user_lookup', () => findUserById(session.user_id));
  if (!user) throw Http.statusError(401, 'Sign in to continue.');
  if (!session.updated_at || Date.now() - Number(session.updated_at || 0) > Config.SESSION_TOUCH_INTERVAL_MS) await Perf.perfPhase(trace, 'auth_session_touch', () => touchSession(sid));
  return user;
}

async function recordPostgresLogin(user, req) {
  if (!State.postgresPool || !user) return;
  const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const loginEventsTable = Storage.sqlIdentifier(Config.POSTGRES_LOGIN_EVENTS_TABLE, 'app_login_events');
  await Storage.postgresQuery(
    `
      insert into ${loginEventsTable} (user_id, name, email, ip_address, user_agent)
      values ($1, $2, $3, $4, $5)
    `,
    [user.id, user.name, Emails.normalizeEmail(user.email), Http.requestIp(req), String(req.headers['user-agent'] || '').slice(0, 500)]
  );
  await Storage.postgresQuery(`update ${usersTable} set last_login_at = now(), updated_at = now() where id = $1`, [user.id]);
}

async function clearUserSessions(userId) {
  clearCachedSessionUserForUser(userId);
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_SESSIONS_TABLE, 'app_sessions');
    await Storage.postgresQuery(`delete from ${table} where user_id = $1`, [userId]);
    return;
  }
  for (const [sid, session] of memorySessions.entries()) {
    if (session.user_id === userId) memorySessions.delete(sid);
  }
}

// Password guessing is slowed down in memory. Each key (email + address, address, email or
// user) may fail a limited number of times inside one window. Login gets short progressive
// locks, while other auth actions keep the full window lock. Counts belong to this process and
// a restart clears them.
const AUTH_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_THROTTLE_MAX_KEYS = 20000;
const LOGIN_THROTTLE_LOCK_STEPS_MS = [30 * 1000, 60 * 1000, 3 * 60 * 1000];
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

// limits is a list of [key, allowed count, optional progressive lock steps].
// Throws 429 when any key has used its allowance.
function assertAuthThrottle(limits, now = Date.now()) {
  let retryMs = 0;
  for (const [key, allowed, lockSteps] of limits) {
    const entry = authThrottleEntry(key, now);
    if (!entry) continue;
    if (entry.blockedUntil > now) {
      retryMs = Math.max(retryMs, entry.blockedUntil - now);
      continue;
    }
    if (entry.count < allowed) continue;
    if (Array.isArray(lockSteps) && lockSteps.length) {
      const lockLevel = Math.max(0, Number(entry.lockLevel || 0));
      const lockMs = lockSteps[Math.min(lockLevel, lockSteps.length - 1)];
      entry.lockLevel = lockLevel + 1;
      entry.count = 0;
      entry.blockedUntil = now + lockMs;
      entry.resetAt = Math.max(entry.resetAt || 0, now + AUTH_THROTTLE_WINDOW_MS, entry.blockedUntil);
      retryMs = Math.max(retryMs, lockMs);
      continue;
    }
    retryMs = Math.max(retryMs, entry.resetAt - now);
  }
  if (!retryMs) return;
  const seconds = Math.max(1, Math.ceil(retryMs / 1000));
  const waitText = seconds < 60
    ? `${seconds} second${seconds === 1 ? '' : 's'}`
    : `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}`;
  const error = Http.statusError(429, `Too many attempts. Try again in ${waitText}.`);
  error.headers = { 'Retry-After': String(Math.ceil(retryMs / 1000)) };
  throw error;
}

function recordAuthThrottle(limits, now = Date.now()) {
  for (const [key] of limits) {
    const entry = authThrottleEntry(key, now);
    if (entry) entry.count += 1;
    else authThrottle.set(key, { count: 1, resetAt: now + AUTH_THROTTLE_WINDOW_MS, lockLevel: 0, blockedUntil: 0 });
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
  const address = Http.requestIp(req);
  return [
    [`login:${email}|${address}`, LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS, LOGIN_THROTTLE_LOCK_STEPS_MS],
    [`login-address:${address}`, LOGIN_FAILURES_PER_ADDRESS, LOGIN_THROTTLE_LOCK_STEPS_MS],
    [`login-email:${email}`, LOGIN_FAILURES_PER_EMAIL, LOGIN_THROTTLE_LOCK_STEPS_MS]
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
    throw Http.statusError(400, 'The developer account password is set by DEV_PANEL_PASSWORD on the server. Change it there.');
  }
  const currentPassword = String(body.current_password || '');
  const newPassword = String(body.new_password || '');
  if (newPassword.length < PASSWORD_MIN_LENGTH) throw Http.statusError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (newPassword.length > PASSWORD_MAX_LENGTH) throw Http.statusError(400, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  const limits = [[`password-change:${user.id}`, PASSWORD_CHANGE_FAILURES_PER_USER]];
  assertAuthThrottle(limits);
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const stored = await Storage.postgresQuery(`select password_hash from ${table} where id = $1 limit 1`, [user.id]);
    if (!verifyPassword(currentPassword, stored.rows[0]?.password_hash)) {
      recordAuthThrottle(limits);
      throw Http.statusError(400, 'Current password is incorrect.');
    }
    await Storage.postgresQuery(
      `update ${table} set password_hash = $2, temporary_password = null, password_changed_at = now(), updated_at = now() where id = $1`,
      [user.id, hashPassword(newPassword)]
    );
    await clearUserSessions(user.id);
    authThrottle.delete(limits[0][0]);
    State.dbCache = null;
    return { ok: true };
  }
  const db = await Storage.loadDb();
  const target = db.users.find(item => item.id === user.id);
  if (!target || !verifyPassword(currentPassword, target.password_hash)) {
    recordAuthThrottle(limits);
    throw Http.statusError(400, 'Current password is incorrect.');
  }
  target.password_hash = hashPassword(newPassword);
  target.password_changed_at = new Date().toISOString();
  Audit.addAudit(db, target, 'Password changed', 'user', target.email);
  await Storage.saveDb(db);
  await clearUserSessions(target.id);
  authThrottle.delete(limits[0][0]);
  return { ok: true };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function resetUrl(req, token) {
  return `${Http.originFor(req)}/#/reset-password?token=${encodeURIComponent(token)}`;
}

function mailFromAddress(db) {
  return process.env.MAIL_FROM || process.env.GMAIL_SMTP_USER || db.gmail?.email || 'no-reply@kentbusinesscollege.local';
}

function mailFromName() {
  return process.env.MAIL_FROM_NAME || 'Kent Business College';
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
  const message = Emails.rawEmail({ from: Emails.encodeMailAddress(fromName, fromEmail), to: user.email, subject, text });
  try {
    await Gmail.sendGmailApiMail(db, message);
  } catch (apiError) {
    await Gmail.sendSmtpMail({ fromEmail, fromName, to: user.email, subject, text }).catch(smtpError => {
      throw Emails.emailDeliveryError(apiError, smtpError);
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

async function loadDeveloperConfigDb() {
  await ensureUserStorage();
  const seeded = Workspace.seedDatabase();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    return { ...seeded, users: db.users, gmail: db.gmail, eventbrite: db.eventbrite, meta: db.meta };
  }
  const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  // Two reads that do not depend on each other, sent together. The workspace row is read
  // without its long id lists, stored records and Zoom state (over 600 KB the panel never shows).
  const [userRows, workspaceRows] = await Promise.all([
    State.postgresPool.query(
      `select id, name, email, role, password_hash, invited_at, password_changed_at from ${table} order by created_at, id`
    ),
    State.postgresPool.query(
      `select coalesce(gmail, '{}'::jsonb) - 'imported_message_ids' as gmail,
              coalesce(eventbrite, '{}'::jsonb) - 'imported_event_ids' - 'imported_attendee_ids' as eventbrite,
              jsonb_build_object(
                'zoho', coalesce(meta->'zoho', '{}'::jsonb) - 'records' - 'imported_record_ids',
                'apollo', coalesce(meta->'apollo', '{}'::jsonb) - 'imported_person_ids'
              ) as meta
       from app_workspace where id = $1`,
      ['main']
    ).catch(() => ({ rows: [] }))
  ]);
  // Reading the panel does not write: retired developer accounts are left out here and are
  // deleted where the workspace is loaded.
  const users = userRows.rows.filter(user => !isLegacyDeveloperEmail(user.email));
  const workspace = workspaceRows.rows[0] || null;
  return Workspace.recalculate({
    ...seeded,
    users,
    gmail: { connected: false, ...(workspace?.gmail || {}), imported_message_ids: [] },
    eventbrite: { connected: false, ...(workspace?.eventbrite || {}), imported_event_ids: [], imported_attendee_ids: [] },
    meta: { imported_lead_ids: [], imported_form_ids: [], ...(workspace?.meta || {}) },
    apollo: { ...(workspace?.meta?.apollo || {}), imported_person_ids: [] }
  });
}

async function createWorkspaceUser(body, actor) {
  const email = Emails.normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const password = String(body.password || '').trim() || temporaryPassword();
  const role = normalizeWorkspaceRole(body.role || 'member');
  if (!name || !email) throw Http.statusError(400, 'Name and email are required.');
  if (password.length < 8) throw Http.statusError(400, 'Password must be at least 8 characters.');
  if (!role) throw Http.statusError(400, 'Choose a valid role.');
  if (role === 'admin' && !isDeveloperEmail(email)) throw Http.statusError(400, 'Only the configured developer account can use Developer.');
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const existing = await State.postgresPool.query(`select id from ${table} where email = $1 limit 1`, [email]);
    if (existing.rows[0]) throw Http.statusError(400, 'A user with this email already exists.');
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
    State.dbCache = null;
    return { ok: true, user: publicUser(user), temporary_password: password };
  }
  const db = await Storage.loadDb();
  if (db.users.some(item => Emails.normalizeEmail(item.email) === email)) throw Http.statusError(400, 'A user with this email already exists.');
  const user = { id: Util.nextId('U', [db.users]), name, email, role, password_hash: hashPassword(password), invited_at: new Date().toISOString(), password_changed_at: null };
  db.users.push(user);
  Audit.addAudit(db, actor, 'Team member invited', 'user', email);
  await Storage.saveDb(db);
  return { ok: true, user: publicUser(user), temporary_password: password };
}

async function resetWorkspaceUserPassword(userId, body, actor) {
  const password = String(body.password || '').trim() || temporaryPassword();
  if (password.length < 8) throw Http.statusError(400, 'Password must be at least 8 characters.');
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const result = await State.postgresPool.query(
      `update ${table}
       set password_hash = $2, temporary_password = null, password_changed_at = null, invited_at = coalesce(invited_at, now()), updated_at = now()
       where id = $1
       returning id, name, email, role, invited_at, password_changed_at`,
      [userId, hashPassword(password)]
    );
    if (!result.rows[0]) throw Http.statusError(404, 'User not found.');
    await clearUserSessions(userId);
    State.dbCache = null;
    return { ok: true, user: result.rows[0], temporary_password: password };
  }
  const db = await Storage.loadDb();
  const target = db.users.find(item => item.id === userId);
  if (!target) throw Http.statusError(404, 'User not found.');
  target.password_hash = hashPassword(password);
  target.password_changed_at = null;
  target.invited_at ||= new Date().toISOString();
  await clearUserSessions(target.id);
  Audit.addAudit(db, actor, 'Team member password reset', 'user', target.email);
  await Storage.saveDb(db);
  return { ok: true, user: publicUser(target), temporary_password: password };
}

async function resetPasswordWithTokenFastDb(body) {
  if (!Storage.usesPostgresStorage()) throw Http.statusError(500, 'Password reset requires Neon/PostgreSQL storage.');
  await Storage.ensureStorage();
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!token || !password) throw Http.statusError(400, 'Reset token and new password are required.');
  if (password.length < 8) throw Http.statusError(400, 'Password must be at least 8 characters.');
  const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const resetsTable = Storage.sqlIdentifier(Config.POSTGRES_PASSWORD_RESETS_TABLE, 'app_password_resets');
  const client = await State.postgresPool.connect();
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
    if (!userId) throw Http.statusError(400, 'This reset link is invalid or expired.');
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
    State.dbCache = null;
    return { ok: true };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function assertUserCanBeManaged(target, actor, action, nextRole = '') {
  if (!target) throw Http.statusError(404, 'User not found.');
  if (target.id === actor.id) throw Http.statusError(400, `You cannot ${action} your own account.`);
  const targetIsConfiguredDeveloper = isDeveloperEmail(target.email);
  if (nextRole && canonicalWorkspaceRole(nextRole) === 'admin' && !targetIsConfiguredDeveloper) {
    throw Http.statusError(400, 'Only the configured developer account can use Developer.');
  }
  if (targetIsConfiguredDeveloper && (action === 'delete' || (nextRole && canonicalWorkspaceRole(nextRole) !== 'admin'))) {
    throw Http.statusError(400, 'The configured developer account must stay as Developer.');
  }
}

async function updateWorkspaceUserRole(userId, body, actor) {
  const role = normalizeWorkspaceRole(body.role);
  if (!role) throw Http.statusError(400, 'Choose Developer, Monitor or Member.');
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const current = await State.postgresPool.query(`select id, name, email, role from ${table} where id = $1 limit 1`, [userId]);
    const target = current.rows[0];
    assertUserCanBeManaged(target, actor, 'change the role for', role);
    const result = await State.postgresPool.query(
      `update ${table} set role = $2, updated_at = now() where id = $1 returning id, name, email, role, invited_at, password_changed_at`,
      [userId, role]
    );
    await clearUserSessions(userId);
    State.dbCache = null;
    return { ok: true, user: result.rows[0] };
  }
  const db = await Storage.loadDb();
  const target = db.users.find(item => item.id === userId);
  assertUserCanBeManaged(target, actor, 'change the role for', role);
  target.role = role;
  await clearUserSessions(target.id);
  Audit.addAudit(db, actor, 'Team member role changed', 'user', target.email);
  await Storage.saveDb(db);
  return { ok: true, user: publicUser(target) };
}

async function deleteWorkspaceUser(userId, actor) {
  await ensureUserStorage();
  if (State.postgresPool) {
    const table = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const current = await State.postgresPool.query(`select id, name, email, role from ${table} where id = $1 limit 1`, [userId]);
    const target = current.rows[0];
    assertUserCanBeManaged(target, actor, 'delete');
    await State.postgresPool.query(`delete from ${table} where id = $1`, [userId]);
    await clearUserSessions(userId);
    State.dbCache = null;
    return { ok: true, deleted_id: userId };
  }
  const db = await Storage.loadDb();
  const target = db.users.find(item => item.id === userId);
  assertUserCanBeManaged(target, actor, 'delete');
  db.users = db.users.filter(item => item.id !== userId);
  await clearUserSessions(userId);
  Audit.addAudit(db, actor, 'Team member deleted', 'user', target.email);
  await Storage.saveDb(db);
  return { ok: true, deleted_id: userId };
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

function configuredDeveloperEmail() {
  return configuredDeveloperEmails()[0] || '';
}

function configuredDeveloperEmails() {
  return Gmail.uniqueStrings([
    Config.DEFAULT_DEVELOPER_EMAIL,
    process.env.DEV_PANEL_EMAIL
  ].map(Emails.normalizeEmail).filter(Boolean));
}

function isDeveloperEmail(email) {
  const normalized = Emails.normalizeEmail(email);
  return Boolean(normalized && configuredDeveloperEmails().includes(normalized));
}

function canUseDeveloperDashboard(req, user) {
  return Boolean(user && isDeveloperEmail(user.email));
}

function requireDeveloperAccess(req, user) {
  if (!canUseDeveloperDashboard(req, user)) {
    throw Http.statusError(403, 'Developer dashboard is only available to the configured developer account.');
  }
}

function developerConfig(req, db) {
  return {
    local_only: !configuredDeveloperEmail(),
    storage: Storage.storageMode(),
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
        status: db.gmail?.connected ? 'Connected' : Gmail.gmailConfigured() ? 'Ready to connect' : 'Needs credentials',
        account: db.gmail?.email || '',
        callback: Gmail.gmailRedirectUri(req),
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
        status: db.eventbrite?.connected || Eventbrite.eventbritePrivateTokenConfigured() ? 'Connected' : Eventbrite.eventbriteConfigured() ? 'Ready to connect' : 'Needs credentials',
        account: db.eventbrite?.name || '',
        callback: Eventbrite.eventbriteRedirectUri(req),
        keys: [
          envKeyStatus('EVENTBRITE_CLIENT_ID', 'OAuth client ID', false),
          envKeyStatus('EVENTBRITE_CLIENT_SECRET', 'OAuth client secret', true),
          envKeyStatus('EVENTBRITE_REDIRECT_URI', 'OAuth redirect URI', false),
          envKeyStatus('EVENTBRITE_PRIVATE_TOKEN', 'Private token', true)
        ]
      },
      {
        name: 'Meta Lead Ads',
        status: Meta.metaConfigured() ? 'Connected' : 'Needs credentials',
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
        status: Zoom.zoomConfigured() ? 'Connected' : 'Needs credentials',
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
        status: Apollo.apolloConfigured() ? 'Connected' : 'Needs credentials',
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
        status: Zoho.zohoConnectionDiagnostics(req, db).connected ? 'Connected' : Zoho.zohoConnectionDiagnostics(req, db).reauthorizationRequired ? 'Reconnect required' : Zoho.zohoConfigured() ? 'Ready to connect' : 'Needs credentials',
        account: db.zoho?.email || db.zoho?.api_domain || '',
        callback: Zoho.zohoRedirectUri(req),
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

function sessionCookie(req, sid, maxAge = Config.SESSION_TTL / 1000) {
  const secure = Http.requestIsSecure(req) ? '; Secure' : '';
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.initialUsers = initialUsers;
exports.LEGACY_DEFAULT_ADMIN_PASSWORD = LEGACY_DEFAULT_ADMIN_PASSWORD;
exports.initialAdminPassword = initialAdminPassword;
exports.developerPasswordConfigured = developerPasswordConfigured;
exports.ensureConfiguredDeveloperUser = ensureConfiguredDeveloperUser;
exports.isLegacyDeveloperEmail = isLegacyDeveloperEmail;
exports.removeLegacyDeveloperUsers = removeLegacyDeveloperUsers;
exports.removeLegacyPostgresDeveloperUsers = removeLegacyPostgresDeveloperUsers;
exports.persistDeveloperBootstrap = persistDeveloperBootstrap;
exports.ensurePostgresUserSchema = ensurePostgresUserSchema;
exports.upsertPostgresUsers = upsertPostgresUsers;
exports.hydratePostgresUsers = hydratePostgresUsers;
exports.findLoginUser = findLoginUser;
exports.forceConfiguredDeveloperLogin = forceConfiguredDeveloperLogin;
exports.createSession = createSession;
exports.getSession = getSession;
exports.patchSession = patchSession;
exports.deleteSession = deleteSession;
exports.currentSessionUser = currentSessionUser;
exports.recordPostgresLogin = recordPostgresLogin;
exports.AUTH_THROTTLE_WINDOW_MS = AUTH_THROTTLE_WINDOW_MS;
exports.LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS = LOGIN_FAILURES_PER_EMAIL_AND_ADDRESS;
exports.PASSWORD_FORGOT_REQUESTS_PER_ADDRESS = PASSWORD_FORGOT_REQUESTS_PER_ADDRESS;
exports.PASSWORD_FORGOT_REQUESTS_PER_EMAIL = PASSWORD_FORGOT_REQUESTS_PER_EMAIL;
exports.PASSWORD_RESET_ATTEMPTS_PER_ADDRESS = PASSWORD_RESET_ATTEMPTS_PER_ADDRESS;
exports.authThrottle = authThrottle;
exports.assertAuthThrottle = assertAuthThrottle;
exports.recordAuthThrottle = recordAuthThrottle;
exports.loginThrottleLimits = loginThrottleLimits;
exports.changeOwnPassword = changeOwnPassword;
exports.tokenHash = tokenHash;
exports.resetUrl = resetUrl;
exports.mailFromAddress = mailFromAddress;
exports.mailFromName = mailFromName;
exports.sendPasswordResetMail = sendPasswordResetMail;
exports.publicUser = publicUser;
exports.permissions = permissions;
exports.permissionsForUser = permissionsForUser;
exports.canonicalWorkspaceRole = canonicalWorkspaceRole;
exports.loadDeveloperConfigDb = loadDeveloperConfigDb;
exports.createWorkspaceUser = createWorkspaceUser;
exports.resetWorkspaceUserPassword = resetWorkspaceUserPassword;
exports.resetPasswordWithTokenFastDb = resetPasswordWithTokenFastDb;
exports.updateWorkspaceUserRole = updateWorkspaceUserRole;
exports.deleteWorkspaceUser = deleteWorkspaceUser;
exports.isDeveloperEmail = isDeveloperEmail;
exports.requireDeveloperAccess = requireDeveloperAccess;
exports.developerConfig = developerConfig;
exports.sessionCookie = sessionCookie;
