'use strict';
const Http = require('../http');
const Auth = require('../auth');
const Util = require('../util');
const Store = require('../call-journey-store');
const Journey = require('../call-journey');
const Policy = require('../call-journey-policy');
const NOT_HANDLED = require('./not-handled');
async function webhookRoutes({ route, method, req, res, body }) {
  if (route !== '/api/integrations/call-evaluation/webhook' || method !== 'POST') return NOT_HANDLED;
  Policy.verify(req, req.rawBody || Buffer.alloc(0));
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw Http.statusError(415, 'Send a JSON call result.');
  const result = await Journey.receive(body);
  return Http.sendJson(res, result, result.duplicate ? 200 : 202);
}
async function callJourneyRoutes({ route, method, req, res, body, url }) {
  let match;
  if (route === '/api/call-reviews' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    const rows = await Store.results({ assigneeId: user.id, pending: true, limit: 21 });
    return Http.sendJson(res, { items: rows.slice(0, 20).map(row => ({ event_id: row.event_id, call_id: row.call_id, lead_id: row.lead_id,
      lead_name: row.lead_name, received_at: row.received_at, suggested_stage: row.suggested_stage })), has_more: rows.length > 20 });
  }
  match = route.match(/^\/api\/call-reviews\/([^/]+)(\/decision)?$/);
  if (match && ((method === 'GET' && !match[2]) || (method === 'POST' && match[2]))) {
    const user = await Auth.currentSessionUser(req);
    const id = decodeURIComponent(match[1]);
    return Http.sendJson(res, method === 'GET' ? await Journey.getReview(id, user) : await Journey.confirm(id, body, user));
  }
  match = route.match(/^\/api\/leads\/([^/]+)\/(call-journey|journey-stage)$/);
  if (match && ((match[2] === 'call-journey' && method === 'GET') || (match[2] === 'journey-stage' && method === 'POST'))) {
    const user = await Auth.currentSessionUser(req);
    const id = decodeURIComponent(match[1]);
    if (method === 'POST') return Http.sendJson(res, await Journey.manualStage(id, body, user));
    if (url.searchParams.get('summary') === '1') return Http.sendJson(res, await Journey.summary(id, user));
    const offset = Math.min(100000, Math.max(0, Number.parseInt(url.searchParams.get('history_offset'), 10) || 0));
    const cursor = Util.decodePageCursor(url.searchParams.get('calls_before'), 'call history cursor');
    if (cursor && (typeof cursor.at !== 'string' || !Number.isFinite(Date.parse(cursor.at)) || typeof cursor.id !== 'string')) throw Http.statusError(400, 'Invalid call history cursor.');
    return Http.sendJson(res, await Journey.journey(id, user, offset, cursor));
  }
  match = route.match(/^\/api\/zoom\/calls\/([^/]+)$/);
  if (match && method === 'GET') return Http.sendJson(res, await Journey.callDetail(decodeURIComponent(match[1]), await Auth.currentSessionUser(req)));
  return NOT_HANDLED;
}
exports.webhookRoutes = webhookRoutes; exports.callJourneyRoutes = callJourneyRoutes;
