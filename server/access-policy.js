'use strict';
const Auth = require('./auth');
const Http = require('./http');
const Authorization = require('./authorization');

// An authenticated identity supplies its role. Request bodies, query strings and
// browser role preferences can never grant a capability. New staff routes deny by default.
function requireRoute(user, route, method, body = {}) {
  const role = Auth.canonicalWorkspaceRole(user?.role);
  if (!['admin','manager','sales','enrolment'].includes(role)) throw Http.statusError(403,'Your account has no active workspace role.');
  if (Auth.permissionsForUser(user).developer || Authorization.isTeam(user)) return;
  if (role === 'sales' && (route === '/api/applications' && method === 'POST' && body.already_enrolled
    || /^\/api\/(leads\/[^/]+(?:\/journey-stage)?|call-reviews\/[^/]+\/decision)$/.test(route) && /^enrolled$/i.test(String(body.stage || '')))) {
    throw Http.statusError(403,'Only enrolment staff or managers can record enrolment.');
  }
  const read = method === 'GET';
  let allowed = ['/api/bootstrap','/api/logout','/api/password'].includes(route);
  if (/^\/api\/leads\/[^/]+\/business-route$/.test(route) && ['GET','POST'].includes(method)) allowed = true;
  if (read && /^\/api\/(notifications(?:\/unread-count)?|saved-views|documents(?:\/[^/]+\/download)?|search|activity)$/.test(route)) allowed = true;
  if (/^\/api\/(notifications\/[^/]+\/(read|unread)|notifications\/read-all|saved-views(?:\/[^/]+)?)$/.test(route)) allowed = true;
  if (read && /^\/api\/dashboard\/(today|my-day|summary|pipeline|my-work|priority-leads|source-performance|activity|search)$/.test(route)) allowed = true;
  if (read && route === '/api/analytics/overview') allowed = true;
  if (/^\/api\/leads(?:\/[^/]+(?:\/(timeline|emails|tasks|application|applications|meetings|calls|files|notes|opportunities|ai-analysis|call-journey|journey-stage))?)?$/.test(route)) {
    allowed = method !== 'DELETE' && !(route === '/api/leads/reconcile');
    if (role === 'enrolment' && method === 'POST' && route === '/api/leads') allowed = false;
  }
  if (/^\/api\/(calls|tasks(?:\/[^/]+(?:\/(complete|reopen))?)?|emails(?:\/[^/]+(?:\/(resolve|read|reply))?)?)$/.test(route)) allowed = true;
  if (/^\/api\/call-reviews(?:\/[^/]+(?:\/decision)?)?$/.test(route) || read && /^\/api\/zoom\/calls\/[^/]+$/.test(route)) allowed = true;
  if (read && /^\/api\/(applications(?:\/[^/]+)?|admissions\/(pipeline|stage\/[^/]+)|evidence\/[^/]+\/file|document-templates\/[^/]+\/file)$/.test(route)) allowed = true;
  // Sales can prepare an application/evidence; only Enrolment can approve or enrol.
  if (method === 'POST' && (route === '/api/applications' || /^\/api\/applications\/[^/]+\/evidence$/.test(route))) allowed = true;
  if (role === 'enrolment' && (/^\/api\/applications\/[^/]+\/(review|contract|enrol|status)$/.test(route) || /^\/api\/evidence\/[^/]+(?:\/review)?$/.test(route))) allowed = method !== 'GET';
  if (read && (route === '/api/business' || route === '/api/business/candidates' || /^\/api\/employers\/[^/]+$/.test(route))) allowed = true;
  if (route === '/api/business/classify' && method === 'POST') allowed = true;
  if (/^\/api\/commercial-opportunities(?:\/[^/]+)?$/.test(route) && ['POST','PATCH'].includes(method)) allowed = true;
  if (!allowed) throw Http.statusError(403,'Your workspace role does not allow this action.');
}

async function requireApplicationReview(user, entity, id, db = null) {
  if (!Authorization.isTeam(user) && Auth.canonicalWorkspaceRole(user.role) !== 'enrolment') throw Http.statusError(403,'Only enrolment staff or managers can approve applications.');
  await Authorization.requireRecord(user,entity,id,db);
}
exports.requireRoute = requireRoute;
exports.requireApplicationReview = requireApplicationReview;
