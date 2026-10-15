'use strict';

const State = require('../state');
const Http = require('../http');
const Auth = require('../auth');
const Events = require('../events');
const Zoom = require('../integrations/zoom');
const Authorization = require('../authorization');
const NOT_HANDLED = require('./not-handled');

// Zoom routes that read and write the database directly.
async function zoomRoutes(ctx) {
  const { route, method, res, trace, body, req, url } = ctx;
  if (route === '/api/zoom/overview' && method === 'GET') {
    Authorization.requireTeam(await Auth.currentSessionUser(req, trace));
    return Http.sendJson(res, await Zoom.loadZoomOverviewDb({ now: url.searchParams.get('now'),
      day_start: url.searchParams.get('day_start'), day_end: url.searchParams.get('day_end') }, trace), 200, {}, trace);
  }
  const meeting = route.match(/^\/api\/zoom\/meetings\/([^/]+)$/);
  if (meeting && method === 'GET') {
    Authorization.requireTeam(await Auth.currentSessionUser(req));
    return Http.sendJson(res, await Zoom.loadZoomMeetingDetailDb(decodeURIComponent(meeting[1]), { offset: url.searchParams.get('offset') }));
  }
  if (route === '/api/zoom/events' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    Authorization.requireTeam(user);
    const page = await Zoom.loadZoomEventPageDb({ limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor'), search: url.searchParams.get('search') }, trace);
    return Http.sendJson(res, { events: page.items, has_more: page.has_more, hasMore: page.hasMore, next_cursor: page.next_cursor, nextCursor: page.nextCursor, limit: page.limit }, 200, {}, trace);
  }
  // Zoom meetings under the generic name; default page of 50, newest first.
  if (route === '/api/meetings' && method === 'GET') {
    const user = await Auth.currentSessionUser(req, trace);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Zoom.loadZoomEventPageDb({
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
      start_from: url.searchParams.get('start_from'),
      start_to: url.searchParams.get('start_to'),
      date_from: url.searchParams.get('date_from'),
      date_to: url.searchParams.get('date_to'),
      owner_id: url.searchParams.get('owner_id'),
      owner: url.searchParams.get('owner'),
      lead_id: url.searchParams.get('lead_id'),
      contact: url.searchParams.get('contact'),
      provider: url.searchParams.get('provider'),
      search: url.searchParams.get('search')
    }, trace), 200, {}, trace);
  }
  if (route === '/api/zoom/calls' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Zoom.loadZoomCallPageDb({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      direction: url.searchParams.get('direction'),
      status: url.searchParams.get('status'),
      match: url.searchParams.get('match'),
      search: url.searchParams.get('search')
    }));
  }
  if (route === '/api/zoom/numbers' && method === 'GET') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Zoom.loadZoomNumberPageDb(url.searchParams.get('limit'), url.searchParams.get('offset')));
  }
  if (route === '/api/integrations/zoom/sync' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    const db = await Zoom.loadZoomSyncWorkspace();
    const result = await Zoom.importZoomMeetings(db, user, Number(body.max_meetings || body.max_events || process.env.ZOOM_MAX_MEETINGS || 500), {
      save: false,
      report_history_months: body.report_history_months || body.history_months,
      history_from: body.history_from
    });
    await Events.saveEventImportTables(db, { preserveGmail: true, skipLeads: !result.scanned, skipTasks: !result.scanned, skipAudit: !result.scanned });
    return Http.sendJson(res, result);
  }
  if (route === '/api/integrations/zoom/calls/sync' && method === 'POST') {
    const user = await Auth.currentSessionUser(req);
    Authorization.requireTeam(user);
    const db = await Zoom.loadZoomSyncWorkspace();
    const result = await Zoom.importZoomCalls(db, user, Number(body.max_calls || process.env.ZOOM_MAX_CALLS || 1000), {
      save: false,
      max_calls: body.max_calls,
      call_history_months: body.call_history_months
    });
    await Events.saveEventImportTables(db, { preserveGmail: true, skipLeads: !result.scanned, skipTasks: !result.scanned, skipAudit: !result.scanned });
    return Http.sendJson(res, result);
  }
  return NOT_HANDLED;
}

// Zoom routes that work on the fully loaded workspace (db).
async function zoomWorkspaceRoutes(ctx) {
  const { route, method, res, body, url, db, user } = ctx;
  if (route === '/api/integrations/zoom/status' && method === 'GET') {
    const accounts = Zoom.zoomAccounts();
    return Http.sendJson(res, {
      configured: Zoom.zoomConfigured(),
      connected: Zoom.zoomConfigured(),
      user_id: Zoom.zoomSyncAllUsers() ? `all users across ${accounts.length} accounts` : (process.env.ZOOM_USER_ID || 'me'),
      meeting_type: Zoom.zoomMeetingType(),
      report_history_months: Zoom.zoomReportHistoryMonths(),
      history_months: Zoom.zoomReportHistoryMonths(),
      history_from: process.env.ZOOM_HISTORY_FROM || null,
      all_users: Zoom.zoomSyncAllUsers(),
      accounts: accounts.length,
      last_sync_at: db.zoom?.last_sync_at || null,
      last_call_sync_at: db.zoom?.last_call_sync_at || null,
      auto_sync: State.zoomAutoSyncState
    });
  }
  if (route === '/api/integrations/zoom/sync' && method === 'POST') {
    Authorization.requireTeam(user);
    const result = await Zoom.importZoomMeetings(db, user, Number(body.max_meetings || body.max_events || process.env.ZOOM_MAX_MEETINGS || 500), {
      save: false,
      report_history_months: body.report_history_months || body.history_months,
      history_from: body.history_from
    });
    await Events.saveEventImportTables(db, { preserveGmail: true, skipLeads: !result.scanned, skipTasks: !result.scanned, skipAudit: !result.scanned });
    return Http.sendJson(res, result);
  }
  if (route === '/api/zoom/calls' && method === 'GET') {
    Authorization.requireTeam(user);
    return Http.sendJson(res, await Zoom.loadZoomCallPageDb({
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
      direction: url.searchParams.get('direction'),
      status: url.searchParams.get('status'),
      match: url.searchParams.get('match'),
      search: url.searchParams.get('search')
    }));
  }
  if (route === '/api/integrations/zoom/calls/sync' && method === 'POST') {
    Authorization.requireTeam(user);
    const result = await Zoom.importZoomCalls(db, user, Number(body.max_calls || process.env.ZOOM_MAX_CALLS || 1000), {
      save: false,
      max_calls: body.max_calls,
      call_history_months: body.call_history_months
    });
    await Events.saveEventImportTables(db, { preserveGmail: true, skipLeads: !result.scanned, skipTasks: !result.scanned, skipAudit: !result.scanned });
    return Http.sendJson(res, result);
  }
  return NOT_HANDLED;
}

exports.zoomRoutes = zoomRoutes;
exports.zoomWorkspaceRoutes = zoomWorkspaceRoutes;
