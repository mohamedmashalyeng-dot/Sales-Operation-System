'use strict';

const Http = require('../http');
const Auth = require('../auth');
const Business = require('../business');
const BusinessAi = require('../business-ai');
const NOT_HANDLED = require('./not-handled');

const PATHS = { employers: 'employers', 'commercial-opportunities': 'commercialOpportunities', 'employer-agreements': 'employerAgreements', 'das-records': 'dasRecords' };

async function businessRoutes({ route, method, req, res, body, url }) {
  const routingMatch=route.match(/^\/api\/leads\/([^/]+)\/business-route$/);
  if(routingMatch&&['GET','POST'].includes(method)) {
    const user=await Auth.currentSessionUser(req);
    return Http.sendJson(res,await BusinessAi.routing(user,decodeURIComponent(routingMatch[1]),method==='POST'?(body||null):undefined));
  }
  if (route === '/api/business/candidates' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await BusinessAi.candidates(user, Object.fromEntries(url.searchParams)));
  }
  if (route === '/api/business/classify' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await BusinessAi.classify(user, body));
  }
  if (route === '/api/business' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Business.read(user, { ...Object.fromEntries(url.searchParams), limit: url.searchParams.get('limit') || 50, employerName: url.searchParams.get('employer') }));
  }
  const match = route.match(/^\/api\/(employers|commercial-opportunities|employer-agreements|das-records)(?:\/([^/]+))?$/);
  if (match?.[1] === 'employers' && match[2] && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Business.detail(decodeURIComponent(match[2]), user));
  }
  if (!match || !['POST', 'PATCH'].includes(method)) return NOT_HANDLED;
  if ((method === 'POST' && match[2]) || (method === 'PATCH' && !match[2])) return NOT_HANDLED;
  const user = await Auth.currentSessionUser(req);
  const record = await Business.save(PATHS[match[1]], match[2] ? decodeURIComponent(match[2]) : null, body, user);
  return Http.sendJson(res, { record }, method === 'POST' ? 201 : 200);
}

exports.businessRoutes = businessRoutes;
