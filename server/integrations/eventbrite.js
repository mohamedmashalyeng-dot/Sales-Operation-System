'use strict';

const Config = require('../config');
const Util = require('../util');
const Http = require('../http');
const Storage = require('../storage');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Events = require('../events');

function eventbriteRedirectUri(req) {
  return process.env.EVENTBRITE_REDIRECT_URI || `${Http.originFor(req)}/api/integrations/eventbrite/callback`;
}

function eventbriteConfigured() {
  return Boolean(
    process.env.EVENTBRITE_CLIENT_ID &&
    process.env.EVENTBRITE_CLIENT_SECRET &&
    !process.env.EVENTBRITE_CLIENT_ID.includes('your-eventbrite') &&
    !process.env.EVENTBRITE_CLIENT_SECRET.includes('your-eventbrite') &&
    !process.env.EVENTBRITE_CLIENT_ID.includes('replace-with') &&
    !process.env.EVENTBRITE_CLIENT_SECRET.includes('replace-with')
  );
}

function eventbritePrivateTokenConfigured() {
  return Boolean(
    process.env.EVENTBRITE_PRIVATE_TOKEN &&
    !process.env.EVENTBRITE_PRIVATE_TOKEN.includes('your-eventbrite') &&
    !process.env.EVENTBRITE_PRIVATE_TOKEN.includes('replace-with')
  );
}

function eventbriteAuthUrl(req, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.EVENTBRITE_CLIENT_ID,
    redirect_uri: eventbriteRedirectUri(req),
    state
  });
  return `https://www.eventbrite.com/oauth/authorize?${params}`;
}

async function exchangeEventbriteCode(req, code) {
  return Util.fetchJson('https://www.eventbrite.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.EVENTBRITE_CLIENT_ID,
      client_secret: process.env.EVENTBRITE_CLIENT_SECRET,
      redirect_uri: eventbriteRedirectUri(req),
      grant_type: 'authorization_code'
    })
  });
}

function eventbriteAccessToken(db) {
  if (eventbritePrivateTokenConfigured()) return process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!db.eventbrite?.access_token) throw Http.statusError(400, 'Eventbrite is not connected.');
  return db.eventbrite.access_token;
}

