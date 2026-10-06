'use strict';

const { monitorEventLoopDelay, performance: perfHooksPerformance } = require('node:perf_hooks');
const Config = require('./config');
const State = require('./state');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Leads = require('./leads');

const monitoringState = { last_save_at: null, api_errors: [], api_timings: [] };
let monitoringSnapshotTimer = null;
const activeMonitoringSnapshotRefreshKeys = new Set();
const monitoringSnapshotMemoryCache = new Map();
const monitoringSnapshotReadPromises = new Map();
let eventLoopUtilizationBaseline = perfHooksPerformance.eventLoopUtilization
  ? perfHooksPerformance.eventLoopUtilization()
  : null;

// Local day boundaries sent by the browser (today_start, tomorrow_start) so "overdue" and
// "today" match what the user sees. Without them the server's UTC day is used.
function parseDayBounds(options = {}) {
  const parse = (input, label) => {
    const text = String(input || '').trim();
    if (!text) return null;
    const time = Date.parse(text);
    if (!Number.isFinite(time)) throw Http.statusError(400, `Invalid ${label}.`);
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
  await Storage.getPostgresPool();
  await Storage.tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_table', monitoringSnapshotSchemaSql());
  for (const [index, sql] of monitoringSnapshotSchemaAlterSqls().entries()) {
    await Storage.tracedPostgresPoolQuery(trace, `schema_monitoring_snapshot_column_${index + 1}`, sql);
  }
  await Storage.tracedPostgresPoolQuery(trace, 'schema_monitoring_snapshot_expires_index', monitoringSnapshotExpiresIndexSql());
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
  if (!Config.MONITORING_SNAPSHOT_ENABLED) return { state: 'MISSING', payload: null, meta: monitoringSnapshotMeta('MISSING') };
  const key = monitoringSnapshotKey(bounds);
  const cached = monitoringSnapshotMemoryCache.get(key);
  if (cached && Config.MONITORING_SNAPSHOT_MEMORY_CACHE_MS > 0 && Date.now() - cached.cachedAt <= Config.MONITORING_SNAPSHOT_MEMORY_CACHE_MS) {
    Perf.perfAdd(trace, 'monitoring_snapshot_memory_cache', 0, { state: cached.state });
    return cached.value;
  }
  const pending = monitoringSnapshotReadPromises.get(key);
  if (pending) {
    Perf.perfAdd(trace, 'monitoring_snapshot_read_join', 0);
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
    const state = ageMs <= Config.MONITORING_SNAPSHOT_TTL_MS ? 'FRESH' : 'STALE';
    const refreshing = row.refresh_lock_until ? new Date(row.refresh_lock_until).getTime() > Date.now() : false;
    const meta = monitoringSnapshotMeta(state, row, Number.isFinite(ageMs) ? ageMs : null, refreshing);
    Perf.perfAdd(trace, 'monitoring_snapshot_hit', 0, { state, refreshed_at: row.refreshed_at });
    Perf.perfAdd(trace, 'snapshot_age', 0, { state, age_ms: Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0 });
    const value = { state, payload: row.data, meta };
    monitoringSnapshotMemoryCache.set(key, { cachedAt: Date.now(), state, value });
    return value;
  } catch (error) {
    if (monitoringSnapshotSchemaMissing(error)) {
      Perf.perfAdd(trace, 'monitoring_snapshot_unavailable', 0, { code: error.code || '' });
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
  if (!Config.MONITORING_SNAPSHOT_ENABLED || !payload) return false;
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
      [monitoringSnapshotKey(bounds), bounds.todayStart, bounds.tomorrowStart, JSON.stringify(snapshotPayload), Config.MONITORING_SNAPSHOT_TTL_MS]
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
      Perf.perfAdd(trace, 'monitoring_snapshot_write_skipped', 0, { code: error.code || '' });
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
      [monitoringSnapshotKey(bounds), Config.MONITORING_SNAPSHOT_REFRESH_LOCK_MS]
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
  if (Storage.postgresConnectionLost(error)) return 'Monitoring refresh failed due to a transient database connection error.';
  return `Monitoring refresh failed${code}.`;
}

async function acquireMonitoringSnapshotRefreshLock(bounds, wait = false) {
  await Storage.getPostgresPool();
  const client = await State.postgresPool.connect();
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
  if (!Config.MONITORING_SNAPSHOT_ENABLED || !Storage.usesPostgresStorage()) return;
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
  await Storage.ensureStorage();
  if (!State.postgresPool) return false;
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

function scheduleMonitoringSnapshotLoop(delayMs = Config.MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS) {
  if (!Config.MONITORING_SNAPSHOT_ENABLED || !Config.MONITORING_SNAPSHOT_PROACTIVE_ENABLED || !Storage.usesPostgresStorage()) return;
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
  if (!Config.MONITORING_SNAPSHOT_ENABLED || !Config.MONITORING_SNAPSHOT_PROACTIVE_ENABLED || !Storage.usesPostgresStorage()) return;
  setTimeout(async () => {
    try {
      const bounds = parseDayBounds();
      const state = await readMonitoringSnapshotState(bounds, null);
      if (state.state !== 'FRESH') scheduleMonitoringSnapshotRefresh(bounds, 'startup', 250);
    } catch (error) {
      console.error(`Monitoring snapshot startup refresh skipped: ${safeMonitoringRefreshError(error)}`);
    }
  }, 1000).unref?.();
  scheduleMonitoringSnapshotLoop(Config.MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS);
}

async function monitoringPostgresQuery(trace, label, sql, params = []) {
  const acquireStarted = performance.now();
  let client = null;
  const beforeAcquire = Storage.postgresPoolStats();
  try {
    client = await State.postgresPool.connect();
    Perf.perfAdd(trace, `${label}_pool_acquire`, performance.now() - acquireStarted, {
      pool_before: beforeAcquire,
      pool_after: Storage.postgresPoolStats(),
      query_name: `${label}_pool_acquire`
    });
    await client.query('begin');
    await client.query(`set local statement_timeout = ${Config.MONITORING_STATEMENT_TIMEOUT_MS}`);
    const queryStarted = performance.now();
    const result = await client.query(sql, params);
    await client.query('commit');
    Perf.perfAdd(trace, `${label}_query`, performance.now() - queryStarted, {
      rows: result.rowCount ?? result.rows?.length ?? 0,
      sql: Storage.sqlSummary(sql),
      sql_full: sql,
      params,
      query_name: label
    });
    Perf.perfCount(trace, 'postgres_queries');
    return result;
  } catch (error) {
    if (client) await client.query('rollback').catch(() => null);
    Perf.perfAdd(trace, `${label}_error`, performance.now() - acquireStarted, {
      sql: Storage.sqlSummary(sql),
      query_name: label,
      code: error?.code || ''
    });
    if (error?.code === '57014') {
      const timeoutError = Http.statusError(503, `Monitoring query timed out: ${label}.`);
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

// Everything the Monitoring page shows, aggregated in SQL (it used to count a 200-row sample).
// Six queries in parallel; the stale-lead list is capped at 8 rows.
async function loadDashboardMonitoringDb(options = {}, trace = null) {
  const bounds = parseDayBounds(options);
  await Perf.perfPhase(trace, 'monitoring_storage', () => Storage.ensureStorage(trace));
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return null;
  Perf.perfAdd(trace, 'external_api', 0, { note: 'none' });
  if (!options.force_refresh && !options.bypass_snapshot) {
    const snapshot = await readMonitoringSnapshotState(bounds, trace);
    if (snapshot.state === 'FRESH') return monitoringPayloadWithSnapshotMeta(snapshot.payload, snapshot.meta);
    if (snapshot.state === 'STALE') {
      scheduleMonitoringSnapshotRefresh(bounds, 'stale');
      return monitoringPayloadWithSnapshotMeta(snapshot.payload, { ...snapshot.meta, stale: true, refreshing: true });
    }
    return refreshMonitoringSnapshotForeground(bounds, options, trace);
  }
  const active = Leads.activeLeadCondition();
  const activeLeadL = Leads.activeLeadCondition('l');
  const activeLeadD = Leads.activeLeadCondition('d');
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
  const payload = await Perf.perfPhase(trace, 'mapping', async () => {
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
  await Perf.perfPhase(trace, 'monitoring_storage', () => Storage.ensureStorage(trace));
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return null;
  await ensureMonitoringSnapshotSchema(trace);
  return loadDashboardMonitoringDb({ ...options, today_start: bounds.todayStart, tomorrow_start: bounds.tomorrowStart, force_refresh: true }, trace);
}

function eventLoopSnapshot(reset = false) {
  const utilization = perfHooksPerformance.eventLoopUtilization && eventLoopUtilizationBaseline
    ? perfHooksPerformance.eventLoopUtilization(eventLoopUtilizationBaseline)
    : null;
  const snapshot = {
    delay_mean_ms: Perf.eventLoopDelayMs(Perf.eventLoopDelayMonitor.mean),
    delay_p95_ms: Perf.eventLoopDelayMs(Perf.eventLoopDelayMonitor.percentile(95)),
    delay_p99_ms: Perf.eventLoopDelayMs(Perf.eventLoopDelayMonitor.percentile(99)),
    delay_max_ms: Perf.eventLoopDelayMs(Perf.eventLoopDelayMonitor.max),
    utilization: utilization ? Number(utilization.utilization.toFixed(4)) : null
  };
  if (reset) {
    Perf.eventLoopDelayMonitor.reset();
    if (perfHooksPerformance.eventLoopUtilization) {
      eventLoopUtilizationBaseline = perfHooksPerformance.eventLoopUtilization();
    }
  }
  return snapshot;
}

function recordApiError(req, error) {
  const status = error.status || 500;
  monitoringState.api_errors.unshift({
    occurred_at: new Date().toISOString(),
    route: Http.requestPath(req),
    method: req.method,
    status,
    message: error.message || 'Server error.'
  });
  monitoringState.api_errors = monitoringState.api_errors.slice(0, 25);
}

function recordApiTiming(req, status, startedAt) {
  const durationMs = performance.now() - startedAt;
  const route = Http.requestPath(req);
  const timing = {
    occurred_at: new Date().toISOString(),
    route,
    method: req.method,
    status,
    duration_ms: Number(durationMs.toFixed(1))
  };
  monitoringState.api_timings.unshift(timing);
  monitoringState.api_timings = monitoringState.api_timings.slice(0, 50);
  if (durationMs >= Config.API_TIMING_WARN_MS) {
    console.warn(`[timing] ${req.method} ${route} ${status} ${durationMs.toFixed(1)}ms`);
  }
}

exports.monitoringState = monitoringState;
exports.parseDayBounds = parseDayBounds;
exports.monitoringSnapshotSchemaSql = monitoringSnapshotSchemaSql;
exports.monitoringSnapshotExpiresIndexSql = monitoringSnapshotExpiresIndexSql;
exports.ensureMonitoringSnapshotSchema = ensureMonitoringSnapshotSchema;
exports.readMonitoringSnapshotState = readMonitoringSnapshotState;
exports.refreshMonitoringSnapshotInBackground = refreshMonitoringSnapshotInBackground;
exports.startMonitoringSnapshotScheduler = startMonitoringSnapshotScheduler;
exports.loadDashboardMonitoringDb = loadDashboardMonitoringDb;
exports.refreshMonitoringSnapshotDb = refreshMonitoringSnapshotDb;
exports.eventLoopSnapshot = eventLoopSnapshot;
exports.recordApiError = recordApiError;
exports.recordApiTiming = recordApiTiming;
