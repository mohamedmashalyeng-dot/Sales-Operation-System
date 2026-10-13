'use strict';

const Http = require('../http');
const Auth = require('../auth');
const AdminAudit = require('../admin-audit');
const NOT_HANDLED = require('./not-handled');

async function adminAuditRoutes(ctx) {
  const { route, method, res, req, url } = ctx;
  if (route === '/api/admin-audit/overview' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await AdminAudit.overview(user, req));
  }
  if (route === '/api/admin-audit/audit' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await AdminAudit.listAudit(user, {
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      actor: url.searchParams.get('actor'),
      action: url.searchParams.get('action'),
      entity: url.searchParams.get('entity'),
      entity_id: url.searchParams.get('entity_id'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to')
    }));
  }
  return NOT_HANDLED;
}

exports.adminAuditRoutes = adminAuditRoutes;
