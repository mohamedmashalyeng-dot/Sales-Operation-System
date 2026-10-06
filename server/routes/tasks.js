'use strict';

const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Leads = require('../leads');
const Tasks = require('../tasks');
const NOT_HANDLED = require('./not-handled');

// Tasks routes that read and write the database directly.
async function tasksRoutes(ctx) {
  const { route, method, res, trace, body, req, url } = ctx;
  let lightweightMatch = null;
  if (route === '/api/tasks' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    const params = Object.fromEntries(['limit', 'status', 'offset', 'cursor', 'today_start', 'tomorrow_start', 'bucket', 'search', 'owner_id', 'lead_id', 'due_before', 'due_after', 'include_counts']
      .map(name => [name, url.searchParams.get(name)]));
    return Http.sendJson(res, await Tasks.loadTaskPage(params, trace), 200, {}, trace);
  }
  if (route === '/api/tasks' && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Tasks.createTaskFastDb(body, user), 201);
  }
  lightweightMatch = route.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Tasks.completeTaskFastDb(lightweightMatch[1], user));
  }
  lightweightMatch = route.match(/^\/api\/tasks\/([^/]+)$/);
  if (lightweightMatch && method === 'DELETE' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    if (!Auth.permissionsForUser(user).sales) throw Http.statusError(403, 'You do not have permission to delete tasks.');
    return Http.sendJson(res, await Tasks.deleteTaskFastDb(lightweightMatch[1], user));
  }
  return NOT_HANDLED;
}

// Tasks routes that work on the fully loaded workspace (db).
async function tasksWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  let match = null;
  if (route === '/api/tasks' && method === 'POST') {
    const lead = Leads.leadFor(db, body.lead_id);
    db.tasks.push({ id: Util.nextId('T', [db.tasks]), title: body.title, lead_id: lead.id, kind: body.kind, status: 'Open', created_at: new Date().toISOString(), due_at: body.due_at, priority: body.priority, owner_id: body.owner_id });
    Audit.addAudit(db, user, 'Task created', 'lead', lead.id, body.title);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true }, 201);
  }

  match = route.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  if (match && method === 'POST') {
    const task = db.tasks.find(item => item.id === match[1]);
    if (!task) throw Http.statusError(404, 'Task not found.');
    task.status = 'Done';
    task.completed_at = new Date().toISOString();
    Audit.addAudit(db, user, 'Task completed', 'lead', task.lead_id, task.title);
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }
  return NOT_HANDLED;
}

exports.tasksRoutes = tasksRoutes;
exports.tasksWorkspaceRoutes = tasksWorkspaceRoutes;
