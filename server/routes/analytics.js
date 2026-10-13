'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Analytics = require('../analytics');
const NOT_HANDLED = require('./not-handled');

async function analyticsRoutes(ctx) {
  const { route, method, res, req, url } = ctx;
  if (route === '/api/analytics/overview' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Analytics.overview(url, user));
  }
  if (route === '/api/analytics/diagnose' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Analytics.diagnose(url, user));
  }
  return NOT_HANDLED;
}

exports.analyticsRoutes = analyticsRoutes;
