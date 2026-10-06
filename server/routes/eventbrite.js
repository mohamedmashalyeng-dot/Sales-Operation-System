'use strict';

const crypto = require('node:crypto');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Events = require('../events');
const Eventbrite = require('../integrations/eventbrite');
const NOT_HANDLED = require('./not-handled');

// Eventbrite routes that work on the fully loaded workspace (db).
async function eventbriteWorkspaceRoutes(ctx) {
  const { route, method, res, body, req, url, db, user } = ctx;
  if (route === '/api/integrations/eventbrite/status' && method === 'GET') {
    return Http.sendJson(res, {
      configured: Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured(),
      connected: Boolean(db.eventbrite?.connected || Eventbrite.eventbritePrivateTokenConfigured()),
      name: db.eventbrite?.name || null,
      last_sync_at: db.eventbrite?.last_sync_at || null,
      auto_sync: State.eventAutoSyncState,
      redirect_uri: Eventbrite.eventbriteRedirectUri(req)
    });
  }
  if (route === '/api/integrations/eventbrite/connect' && method === 'GET') {
    if (!Eventbrite.eventbriteConfigured()) throw Http.statusError(400, 'Eventbrite credentials are not configured. Add EVENTBRITE_CLIENT_ID and EVENTBRITE_CLIENT_SECRET to .env.');
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session) throw Http.statusError(401, 'Sign in to continue.');
    const eventbriteState = crypto.randomBytes(16).toString('hex');
    await Auth.patchSession(sid, { eventbrite_state: eventbriteState });
    res.writeHead(302, { Location: Eventbrite.eventbriteAuthUrl(req, eventbriteState) });
    return res.end();
  }
  if (route === '/api/integrations/eventbrite/callback' && method === 'GET') {
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session || !session.eventbrite_state || session.eventbrite_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?eventbrite=session-expired' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw Http.statusError(400, url.searchParams.get('error') || 'Eventbrite did not return an authorization code.');
    const token = await Eventbrite.exchangeEventbriteCode(req, code);
    const profile = await Util.fetchJson('https://www.eventbriteapi.com/v3/users/me/', { headers: { Authorization: `Bearer ${token.access_token}` } });
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
    Audit.addAudit(db, user, 'Eventbrite connected', 'integration', 'Eventbrite', db.eventbrite.name);
    await Storage.saveDb(db);
    res.writeHead(302, { Location: '/#/settings' });
    return res.end();
  }
  if (route === '/api/integrations/eventbrite/sync' && method === 'POST') {
    const result = await Eventbrite.importEventbriteEvents(db, user, Number(body.max_events || 10), { save: false });
    await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true, deleteEventIds: result.deleted_event_ids || [] });
    return Http.sendJson(res, result);
  }
  return NOT_HANDLED;
}

exports.eventbriteWorkspaceRoutes = eventbriteWorkspaceRoutes;
