'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Authorization = require('../authorization');
const IntegrationCentre = require('../integration-centre');
const NOT_HANDLED = require('./not-handled');

async function integrationCentreRoutes(ctx) {
  const { route, method, res, req, body } = ctx;
  const detailMatch = route.match(/^\/api\/integrations\/([^/]+)$/);
  const syncMatch = route.match(/^\/api\/integrations\/control\/([^/]+)\/sync$/);
  if (route === '/api/integrations/overview' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await IntegrationCentre.overview(req));
  }
  if (detailMatch && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await IntegrationCentre.detail(req, decodeURIComponent(detailMatch[1])));
  }
  if (syncMatch && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    const payload = await IntegrationCentre.startSync(req, user, decodeURIComponent(syncMatch[1]), body || {});
    return Http.sendJson(res, payload, 202);
  }
  return NOT_HANDLED;
}

exports.integrationCentreRoutes = integrationCentreRoutes;
