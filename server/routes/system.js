'use strict';

const Config = require('../config');
const State = require('../state');
const Http = require('../http');
const Perf = require('../perf');
const Storage = require('../storage');
const Auth = require('../auth');
const Monitoring = require('../monitoring');
const NOT_HANDLED = require('./not-handled');

// System routes answered before the sign-in check.
async function systemOpenRoutes(ctx) {
  const { route, method, finishMiddleware, res, trace } = ctx;
  if (route === '/api/health' && method === 'GET') {
    finishMiddleware();
    return Http.sendJson(res, { ok: true }, 200, {}, trace);
  }
  if (route === '/api/debug/ping' && method === 'GET') {
    if (!Config.API_DEBUG_ENDPOINTS_ENABLED) throw Http.statusError(404, 'API route not found.');
    finishMiddleware();
    return Http.sendJson(res, { ok: true }, 200, {}, trace);
  }
  return NOT_HANDLED;
}

// System routes that read and write the database directly.
async function systemRoutes(ctx) {
  const { route, method, res, trace, req, url } = ctx;
  if (route === '/api/debug/db-ping' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    Auth.requireDeveloperAccess(req, user);
    await Perf.perfPhase(trace, 'debug_storage', () => Storage.ensureStorage(trace));
    if (!State.postgresPool || !Storage.usesPostgresStorage()) throw Http.statusError(400, 'PostgreSQL storage is not configured.');
    const poolBefore = Storage.postgresPoolStats();
    const result = await Storage.timedPostgresQuery(trace, 'debug_select1', 'select 1 as ok');
    const poolAfter = Storage.postgresPoolStats();
    return Http.sendJson(res, {
      ok: result.rows[0]?.ok === 1,
      database: Storage.databaseSafeMetadata(),
      pool_before: poolBefore,
      pool_after: poolAfter,
      timings: {
        node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
        pre_handler_ms: Number(Perf.perfDuration(trace, 'pre_handler').toFixed(1)),
        middleware_ms: Number(Perf.perfDuration(trace, 'middleware').toFixed(1)),
        auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
        db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
        db_query_ms: Number(Perf.perfDurationEnding(trace, '_query').toFixed(1)),
        total_ms: Number((performance.now() - trace.started_at).toFixed(1))
      },
      event_loop: Monitoring.eventLoopSnapshot(url.searchParams.get('reset_event_loop') === 'true')
    }, 200, {}, trace);
  }
  return NOT_HANDLED;
}

exports.systemOpenRoutes = systemOpenRoutes;
exports.systemRoutes = systemRoutes;
