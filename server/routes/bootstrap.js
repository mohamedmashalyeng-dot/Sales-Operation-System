'use strict';

const Http = require('../http');
const Perf = require('../perf');
const Auth = require('../auth');
const Monitoring = require('../monitoring');
const Bootstrap = require('../bootstrap');
const Storage = require('../storage');
const NOT_HANDLED = require('./not-handled');

function emailSummary(email = {}) {
  const summary = { ...email };
  const snippet = String(summary.snippet || summary.body || summary.text || '').slice(0, 260);
  summary.snippet = snippet;
  summary.preview = summary.preview || snippet;
  summary.body = snippet;
  delete summary.html;
  delete summary.html_body;
  delete summary.body_html;
  delete summary.attachments;
  delete summary.raw;
  delete summary.raw_payload;
  return summary;
}

function eventSummary(event = {}) {
  const summary = { ...event };
  delete summary.raw;
  delete summary.raw_payload;
  delete summary.transcript;
  delete summary.recording;
  delete summary.recordings;
  return summary;
}

function callSummary(call = {}) {
  const summary = { ...call };
  delete summary.raw;
  delete summary.raw_payload;
  delete summary.participants;
  delete summary.recording;
  delete summary.recordings;
  return summary;
}

function workspaceSnapshot(db = {}) {
  return {
    generated_at: new Date().toISOString(),
    users: db.users || [],
    integrations: db.integrations || [],
    leads: db.leads || [],
    tasks: db.tasks || [],
    applications: db.applications || [],
    emails: (db.emails || []).map(emailSummary),
    events: (db.events || []).map(eventSummary),
    meetings: (db.events || []).filter((event) =>
      Boolean(
        event.zoom_meeting_id ||
          event.zoom_meeting_uuid ||
          event.zoom_link ||
          event.meeting_link ||
          String(event.location || '').toLowerCase() === 'zoom' ||
          String(event.campaign || '').toLowerCase().startsWith('zoom')
      )
    ).map(eventSummary),
    calls: (db.zoom?.calls || []).map(callSummary),
    audit: db.audit || [],
    attribution: db.attribution || [],
    notifications: db.notifications || []
  };
}

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
  if (route === '/api/workspace/full' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    const db = await Storage.loadDb();
    return Http.sendJson(res, workspaceSnapshot(db), 200, {}, trace);
  }
  if (route === '/api/developer/config' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Auth.requireDeveloperAccess(req, user);
    return Http.sendJson(res, Auth.developerConfig(req, await Auth.loadDeveloperConfigDb()));
  }
  return NOT_HANDLED;
}

exports.bootstrapRoutes = bootstrapRoutes;
