'use strict';

const Http = require('../http');
const Apollo = require('../integrations/apollo');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

// Apollo routes that work on the fully loaded workspace (db).
async function apolloWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  if (route === '/api/integrations/apollo/status' && method === 'GET') {
    return Http.sendJson(res, {
      configured: Apollo.apolloConfigured(),
      connected: Apollo.apolloConfigured(),
      keywords: process.env.APOLLO_KEYWORDS || null,
      titles: Apollo.csvEnv('APOLLO_PERSON_TITLES'),
      last_sync_at: db.apollo?.last_sync_at || null
    });
  }
  if (route === '/api/integrations/apollo/sync' && method === 'POST') {
    Authorization.requireTeam(user);
    const result = await Apollo.importApolloPeople(db, user, Number(body.max_people || body.max_leads || 25));
    return Http.sendJson(res, result);
  }
  return NOT_HANDLED;
}

exports.apolloWorkspaceRoutes = apolloWorkspaceRoutes;