async function importEventbriteEvents(db, user, maxEvents = 10, options = {}) {
  if (!eventbriteConfigured() && !eventbritePrivateTokenConfigured()) throw Http.statusError(400, 'Eventbrite credentials are not configured.');
  db.eventbrite ||= { connected: false, imported_event_ids: [], imported_attendee_ids: [] };
  const eventIncrementalStart = Config.EVENTS_INCREMENTAL_ONLY ? Storage.ensureIncrementalStart(db.eventbrite, 'events_incremental_started_at') : null;
  const accessToken = eventbriteAccessToken(db);
  const auth = { Authorization: `Bearer ${accessToken}` };
  const orgList = await Util.fetchJson('https://www.eventbriteapi.com/v3/users/me/organizations/', { headers: auth });
  const events = [];
  const currentEventbriteIds = new Set();
  let eventbriteIdScanComplete = true;
  for (const org of orgList.organizations || []) {
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        expand: 'venue',
        status: 'all',
        page_size: '50',
        page: String(page)
      });
      const list = await Util.fetchJson(`https://www.eventbriteapi.com/v3/organizations/${org.id}/events/?${params}`, { headers: auth, timeoutMs: 12000 });
      for (const event of list.events || []) {
        currentEventbriteIds.add(event.id);
        if (events.length < maxEvents) events.push({ ...event, organization_name: org.name });
      }
      const pagination = list.pagination || {};
      const pageCount = Number(pagination.page_count || page);
      if (!pagination.has_more_items || page >= pageCount || page >= 50) break;
      if (page >= Config.EVENTBRITE_DELETE_SCAN_PAGES) {
        eventbriteIdScanComplete = false;
        break;
      }
      page += 1;
    }
  }
  async function attendeesForEvent(event) {
    const attendees = [];
    let page = 1;
    do {
      const params = new URLSearchParams({ page: String(page) });
      const pageResult = await Util.fetchJson(`https://www.eventbriteapi.com/v3/events/${event.id}/attendees/?${params}`, { headers: auth, timeoutMs: 12000 });
      attendees.push(...(pageResult.attendees || []));
      const pagination = pageResult.pagination || {};
      const pageCount = Number(pagination.page_count || page);
      if (!pagination.has_more_items || page >= pageCount || page >= 50) break;
      page += 1;
    } while (true);
    return attendees;
  }
  const attendeeResults = new Map();
  for (let index = 0; index < events.length; index += 6) {
    const batch = events.slice(index, index + 6);
    const results = await Promise.all(batch.map(async event => {
      try {
        return { event_id: event.id, attendees: await attendeesForEvent(event), error: '' };
      } catch (error) {
        return { event_id: event.id, attendees: [], error: error.message };
      }
    }));
    for (const result of results) attendeeResults.set(result.event_id, result);
  }
  let importedEvents = 0;
  let importedAttendees = 0;
  let attendeeErrors = 0;
  const deletedEventIds = new Set();
  for (const event of events.slice(0, maxEvents)) {
    const eventRecordForMatch = {
      eventbrite_event_id: event.id,
      name: event.name?.text || 'Eventbrite event',
      start_at: event.start?.utc || event.start?.local || new Date().toISOString(),
      location: Events.eventVenue(event)
    };
    let existing = db.events.find(item => item.eventbrite_event_id === event.id);
    const matchingImportedEvent = Events.findSpreadsheetEvent(db, eventRecordForMatch);
    if (existing && matchingImportedEvent && matchingImportedEvent.id !== existing.id) {
      existing.attendees = Events.mergeEventAttendees(existing.attendees || [], matchingImportedEvent.attendees || []);
      db.events = db.events.filter(item => item.id !== matchingImportedEvent.id);
      deletedEventIds.add(matchingImportedEvent.id);
    } else if (!existing) {
      existing = matchingImportedEvent;
    }
    if (Config.EVENTS_INCREMENTAL_ONLY && !existing) {
      const changedAt = new Date(event.changed || event.created || event.start?.utc || event.start?.local || Date.now());
      if (changedAt < eventIncrementalStart) continue;
    }
    const attendeeResult = attendeeResults.get(event.id) || { attendees: [], error: '' };
    let sync_warning = attendeeResult.error ? `Attendees could not be imported: ${attendeeResult.error}` : '';
    if (attendeeResult.error) attendeeErrors += 1;
    const attendees = (attendeeResult.attendees || []).map(attendee => {
      const lead = Events.leadFromAttendee(db, user, attendee, event);
      const profile = attendee.profile || {};
      const fallbackNames = Util.nameParts(profile.name || '', String(profile.email || attendee.email || `${attendee.id}@eventbrite.local`).toLowerCase());
      if (!(db.eventbrite.imported_attendee_ids || []).includes(attendee.id)) {
        db.eventbrite.imported_attendee_ids = [...(db.eventbrite.imported_attendee_ids || []), attendee.id];
        importedAttendees += 1;
      }
      return {
        id: `EB-${attendee.id}`,
        eventbrite_attendee_id: attendee.id,
        lead_id: lead?.id || '',
        first_name: lead?.first_name || profile.first_name || fallbackNames.first_name,
        last_name: lead?.last_name || profile.last_name || fallbackNames.last_name,
        email: lead?.email || String(profile.email || attendee.email || `${attendee.id}@eventbrite.local`).toLowerCase(),
        attended_at: attendee.checked_in ? (attendee.changed || new Date().toISOString()) : null
      };
    });
    const mergedAttendees = Events.mergeEventAttendees(existing?.attendees || [], attendees);
    const record = {
      id: existing?.id || Util.nextId('EV', [db.events]),
      eventbrite_event_id: event.id,
      name: event.name?.text || 'Eventbrite event',
      location: Events.eventVenue(event),
      start_at: event.start?.utc || event.start?.local || new Date().toISOString(),
      created_at: existing?.created_at || event.created || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      campaign: 'Eventbrite',
      capacity: Math.max(Number(existing?.capacity || 0), Number(event.capacity || event.ticket_availability?.quantity_total || mergedAttendees.length || 0)),
      registrations: Math.max(Number(existing?.registrations || 0), mergedAttendees.length),
      attendance: Math.max(Number(existing?.attendance || 0), mergedAttendees.filter(item => item.attended_at).length),
      attendees: mergedAttendees,
      sync_warning
    };
    if (existing) Object.assign(existing, record);
    else {
      db.events.push(record);
      importedEvents += 1;
    }
    if (!(db.eventbrite.imported_event_ids || []).includes(event.id)) db.eventbrite.imported_event_ids = [...(db.eventbrite.imported_event_ids || []), event.id];
  }
  db.eventbrite.last_sync_at = new Date().toISOString();
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Eventbrite synced', 'integration', 'Eventbrite', `${importedEvents} events, ${importedAttendees} attendees${deletedEventIds.size ? `, ${deletedEventIds.size} removed` : ''}${attendeeErrors ? `, ${attendeeErrors} attendee import warnings` : ''}`);
  if (options.save !== false) await Storage.saveDb(db);
  return { imported_events: importedEvents, imported_attendees: importedAttendees, deleted_events: deletedEventIds.size, deleted_event_ids: [...deletedEventIds], deletion_scan_complete: eventbriteIdScanComplete, scanned: events.length, attendee_errors: attendeeErrors, reconciliation, last_sync_at: db.eventbrite.last_sync_at };
}

exports.eventbriteRedirectUri = eventbriteRedirectUri;
exports.eventbriteConfigured = eventbriteConfigured;
exports.eventbritePrivateTokenConfigured = eventbritePrivateTokenConfigured;
exports.eventbriteAuthUrl = eventbriteAuthUrl;
exports.exchangeEventbriteCode = exchangeEventbriteCode;
exports.importEventbriteEvents = importEventbriteEvents;
