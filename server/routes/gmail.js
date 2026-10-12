'use strict';

const crypto = require('node:crypto');
const Config = require('../config');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Gmail = require('../integrations/gmail');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

// Gmail routes that work on the fully loaded workspace (db).
async function gmailWorkspaceRoutes(ctx) {
  const { route, method, res, body, req, url, db, user } = ctx;
  // GET /api/bootstrap and GET /api/developer/config are handled by the lightweight
  // handlers earlier in this function. They intentionally return before this point so a
  // full workspace is never loaded for a page refresh.
  if (route === '/api/integrations/gmail/status' && method === 'GET') {
    const gmailNeedsReconnect = Boolean(db.gmail?.reconnect_required || db.gmail?.last_error);
    return Http.sendJson(res, {
      configured: Gmail.gmailConfigured(),
      connected: Boolean(db.gmail?.connected && !gmailNeedsReconnect),
      email: db.gmail?.email || null,
      last_sync_at: db.gmail?.last_sync_at || null,
      reconnect_required: gmailNeedsReconnect,
      last_error: gmailNeedsReconnect ? 'Gmail token expired or revoked. Reconnect Gmail from Settings.' : null,
      auto_sync: State.gmailAutoSyncState,
      import_enabled: Config.GMAIL_IMPORT_ENABLED,
      redirect_uri: Gmail.gmailRedirectUri(req)
    });
  }
  if (route === '/api/integrations/gmail/connect' && method === 'GET') {
    Authorization.requireTeam(user);
    if (!Gmail.gmailConfigured()) throw Http.statusError(400, 'Gmail credentials are not configured. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to .env.');
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session) throw Http.statusError(401, 'Sign in to continue.');
    const gmailState = crypto.randomBytes(16).toString('hex');
    await Auth.patchSession(sid, { gmail_state: gmailState });
    res.writeHead(302, { Location: Gmail.gmailAuthUrl(req, gmailState) });
    return res.end();
  }
  if (route === '/api/integrations/gmail/callback' && method === 'GET') {
    const sid = Http.parseCookies(req).sid;
    const session = await Auth.getSession(sid);
    if (!session || !session.gmail_state || session.gmail_state !== url.searchParams.get('state')) {
      res.writeHead(302, { Location: '/#/settings?gmail=session-expired' });
      return res.end();
    }
    const code = url.searchParams.get('code');
    if (!code) throw Http.statusError(400, url.searchParams.get('error') || 'Gmail did not return an authorization code.');
    const token = await Gmail.exchangeGmailCode(req, code);
    const profile = await Util.fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token.access_token}` } });
    db.gmail = {
      ...(db.gmail || {}),
      connected: true,
      email: profile.emailAddress || '',
      access_token: token.access_token,
      refresh_token: token.refresh_token || db.gmail?.refresh_token,
      expires_at: Date.now() + ((token.expires_in || 3600) - 60) * 1000,
      connected_at: new Date().toISOString(),
      reconnect_required: false,
      last_error: '',
      imported_message_ids: db.gmail?.imported_message_ids || []
    };
    Audit.addAudit(db, user, 'Gmail connected', 'integration', 'Gmail', db.gmail.email);
    await Storage.saveDb(db);
    res.writeHead(302, { Location: '/#/zoho?connected=1' });
    return res.end();
  }
  if (route === '/api/integrations/gmail/sync' && method === 'POST') {
    Authorization.requireTeam(user);
    if (!Config.GMAIL_IMPORT_ENABLED) throw Http.statusError(403, 'Gmail import is paused. Existing emails remain available.');
    let result;
    try {
      result = await Gmail.importGmailMessages(db, user, Number(body.max_results || 10), {
        latest: body.latest === undefined ? true : Boolean(body.latest),
        skipTrash: Boolean(body.skip_trash),
        forceTrash: Boolean(body.force_trash)
      });
    } catch (error) {
      if (Gmail.gmailReconnectError(error.message)) throw await Gmail.markGmailReconnectRequired(db, error.message);
      throw error;
    }
    return Http.sendJson(res, result);
  }
  return NOT_HANDLED;
}

exports.gmailWorkspaceRoutes = gmailWorkspaceRoutes;
