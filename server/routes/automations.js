'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Automations = require('../automations');
const NOT_HANDLED = require('./not-handled');

async function automationsRoutes(ctx) {
  const { route, method, res, req, url, body } = ctx;
  let match = null;

  if (route === '/api/automations/status' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.status());
  }

  if (route === '/api/automations/run-worker' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.processPendingJobs({ limit: body.limit || 10 }));
  }

  if (route === '/api/automations/examples' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.seedDisabledExamples(user), 201);
  }

  if (route === '/api/automations' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.listRules({ limit: url.searchParams.get('limit') }));
  }

  if (route === '/api/automations' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Automations.saveRule(body, user), 201);
  }

  if (route === '/api/automations/preview' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.previewRule(body, body));
  }

  match = route.match(/^\/api\/automations\/([^/]+)$/);
  if (match && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, { rule: await Automations.getRule(decodeURIComponent(match[1])) });
  }

  if (match && method === 'PATCH') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Automations.saveRule(body, user, decodeURIComponent(match[1])));
  }

  match = route.match(/^\/api\/automations\/([^/]+)\/preview$/);
  if (match && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.previewRule(decodeURIComponent(match[1]), body));
  }

  match = route.match(/^\/api\/automations\/([^/]+)\/enable$/);
  if (match && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Automations.setRuleStatus(decodeURIComponent(match[1]), 'enabled', user));
  }

  match = route.match(/^\/api\/automations\/([^/]+)\/disable$/);
  if (match && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Automations.setRuleStatus(decodeURIComponent(match[1]), 'disabled', user));
  }

  match = route.match(/^\/api\/automations\/([^/]+)\/runs$/);
  if (match && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Automations.requireAutomationAccess(user);
    return Http.sendJson(res, await Automations.listRuns(decodeURIComponent(match[1]), { limit: url.searchParams.get('limit') }));
  }

  return NOT_HANDLED;
}

exports.automationsRoutes = automationsRoutes;
