'use strict';

const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Auth = require('../auth');
const Audit = require('../audit');
const Events = require('../events');
const NOT_HANDLED = require('./not-handled');

// Events routes that read and write the database directly.
async function eventsRoutes(ctx) {
  const { route, method, res, trace, req, url } = ctx;
  let lightweightMatch = null;
  lightweightMatch = route.match(/^\/api\/events\/([^/]+)$/);
  if (lightweightMatch && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Events.loadEventDetailDb(decodeURIComponent(lightweightMatch[1]), trace), 200, {}, trace);
  }
  if (route === '/api/events' && method === 'GET') {
    await Auth.currentSessionUser(req, trace);
    return Http.sendJson(res, await Events.loadEventPage({
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      upcoming: url.searchParams.get('upcoming'),
      include_total: url.searchParams.get('include_total')
    }, trace), 200, {}, trace);
  }
  lightweightMatch = route.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
  if (lightweightMatch && method === 'POST' && State.postgresPool) {
    const user = await Auth.currentSessionUser(req);
    return Http.sendJson(res, await Events.checkInAttendeeFastDb(lightweightMatch[1], user));
  }
  return NOT_HANDLED;
}

// Events routes that work on the fully loaded workspace (db).
async function eventsWorkspaceRoutes(ctx) {
  const { route, method, res, body, db, user } = ctx;
  let match = null;
  if (route === '/api/events/import' && method === 'POST') {
    if (!Auth.permissions(user.role).sales) throw Http.statusError(403, 'You do not have permission to import events.');
    const result = await Events.importSpreadsheetEvents(db, user, body);
    await Events.saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
    return Http.sendJson(res, result, 201);
  }

  match = route.match(/^\/api\/attendees\/([^/]+)\/checkin$/);
  if (match && method === 'POST') {
    const attendee = db.events.flatMap(event => event.attendees || []).find(item => item.id === match[1]);
    if (!attendee) throw Http.statusError(404, 'Attendee not found.');
    attendee.attended_at = attendee.attended_at || new Date().toISOString();
    const lead = attendee.lead_id ? db.leads.find(item => item.id === attendee.lead_id) : null;
    if (lead) {
      db.tasks.push({
        id: Util.nextId('T', [db.tasks]),
        title: `Follow up after event attendance`,
        lead_id: lead.id,
        kind: 'Follow-up',
        status: 'Open',
        created_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 86400000).toISOString(),
        priority: lead.priority,
        owner_id: lead.owner_id
      });
      Audit.addAudit(db, user, 'Event attendee checked in', 'lead', lead.id, `${attendee.first_name} ${attendee.last_name}`);
    }
    await Storage.saveDb(db);
    return Http.sendJson(res, { ok: true });
  }
  return NOT_HANDLED;
}

exports.eventsRoutes = eventsRoutes;
exports.eventsWorkspaceRoutes = eventsWorkspaceRoutes;
