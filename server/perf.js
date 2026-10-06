'use strict';

const { monitorEventLoopDelay, performance: perfHooksPerformance } = require('node:perf_hooks');
const Config = require('./config');
const State = require('./state');
const Storage = require('./storage');
const Leads = require('./leads');
const Tasks = require('./tasks');
const Emails = require('./emails');
const Applications = require('./applications');
const Dashboard = require('./dashboard');
const Monitoring = require('./monitoring');
const Zoom = require('./integrations/zoom');

const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelayMonitor.enable();

async function explainTracedPage(label, run) {
  const trace = createPerfTrace(label);
  const started = performance.now();
  const payload = await run(trace);
  const appMs = performance.now() - started;
  const queryStages = trace.stages.filter(stage => stage.name.endsWith('_query') && stage.sql_full);
  const explains = [];
  for (const stage of queryStages) {
    explains.push(await Storage.explainPostgresQuery(stage.query_name || stage.name.replace(/_query$/, ''), stage.sql_full, stage.params || []));
  }
  return {
    app_duration_ms: Number(appMs.toFixed(1)),
    returned_rows: Array.isArray(payload?.items) ? payload.items.length : Array.isArray(payload?.emails) ? payload.emails.length : Array.isArray(payload?.applications) ? payload.applications.length : 0,
    postgres_query_count: queryStages.length,
    queries: explains
  };
}

async function explainRemainingPageQueries(options = {}) {
  await Storage.ensureStorage();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const bounds = {
    today_start: start.toISOString(),
    tomorrow_start: new Date(start.getTime() + 86400000).toISOString()
  };
  return {
    leads_reference: await Storage.explainPostgresQuery('leads_page', Leads.buildLeadPageQuery({ limit: options.leads_limit || 100 }).sql, Leads.buildLeadPageQuery({ limit: options.leads_limit || 100 }).values),
    emails: await explainTracedPage('/api/emails?status=Unanswered&limit=50', trace => Emails.loadEmailPage({ status: 'Unanswered', limit: '50' }, trace)),
    tasks: await explainTracedPage('/api/tasks?status=open&bucket=overdue&limit=80&include_counts=true', trace => Tasks.loadTaskPage({ status: 'open', bucket: 'overdue', limit: '80', include_counts: 'true', ...bounds }, trace)),
    applications: await explainTracedPage('/api/applications?limit=50', trace => Applications.loadApplicationListDb({ limit: '50' }, trace)),
    meetings: await explainTracedPage('/api/meetings?limit=50', trace => Zoom.loadZoomEventPageDb({ limit: '50' }, trace)),
    contacts: await explainTracedPage('/api/contacts?limit=100', trace => Leads.loadContactPage({ limit: '100' }, trace))
  };
}

async function loadDashboardSourcePerformanceDb(filters) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { sources: [] };
  const where = Dashboard.leadDashboardWhere(filters);
  const result = await State.postgresPool.query(`
    select
      coalesce(l.source_lead_capture, l.source_first_touch, l.data->>'source_lead_capture', l.data->>'source_first_touch', 'Other') as source,
      count(distinct ${Dashboard.dashboardLeadIdentitySql('l')})::int as leads,
      count(distinct ${Dashboard.dashboardLeadIdentitySql('l')}) filter (where lower(coalesce(l.stage, l.data->>'stage', '')) in ('qualified','application submitted','eligibility','ready for enrolment','enrolled'))::int as qualified,
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

function perfCounters(trace) {
  return trace ? { ...trace.counters } : {};
}

function eventLoopDelayMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1e18) return 0;
  return Number((number / 1e6).toFixed(1));
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
  if (!Config.API_PERF_TRACE_ENABLED || !trace) return;
  const total = performance.now() - trace.started_at;
  const stages = trace.stages.map(stage => {
    const meta = stage.rows !== undefined ? ` rows=${stage.rows}` : '';
    const pool = stage.pool_before ? ` pool=${stage.pool_before.totalCount}/${stage.pool_before.idleCount}/${stage.pool_before.waitingCount}->${stage.pool_after?.totalCount}/${stage.pool_after?.idleCount}/${stage.pool_after?.waitingCount}` : '';
    return `${stage.name}=${stage.ms.toFixed(1)}ms${meta}${pool}`;
  }).join(' ');
  const queryCount = trace.counters.postgres_queries || 0;
  const pool = Storage.postgresPoolStats();
  const loop = Monitoring.eventLoopSnapshot(false);
  console.log(`[PERF] ${trace.route} status=${trace.status || 0} total=${total.toFixed(1)}ms bytes=${trace.bytes || 0} pg_queries=${queryCount} pool=${pool.totalCount}/${pool.idleCount}/${pool.waitingCount} loop_p95=${loop.delay_p95_ms}ms loop_p99=${loop.delay_p99_ms}ms loop_max=${loop.delay_max_ms}ms loop_util=${loop.utilization} ${stages}`);
}

exports.eventLoopDelayMonitor = eventLoopDelayMonitor;
exports.explainRemainingPageQueries = explainRemainingPageQueries;
exports.loadDashboardSourcePerformanceDb = loadDashboardSourcePerformanceDb;
exports.createPerfTrace = createPerfTrace;
exports.perfAdd = perfAdd;
exports.perfPhase = perfPhase;
exports.perfCount = perfCount;
exports.perfDuration = perfDuration;
exports.perfDurationEnding = perfDurationEnding;
exports.perfCounters = perfCounters;
exports.eventLoopDelayMs = eventLoopDelayMs;
exports.formatServerTiming = formatServerTiming;
exports.logPerfTrace = logPerfTrace;
