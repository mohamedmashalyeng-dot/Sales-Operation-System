'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Authorization = require('../authorization');
const DataQuality = require('../data-quality');
const NOT_HANDLED = require('./not-handled');

async function dataQualityRoutes(ctx) {
  const { route, method, res, req, url } = ctx;
  if (route === '/api/data-quality/summary' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await DataQuality.loadSummaryDb({
      stale_days: url.searchParams.get('stale_days')
    }));
  }
  if (route === '/api/data-quality/issues' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await DataQuality.listIssuesDb({
      type: url.searchParams.get('type'),
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      owner_id: url.searchParams.get('owner_id'),
      programme_id: url.searchParams.get('programme_id'),
      source: url.searchParams.get('source'),
      severity: url.searchParams.get('severity'),
      stale_days: url.searchParams.get('stale_days')
    }));
  }
  return NOT_HANDLED;
}

exports.dataQualityRoutes = dataQualityRoutes;
