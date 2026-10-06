'use strict';

const Http = require('../http');
const Perf = require('../perf');
const Auth = require('../auth');
const Monitoring = require('../monitoring');
const Bootstrap = require('../bootstrap');
const NOT_HANDLED = require('./not-handled');

// Bootstrap routes that read and write the database directly.
async function bootstrapRoutes(ctx) {
  const { route, method, res, trace, req, url } = ctx;
  if (route === '/api/bootstrap' && method === 'GET') {
    const timings = {};
    const user = await Auth.currentSessionUser(req, trace);
    const payload = await Bootstrap.loadBootstrapPayload(user, timings, trace);
    if (url.searchParams.get('debug_timing') === 'true') {
      Auth.requireDeveloperAccess(req, user);
      payload._debug = {
        timings: {
          node_total_ms: Number((performance.now() - trace.started_at).toFixed(1)),
          pre_handler_ms: Number(Perf.perfDuration(trace, 'pre_handler').toFixed(1)),
          middleware_ms: Number(Perf.perfDuration(trace, 'middleware').toFixed(1)),
          auth_ms: Number((Perf.perfDuration(trace, 'auth_session_lookup') + Perf.perfDuration(trace, 'auth_session_join') + Perf.perfDuration(trace, 'auth_session_cache')).toFixed(1)),
          db_acquire_ms: Number(Perf.perfDurationEnding(trace, '_pool_acquire').toFixed(1)),
          db_query_ms: Number(Perf.perfDurationEnding(trace, '_query').toFixed(1)),
          serialize_ms: 0
        },
        counters: Perf.perfCounters(trace),
        queries: Bootstrap.bootstrapQueryBreakdown(trace),
        event_loop: Monitoring.eventLoopSnapshot(false)
      };
    }
    // Visible in the browser's Network > Timing panel.
    return Http.sendJson(res, payload, 200, {}, trace);
  }
  if (route === '/api/developer/config' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, Auth.developerConfig(req, await Auth.loadDeveloperConfigDb()));
  }
  return NOT_HANDLED;
}

exports.bootstrapRoutes = bootstrapRoutes;
