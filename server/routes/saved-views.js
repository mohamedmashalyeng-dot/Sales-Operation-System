'use strict';

const Http = require('../http');
const Auth = require('../auth');
const SavedViews = require('../saved-views');
const NOT_HANDLED = require('./not-handled');

async function savedViewsRoutes(ctx) {
  const { route, method, res, req, url, body } = ctx;
  let match = null;
  if (route === '/api/saved-views' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await SavedViews.listSavedViews(user, url.searchParams.get('entity_type') || ''));
  }
  if (route === '/api/saved-views' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await SavedViews.createSavedView(user, body), 201);
  }
  match = route.match(/^\/api\/saved-views\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await SavedViews.updateSavedView(user, match[1], body));
  }
  if (match && method === 'DELETE') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await SavedViews.deleteSavedView(user, match[1]));
  }
  return NOT_HANDLED;
}

exports.savedViewsRoutes = savedViewsRoutes;
