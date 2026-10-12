'use strict';

const Http = require('../http');
const Meta = require('../integrations/meta');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

// Meta routes that work on the fully loaded workspace (db).
async function metaWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  if (route === '/api/integrations/meta/status' && method === 'GET') {
    return Http.sendJson(res, {
      configured: Meta.metaConfigured(),
      connected: Meta.metaConfigured(),
      page_id: process.env.META_PAGE_ID || null,
      last_sync_at: db.meta?.last_sync_at || null
    });
  }
  if (route === '/api/integrations/meta/sync' && method === 'POST') {
    Authorization.requireTeam(user);
    const result = await Meta.importMetaLeads(db, user, Number(body.max_leads || 50));
    return Http.sendJson(res, result);
  }
  return NOT_HANDLED;
}

exports.metaWorkspaceRoutes = metaWorkspaceRoutes;
