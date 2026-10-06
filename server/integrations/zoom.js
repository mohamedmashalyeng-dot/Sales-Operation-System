'use strict';

const Config = require('../config');
const State = require('../state');
const Util = require('../util');
const Http = require('../http');
const Perf = require('../perf');
const Storage = require('../storage');
const Workspace = require('../workspace');
const Audit = require('../audit');
const Tasks = require('../tasks');
const Emails = require('../emails');
const Events = require('../events');
const Jobs = require('../jobs');

let zoomAutoSyncTimer = null;

function mergeZoomState(currentZoom = {}, nextZoom = {}) {
  const currentCalls = Array.isArray(currentZoom.calls) ? currentZoom.calls : [];
  const nextCalls = Array.isArray(nextZoom.calls) ? nextZoom.calls : [];
  if (!currentCalls.length && !nextCalls.length) return { ...currentZoom, ...nextZoom };
  const byId = new Map();
  for (const call of currentCalls) {
    if (call?.id) byId.set(call.id, call);
  }
  for (const call of nextCalls) {
    if (call?.id) byId.set(call.id, { ...(byId.get(call.id) || {}), ...call });
  }
  const limit = Math.max(currentCalls.length, nextCalls.length, Number(process.env.ZOOM_MAX_CALLS || 5000));
  return {
    ...currentZoom,
    ...nextZoom,
    calls: [...byId.values()]
      .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))
      .slice(0, limit)
  };
}

function isZoomEventRecord(event = {}) {
  return Boolean(
    event.zoom_meeting_id ||
    event.zoom_meeting_uuid ||
    String(event.campaign || '').toLowerCase().startsWith('zoom') ||
    String(event.location || '').toLowerCase() === 'zoom'
  );
}

async function loadZoomEventListDb(limit = 2000) {
  return (await loadZoomEventPageDb({ limit })).items;
}

function publicMeetingSummary(event = {}) {
  const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : Number(event.attendee_count || 0);
  const summary = { ...event, attendee_count: attendeeCount };
  delete summary.attendees;
  delete summary.transcript;
  delete summary.recording;
  delete summary.recordings;
  delete summary.raw;
  delete summary.raw_payload;
  return summary;
}

async function loadZoomEventPageDb(options = {}, trace = null) {
  await Perf.perfPhase(trace, 'meetings_storage', () => Storage.ensureStorage());
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50;
  const cursor = Util.decodePageCursor(options.cursor, 'meeting cursor');
  const filters = {
    startFrom: Tasks.parseOptionalIsoDate(options.start_from || options.date_from, 'start_from'),
    startTo: Tasks.parseOptionalIsoDate(options.start_to || options.date_to, 'start_to'),
    owner: String(options.owner || options.owner_id || '').trim(),
    lead: String(options.lead_id || '').trim(),
    contact: String(options.contact || options.contact_id || '').trim(),
    provider: String(options.provider || 'zoom').trim().toLowerCase(),
    search: String(options.search || '').trim().slice(0, 200)
  };
  if (filters.provider && filters.provider !== 'zoom') throw Http.statusError(400, 'Only Zoom meetings are available here.');
  if (State.postgresPool) {
    const values = [];
    const conditions = [
      `(coalesce(e.data->>'zoom_meeting_id', '') <> ''
        or coalesce(e.data->>'zoom_meeting_uuid', '') <> ''
        or lower(coalesce(e.location, e.data->>'location', '')) = 'zoom'
        or lower(coalesce(e.campaign, e.data->>'campaign', '')) like 'zoom%')`
    ];
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (filters.startFrom) conditions.push(`e.start_at >= ${bind(filters.startFrom)}::timestamptz`);
    if (filters.startTo) conditions.push(`e.start_at < ${bind(filters.startTo)}::timestamptz`);
    if (filters.owner) {
      const ownerParam = bind(filters.owner);
      conditions.push(`(e.data->>'zoom_host_id' = ${ownerParam} or e.data->>'zoom_host_label' = ${ownerParam} or e.data->>'owner_id' = ${ownerParam})`);
    }
    if (filters.lead) {
      const leadParam = bind(filters.lead);
      conditions.push(`exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a
        where a->>'lead_id' = ${leadParam}
      )`);
    }
    if (filters.contact) {
      const contactParam = bind(filters.contact.toLowerCase());
      conditions.push(`exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a
        where lower(coalesce(a->>'id', a->>'email', a->>'phone', '')) = ${contactParam}
      )`);
    }
    if (filters.search) {
      const term = bind(`%${Tasks.escapeSqlLike(filters.search)}%`);
      conditions.push(`(
        e.name ilike ${term} or e.location ilike ${term} or e.campaign ilike ${term}
        or e.data->>'zoom_host_label' ilike ${term} or e.data->>'zoom_host_id' ilike ${term} or e.data->>'zoom_meeting_id' ilike ${term}
      )`);
    }
    if (cursor?.id) {
      if (cursor.start_at) {
        const startParam = bind(cursor.start_at);
        const idParam = bind(String(cursor.id || ''));
        conditions.push(`(e.start_at < ${startParam}::timestamptz or (e.start_at = ${startParam}::timestamptz and e.id < ${idParam}) or e.start_at is null)`);
      } else {
        conditions.push(`(e.start_at is null and e.id < ${bind(String(cursor.id || ''))})`);
      }
    }
    const whereSql = conditions.join(' and ');
    const result = await Storage.timedPostgresQuery(trace, 'meetings_page',
      `select
         jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'title', e.name,
           'start_at', e.start_at,
           'duration', e.data->'duration',
           'provider', 'zoom',
           'location', coalesce(e.location, 'Zoom'),
           'campaign', coalesce(e.campaign, 'Zoom'),
           'status', coalesce(e.data->>'status', e.data->>'zoom_list_type', 'meeting'),
           'zoom_list_type', coalesce(e.data->>'zoom_list_type', e.data->>'status', 'meeting'),
           'zoom_meeting_id', coalesce(e.data->>'zoom_meeting_id', ''),
           'zoom_meeting_uuid', coalesce(e.data->>'zoom_meeting_uuid', ''),
           'zoom_host_id', coalesce(e.data->>'zoom_host_id', ''),
           'zoom_host_label', coalesce(e.data->>'zoom_host_label', ''),
           'zoom_account_id', coalesce(e.data->>'zoom_account_id', ''),
           'zoom_account_label', coalesce(e.data->>'zoom_account_label', ''),
           'meeting_link', coalesce(e.data->>'meeting_link', e.data->>'zoom_link', ''),
           'zoom_link', coalesce(e.data->>'zoom_link', e.data->>'meeting_link', ''),
           'attendee_count', jsonb_array_length(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end)
         ) as data,
         e.start_at
       from app_events e
       where ${whereSql}
       order by e.start_at desc nulls last, e.id desc
       limit $${values.length + 1}`,
      [...values, limit + 1]
    );
    return Perf.perfPhase(trace, 'mapping', async () => {
      const rows = result.rows.slice(0, limit);
      const items = rows.map(item => publicMeetingSummary(item.data));
      const last = rows[rows.length - 1];
      const nextCursor = result.rows.length > limit && last?.data?.id ? Util.encodePageCursor({ start_at: last.start_at || last.data.start_at || null, id: last.data.id }) : '';
      return { items, events: items, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
    });
  }
  const rows = (await Storage.loadDb()).events
    .filter(isZoomEventRecord)
    .filter(event => !filters.startFrom || new Date(event.start_at || 0) >= new Date(filters.startFrom))
    .filter(event => !filters.startTo || new Date(event.start_at || 0) < new Date(filters.startTo))
    .filter(event => !filters.owner || [event.zoom_host_id, event.zoom_host_label, event.owner_id].map(String).includes(filters.owner))
    .filter(event => !filters.lead || (event.attendees || []).some(a => String(a.lead_id || '') === filters.lead))
    .filter(event => !filters.search || JSON.stringify(publicMeetingSummary(event)).toLowerCase().includes(filters.search.toLowerCase()))
    .sort((a, b) => new Date(b.start_at || 0) - new Date(a.start_at || 0) || String(b.id || '').localeCompare(String(a.id || '')));
  const start = cursor?.id ? Math.max(0, rows.findIndex(item => item.id === cursor.id) + 1) : 0;
  const page = rows.slice(start, start + limit).map(publicMeetingSummary);
  const nextCursor = start + page.length < rows.length ? Util.encodePageCursor({ start_at: page[page.length - 1]?.start_at || null, id: page[page.length - 1]?.id || '' }) : '';
  return { items: page, events: page, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
}

const ZOOM_CALL_PAGE_MAX = 100;

// A stored call also carries the provider's raw record and the participants. The import needs
// them; the calls list does not show them, and they are about half of every call.
function zoomCallListItem(call) {
  const { raw, participants, ...item } = hydrateZoomStoredCall({ leads: [] }, call);
  return item;
}

// The calls live in one JSON array inside app_workspace.meta (about 500 KB). Reading the whole
// array for every page cost more than the page itself, so PostgreSQL cuts the page out and only
// that travels. A call without both numbers keeps its raw record: it is rebuilt from it below.
async function loadZoomCallPageSql(limit, offset) {
  const result = await State.postgresPool.query(
    `with state as (
       select coalesce(meta->'zoom', '{}'::jsonb) as zoom from app_workspace where id = $1
     ), calls as (
       select item.call, item.position,
              case when item.call->>'started_at' ~ '^\\d{4}-\\d{2}-\\d{2}' then (item.call->>'started_at')::timestamptz end as started
       from state
       cross join lateral jsonb_array_elements(
         case when jsonb_typeof(state.zoom->'calls') = 'array' then state.zoom->'calls' else '[]'::jsonb end
       ) with ordinality as item(call, position)
     )
     select
       (select count(*)::int from calls) as total,
       (select zoom->>'last_call_sync_at' from state) as last_sync_at,
       coalesce((
         select jsonb_agg(
           case when coalesce(page.call->>'caller_number', '') <> '' and coalesce(page.call->>'callee_number', '') <> ''
             then page.call - 'raw' - 'participants' else page.call end
           order by page.started desc nulls last, page.position)
         from (select call, started, position from calls order by started desc nulls last, position limit $2 offset $3) page
       ), '[]'::jsonb) as calls`,
    ['main', limit, offset]
  );
  const row = result.rows[0] || {};
  return { calls: (row.calls || []).map(zoomCallListItem), total: Number(row.total || 0), last_sync_at: row.last_sync_at || null };
}

async function loadZoomCallPageDb(limit = 50, offset = 0) {
  await Storage.ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), ZOOM_CALL_PAGE_MAX));
  const safeOffset = Math.max(0, Number(offset || 0));
  let page;
  if (State.postgresPool && Storage.usesPostgresStorage() && !State.dbCache?.zoom?.calls?.length) {
    page = await loadZoomCallPageSql(safeLimit, safeOffset);
  } else {
    const zoomState = await loadZoomStateForPaging();
    const allCalls = (zoomState.calls || [])
      .map(call => hydrateZoomStoredCall({ leads: [] }, call))
      .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
    page = {
      calls: allCalls.slice(safeOffset, safeOffset + safeLimit).map(zoomCallListItem),
      total: allCalls.length,
      last_sync_at: zoomState.last_call_sync_at || null
    };
  }
  return {
    calls: page.calls,
    total: page.total,
    offset: safeOffset,
    limit: safeLimit,
    loaded: safeOffset + page.calls.length,
    has_more: safeOffset + page.calls.length < page.total,
    next_offset: safeOffset + page.calls.length,
    last_sync_at: page.last_sync_at
  };
}

async function loadZoomStateForPaging() {
  let zoomState = State.dbCache?.zoom?.calls?.length ? State.dbCache.zoom : {};
  if (State.postgresPool && !(zoomState.calls || []).length) {
    const result = await State.postgresPool.query(`select meta->'zoom' as zoom from app_workspace where id = $1`, ['main']);
    zoomState = result.rows[0]?.zoom || {};
  }
  if (!(zoomState.calls || []).length) {
    zoomState = (await Storage.loadDb()).zoom || {};
  }
  return zoomState || {};
}

function zoomStoredNumberKey(number = '') {
  const digits = phoneDigits(number);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function zoomStoredCallSource(call = {}) {
  return [call.zoom_account_label || call.zoom_account_id, call.owner_name, call.owner_extension ? `Ext ${call.owner_extension}` : '', call.site_name, call.path]
    .filter(Boolean)
    .join(' / ') || 'Zoom Phone';
}

function summarizeZoomStoredNumbers(calls = []) {
  const byNumber = new Map();
  for (const call of calls) {
    for (const [side, number, name] of [['caller', call.caller_number, call.caller_name], ['callee', call.callee_number, call.callee_name]]) {
      const key = zoomStoredNumberKey(number);
      if (!key) continue;
      const row = byNumber.get(key) || {
        key,
        number,
        display: number,
        name: name || '',
        total: 0,
        inbound: 0,
        outbound: 0,
        caller: 0,
        callee: 0,
        linked: 0,
        last_at: '',
        lead_id: '',
        lead_name: '',
        sources: new Set(),
        accounts: new Set()
      };
      row.total += 1;
      row[side] += 1;
      if (String(call.direction || '').includes('in')) row.inbound += 1;
      if (String(call.direction || '').includes('out')) row.outbound += 1;
      if (call.lead_id && (call.matched_number ? zoomStoredNumberKey(call.matched_number) === key : true)) {
        row.linked += 1;
        row.lead_id = call.lead_id;
        row.lead_name = call.lead_name || call.lead_id;
      }
      if (!row.last_at || new Date(call.started_at || 0) > new Date(row.last_at || 0)) row.last_at = call.started_at || '';
      if (name && !row.name) row.name = name;
      if (call.zoom_account_label || call.zoom_account_id) row.accounts.add(call.zoom_account_label || call.zoom_account_id);
      row.sources.add(zoomStoredCallSource(call));
      byNumber.set(key, row);
    }
  }
  return [...byNumber.values()]
    .map(row => ({ ...row, sources: [...row.sources], accounts: [...row.accounts] }))
    .sort((a, b) => b.total - a.total || new Date(b.last_at || 0) - new Date(a.last_at || 0));
}

async function loadZoomNumberPageDb(limit = 50, offset = 0) {
  await Storage.ensureStorage();
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 250));
  const safeOffset = Math.max(0, Number(offset || 0));
  const zoomState = await loadZoomStateForPaging();
  const calls = (zoomState.calls || []).map(call => hydrateZoomStoredCall({ leads: [] }, call));
  const numbers = summarizeZoomStoredNumbers(calls);
  const rows = numbers.slice(safeOffset, safeOffset + safeLimit);
  return {
    numbers: rows,
    total: numbers.length,
    offset: safeOffset,
    limit: safeLimit,
    loaded: safeOffset + rows.length,
    has_more: safeOffset + rows.length < numbers.length,
    next_offset: safeOffset + rows.length,
    last_sync_at: zoomState.last_call_sync_at || null
  };
}

function zoomConfigured() {
  return zoomAccounts().length > 0;
}

function validZoomCredential(accountId, clientId, clientSecret) {
  return Boolean(
    accountId &&
    clientId &&
    clientSecret &&
    !accountId.includes('your-zoom') &&
    !clientId.includes('your-zoom') &&
    !clientSecret.includes('your-zoom') &&
    !accountId.includes('replace-with') &&
    !clientId.includes('replace-with') &&
    !clientSecret.includes('replace-with')
  );
}

function zoomAccounts() {
  const accounts = [];
  function add(suffix = '', fallbackLabel = 'Zoom account') {
    const accountId = process.env[`ZOOM_ACCOUNT_ID${suffix}`];
    const clientId = process.env[`ZOOM_CLIENT_ID${suffix}`];
    const clientSecret = process.env[`ZOOM_CLIENT_SECRET${suffix}`];
    if (!validZoomCredential(accountId || '', clientId || '', clientSecret || '')) return;
    accounts.push({
      accountId,
      clientId,
      clientSecret,
      userId: process.env[`ZOOM_USER_ID${suffix}`] || process.env.ZOOM_USER_ID || 'me',
      label: process.env[`ZOOM_ACCOUNT_LABEL${suffix}`] || fallbackLabel
    });
  }
  add('', process.env.ZOOM_ACCOUNT_LABEL || 'Zoom account 1');
  for (let index = 2; index <= 10; index += 1) add(`_${index}`, `Zoom account ${index}`);
  return accounts;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchZoomJson(url, options = {}, context = 'Zoom') {
  let lastError = null;
  const attempts = Math.max(1, Math.min(Number(options.attempts || 3), 5));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (Config.ZOOM_REQUEST_DELAY_MS) await wait(Config.ZOOM_REQUEST_DELAY_MS);
    try {
      return await Util.fetchJson(url, { ...options, timeoutMs: options.timeoutMs || 30000 });
    } catch (error) {
      lastError = error;
      const status = Number(error.status || 0);
      if (![429, 502, 503, 504].includes(status)) throw Http.statusError(status || 502, `${context}: ${error.message || 'Provider request failed.'}`);
      await wait(1200 * (attempt + 1));
    }
  }
  throw Http.statusError(lastError?.status || 502, `${context}: ${lastError?.message || 'Provider request failed.'}`);
}

function scheduleZoomAutoSync(delayMs) {
  if (!Config.ZOOM_AUTO_SYNC_ENABLED) return;
  if (zoomAutoSyncTimer) clearTimeout(zoomAutoSyncTimer);
  const delay = Math.max(1000, Number(delayMs) || Config.ZOOM_AUTO_SYNC_INTERVAL_MS);
  State.zoomAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
  zoomAutoSyncTimer = setTimeout(runZoomAutoSync, delay);
  if (zoomAutoSyncTimer.unref) zoomAutoSyncTimer.unref();
}

async function runZoomAutoSync() {
  if (!Config.ZOOM_AUTO_SYNC_ENABLED) return;
  if (State.zoomAutoSyncRunning) return scheduleZoomAutoSync(Config.ZOOM_AUTO_SYNC_INTERVAL_MS);
  if (State.eventAutoSyncRunning) return scheduleZoomAutoSync(60 * 1000);
  State.zoomAutoSyncRunning = true;
  State.zoomAutoSyncState.running = true;
  console.log('Zoom auto sync starting.');
  try {
    const db = await Storage.loadDb();
    const user = Jobs.autoSyncUser(db);
    const results = {};
    let shouldSave = false;
    if (!zoomConfigured()) {
      results.zoom = { skipped: true, reason: 'Zoom is not configured.' };
    } else {
      if (Config.ZOOM_AUTO_SYNC_MEETINGS) {
        try {
          results.meetings = await importZoomMeetings(db, user, Config.ZOOM_AUTO_SYNC_MAX_MEETINGS, { save: false });
          shouldSave = true;
        } catch (error) {
          results.meetings = { error: error.message || 'Zoom meetings sync failed.' };
        }
      } else {
        results.meetings = { skipped: true, reason: 'ZOOM_AUTO_SYNC_MEETINGS is disabled.' };
      }
      if (Config.ZOOM_AUTO_SYNC_CALLS) {
        try {
          results.calls = await importZoomCalls(db, user, Config.ZOOM_AUTO_SYNC_MAX_CALLS, { save: false, max_calls: Config.ZOOM_AUTO_SYNC_MAX_CALLS });
          shouldSave = true;
        } catch (error) {
          results.calls = { error: error.message || 'Zoom calls sync failed.' };
        }
      } else {
        results.calls = { skipped: true, reason: 'ZOOM_AUTO_SYNC_CALLS is disabled.' };
      }
      if (shouldSave) await Events.saveEventImportTables(db, { preserveGmail: true });
    }
    State.zoomAutoSyncState.last_result = results;
    const errors = Object.values(results).filter(item => item?.error).map(item => item.error);
    State.zoomAutoSyncState.last_error = errors.length ? errors.join('; ') : null;
    console.log(`Zoom auto sync finished: ${JSON.stringify(results)}`);
  } catch (error) {
    State.zoomAutoSyncState.last_error = error.message || 'Zoom auto sync failed.';
    console.error(`Zoom auto sync failed: ${State.zoomAutoSyncState.last_error}`);
  } finally {
    State.zoomAutoSyncRunning = false;
    State.zoomAutoSyncState.running = false;
    scheduleZoomAutoSync(Config.ZOOM_AUTO_SYNC_INTERVAL_MS);
  }
}

async function zoomAccessToken(account) {
  if (!account) throw Http.statusError(400, 'Zoom credentials are not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env.');
  const basic = Buffer.from(`${account.clientId}:${account.clientSecret}`).toString('base64');
  const token = await fetchZoomJson('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: account.accountId
    })
  }, `Zoom token for ${account.label}`);
  if (!token.access_token) throw Http.statusError(502, 'Zoom did not return an access token.');
  return token.access_token;
}

function zoomUserId() {
  return encodeURIComponent(process.env.ZOOM_USER_ID || 'me');
}

function zoomSyncAllUsers() {
  return String(process.env.ZOOM_SYNC_ALL_USERS || 'false').toLowerCase() === 'true';
}

function zoomMeetingType() {
  const value = String(process.env.ZOOM_MEETING_TYPE || 'upcoming').trim();
  return value || 'upcoming';
}

function zoomMeetingTypes() {
  const value = zoomMeetingType().toLowerCase();
  if (value === 'all') return ['upcoming', 'scheduled', 'upcoming_meetings', 'previous_meetings', 'past'];
  return [value];
}

function zoomIncludeHistory() {
  return String(process.env.ZOOM_INCLUDE_HISTORY || 'true').toLowerCase() !== 'false';
}

function zoomReportHistoryMonths(options = {}) {
  const requested = Number(options.report_history_months || options.history_months || process.env.ZOOM_REPORT_HISTORY_MONTHS || 6);
  return Math.max(1, Math.min(requested || 6, 6));
}

function zoomReportOverlapDays() {
  return Math.max(0, Math.min(Number(process.env.ZOOM_REPORT_SYNC_OVERLAP_DAYS || 7), 30));
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function zoomHistoryStart(options = {}) {
  const raw = String(options.history_from || process.env.ZOOM_HISTORY_FROM || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function zoomSixMonthFloor(reference = new Date()) {
  const floor = new Date(reference);
  floor.setUTCHours(0, 0, 0, 0);
  floor.setUTCMonth(floor.getUTCMonth() - 6);
  return floor;
}

function zoomReportCalendarFloor(reference = new Date(), months = 6) {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - (months - 1), 1));
}

function monthEnd(date) {
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  end.setUTCHours(0, 0, 0, 0);
  return end;
}

function zoomMaxDate(...dates) {
  return dates.filter(Boolean).reduce((max, date) => !max || date > max ? date : max, null);
}

function zoomReportHistoryRanges(options = {}) {
  const ranges = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const months = zoomReportHistoryMonths(options);
  const requestedStart = zoomReportCalendarFloor(now, months);
  const syncState = options.sync_state || {};
  let incrementalStart = null;
  if (syncState.initial_backfill_completed && syncState.last_successful_sync_at) {
    incrementalStart = new Date(syncState.last_successful_sync_at);
    if (!Number.isNaN(incrementalStart.getTime())) {
      incrementalStart.setUTCDate(incrementalStart.getUTCDate() - zoomReportOverlapDays());
      incrementalStart.setUTCHours(0, 0, 0, 0);
    } else {
      incrementalStart = null;
    }
  }
  const start = zoomMaxDate(zoomReportCalendarFloor(now, 6), zoomHistoryStart(options), incrementalStart || requestedStart);
  if (!start || start > now) return [{ from: dateOnly(now), to: dateOnly(now) }];
  let from = new Date(start);
  from.setUTCHours(0, 0, 0, 0);
  while (from <= now && ranges.length < 8) {
    const to = monthEnd(from);
    if (to > now) to.setTime(now.getTime());
    ranges.push({ from: dateOnly(from), to: dateOnly(to) });
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() + 1);
  }
  return ranges;
}

function zoomReportUnsupportedWarning(message = '') {
  return /only available for paid|zmp account|does not contain scopes|no permission|report.*scope/i.test(String(message || ''));
}

function zoomOptionalEndpointDisableWarning(message = '') {
  return /does not contain scopes|invalid access token|no permission|not authorized|scope|timed out|timeout/i.test(String(message || ''));
}

function zoomParticipantImportEnabled() {
  return !/^(0|false|no|off)$/i.test(String(process.env.ZOOM_IMPORT_PARTICIPANTS || 'true'));
}

function zoomPastParticipantImportEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.ZOOM_IMPORT_PAST_PARTICIPANTS || 'false'));
}

function zoomParticipantLimit() {
  return Math.max(1, Math.min(Number(process.env.ZOOM_MAX_PARTICIPANTS_PER_MEETING || 300), 1000));
}

function zoomRegistrantLookupLimit() {
  return Math.max(0, Math.min(Number(process.env.ZOOM_MAX_REGISTRANT_MEETING_LOOKUPS || 20), 200));
}

function zoomCallHistoryMonths(options = {}) {
  const requested = Number(options.call_history_months || process.env.ZOOM_CALL_HISTORY_MONTHS || 3);
  return Math.max(1, Math.min(requested || 3, 12));
}

function zoomCallMaxRecords(options = {}) {
  return Math.max(1, Math.min(Number(options.max_calls || process.env.ZOOM_MAX_CALLS || 1000), 5000));
}

function zoomCallHistoryRanges(options = {}) {
  const ranges = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  let from = zoomReportCalendarFloor(now, zoomCallHistoryMonths(options));
  from.setUTCHours(0, 0, 0, 0);
  while (from <= now && ranges.length < 12) {
    const to = monthEnd(from);
    if (to > now) to.setTime(now.getTime());
    ranges.push({ from: dateOnly(from), to: dateOnly(to) });
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() + 1);
  }
  return ranges;
}

function phoneDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function samePhone(a, b) {
  const left = phoneDigits(a), right = phoneDigits(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right.slice(-10)) || right.endsWith(left.slice(-10));
}

function leadForZoomCall(db, record = {}) {
  const numbers = [record.caller_number, record.callee_number].filter(Boolean);
  return (db.leads || []).find(lead => numbers.some(number => samePhone(lead.phone, number))) || null;
}

function zoomCallLeadMatch(db, record = {}) {
  for (const lead of db.leads || []) {
    if (samePhone(lead.phone, record.caller_number)) return { lead, side: 'caller', number: record.caller_number };
    if (samePhone(lead.phone, record.callee_number)) return { lead, side: 'callee', number: record.callee_number };
  }
  return { lead: null, side: '', number: '' };
}

function zoomMeetingPathId(meeting = {}) {
  const value = String(meeting.uuid || meeting.id || '').trim();
  return encodeURIComponent(value);
}

function zoomRegistrantPhone(registrant = {}) {
  const direct = registrant.phone || registrant.phone_number || registrant.mobile || registrant.mobile_phone || registrant.cell_phone;
  if (direct) return String(direct).trim();
  for (const answer of registrant.custom_questions || []) {
    const title = String(answer.title || answer.question || '').toLowerCase();
    if (/phone|mobile|telephone|tel/.test(title) && answer.value) return String(answer.value).trim();
  }
  return '';
}

function splitZoomName(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
}

function zoomLeadByEmailMap(db) {
  return new Map((db.leads || []).map(lead => [Emails.normalizeEmail(lead.email), lead]).filter(([email]) => email));
}

function zoomAttendeeFromRecord(record = {}, meeting = {}, source = 'zoom', leadByEmail = new Map()) {
  const email = Emails.normalizeEmail(record.email || record.user_email || record.registrant_email);
  const name = record.name || record.user_name || [record.first_name, record.last_name].filter(Boolean).join(' ') || email || 'Zoom attendee';
  const splitName = splitZoomName(name);
  const lead = email ? leadByEmail.get(email) : null;
  const phone = String(zoomRegistrantPhone(record) || record.phone || record.phone_number || lead?.phone || '').trim();
  return {
    id: `ZA-${Events.numericHash([meeting.zoom_account_id || '', meeting.uuid || meeting.id || '', source, email || record.id || name].join('|'))}`,
    first_name: record.first_name || splitName.first_name || lead?.first_name || '',
    last_name: record.last_name || splitName.last_name || lead?.last_name || '',
    email,
    phone,
    status: source === 'participant' ? 'attended' : String(record.status || 'confirmed').replace(/^approved$/i, 'confirmed'),
    attended_at: source === 'participant' ? (record.join_time || record.leave_time || meeting.start_time || '') : '',
    source_account: 'Zoom',
    zoom_source: source,
    zoom_participant_id: record.id || record.user_id || '',
    lead_id: lead?.id || ''
  };
}

async function fetchZoomMeetingRegistrants(auth, meeting, account, host, maxParticipants) {
  if (!meeting.id) return { attendees: [], warning: '' };
  const attendees = [];
  let nextPageToken = '';
  while (attendees.length < maxParticipants) {
    const params = new URLSearchParams({
      page_size: String(Math.max(1, Math.min(100, maxParticipants - attendees.length)))
    });
    if (nextPageToken) params.set('next_page_token', nextPageToken);
    try {
      const list = await fetchZoomJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meeting.id)}/registrants?${params}`, { headers: auth, timeoutMs: 3000, attempts: 1 }, `Zoom registrants for ${account.label} / ${host.label || host.id}`);
      attendees.push(...(list.registrants || []));
      nextPageToken = list.next_page_token || '';
      if (!nextPageToken || !(list.registrants || []).length) break;
    } catch (error) {
      return { attendees, warning: error.message || 'Zoom registrants unavailable.' };
    }
  }
  return { attendees, warning: '' };
}

async function fetchZoomPastParticipants(auth, meeting, account, host, maxParticipants) {
  if (!meeting.uuid && !meeting.id) return { attendees: [], warning: '' };
  const attendees = [];
  let nextPageToken = '';
  while (attendees.length < maxParticipants) {
    const params = new URLSearchParams({
      page_size: String(Math.max(1, Math.min(100, maxParticipants - attendees.length)))
    });
    if (nextPageToken) params.set('next_page_token', nextPageToken);
    try {
      const list = await fetchZoomJson(`https://api.zoom.us/v2/past_meetings/${zoomMeetingPathId(meeting)}/participants?${params}`, { headers: auth, timeoutMs: 6000, attempts: 1 }, `Zoom participants for ${account.label} / ${host.label || host.id}`);
      attendees.push(...(list.participants || []));
      nextPageToken = list.next_page_token || '';
      if (!nextPageToken || !(list.participants || []).length) break;
    } catch (error) {
      return { attendees, warning: error.message || 'Zoom participants unavailable.' };
    }
  }
  return { attendees, warning: '' };
}

async function fetchZoomMeetingAttendees(auth, meeting, account, host, leadByEmail, maxParticipants = zoomParticipantLimit(), availability = {}) {
  if (!zoomParticipantImportEnabled()) return { attendees: [], warnings: [] };
  availability.registrantsUnavailable ||= new Set();
  availability.participantsUnavailable ||= new Set();
  availability.registrantLookups ||= 0;
  const hostKey = `${account.accountId}:${host.id || zoomUserId()}`;
  const warnings = [];
  const canLookupRegistrants = availability.registrantLookups < zoomRegistrantLookupLimit();
  const registrants = !canLookupRegistrants || availability.registrantsUnavailable.has(hostKey)
    ? { attendees: [], warning: '' }
    : await fetchZoomMeetingRegistrants(auth, meeting, account, host, maxParticipants);
  if (canLookupRegistrants && !availability.registrantsUnavailable.has(hostKey)) availability.registrantLookups += 1;
  if (registrants.warning) {
    warnings.push(registrants.warning);
    if (zoomOptionalEndpointDisableWarning(registrants.warning)) availability.registrantsUnavailable.add(hostKey);
  }
  const remaining = zoomPastParticipantImportEnabled() ? Math.max(0, maxParticipants - registrants.attendees.length) : 0;
  const participants = remaining && !availability.participantsUnavailable.has(hostKey)
    ? await fetchZoomPastParticipants(auth, meeting, account, host, remaining)
    : { attendees: [], warning: '' };
  if (participants.warning) {
    warnings.push(participants.warning);
    if (zoomOptionalEndpointDisableWarning(participants.warning)) availability.participantsUnavailable.add(hostKey);
  }
  return {
    attendees: Events.mergeEventAttendees(
      registrants.attendees.map(item => zoomAttendeeFromRecord(item, meeting, 'registrant', leadByEmail)),
      participants.attendees.map(item => zoomAttendeeFromRecord(item, meeting, 'participant', leadByEmail))
    ),
    warnings
  };
}

async function enrichZoomMeetingWithAttendees(auth, account, host, meeting, leadByEmail, warnings, availability) {
  const attendeeResult = await fetchZoomMeetingAttendees(auth, meeting, account, host, leadByEmail, zoomParticipantLimit(), availability);
  attendeeResult.warnings.forEach(warning => {
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  });
  return {
    ...meeting,
    zoom_attendees: attendeeResult.attendees,
    zoom_attendee_count: attendeeResult.attendees.length,
    zoom_phone_count: attendeeResult.attendees.filter(attendee => attendee.phone).length
  };
}

async function fetchZoomMeetingHosts(auth, maxUsers = 100, account = {}) {
  if (!zoomSyncAllUsers()) return [{ id: account.userId || process.env.ZOOM_USER_ID || 'me', label: account.userId || process.env.ZOOM_USER_ID || 'me' }];
  const hosts = [];
  let nextPageToken = '';
  while (hosts.length < maxUsers) {
    const params = new URLSearchParams({
      status: 'active',
      page_size: String(Math.max(1, Math.min(100, maxUsers - hosts.length)))
    });
    if (nextPageToken) params.set('next_page_token', nextPageToken);
    const list = await fetchZoomJson(`https://api.zoom.us/v2/users?${params}`, { headers: auth, timeoutMs: 20000 }, `Zoom users for ${account.label || 'account'}`);
    for (const item of list.users || []) {
      hosts.push({
        id: item.id || item.email,
        label: item.email || item.display_name || item.id || 'Zoom user'
      });
    }
    nextPageToken = list.next_page_token || '';
    if (!nextPageToken || !(list.users || []).length) break;
  }
  return hosts.length ? hosts : [{ id: account.userId || process.env.ZOOM_USER_ID || 'me', label: account.userId || process.env.ZOOM_USER_ID || 'me' }];
}

function zoomCallField(call = {}, ...keys) {
  for (const key of keys) {
    const parts = key.split('.');
    let value = call;
    for (const part of parts) value = value?.[part];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function zoomCallParticipants(call = {}) {
  return call.call_participants || call.participants || call.users || [];
}

function zoomCallPartyName(party = {}) {
  return String(party.name || party.display_name || party.user_name || party.extension_name || party.email || '').trim();
}

function zoomCallPartyNumber(party = {}) {
  return String(party.phone_number || party.number || party.extension_number || party.extension || '').trim();
}

function usableZoomPhone(value = '') {
  const text = String(value || '').trim();
  return phoneDigits(text).length >= 7 ? text : '';
}

function zoomCallPhoneCandidates(call = {}, role = '') {
  const matches = [];
  const rolePattern = role === 'caller' ? /caller|from|source/i : role === 'callee' ? /callee|to|target|destination/i : /./;
  const walk = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (child && typeof child === 'object') {
        walk(child, nextPath);
        continue;
      }
      if (!rolePattern.test(nextPath)) continue;
      if (!/(phone|did|number)$/i.test(key)) continue;
      if (/country|type|ext|extension|id$/i.test(key)) continue;
      const phone = usableZoomPhone(child);
      if (phone) matches.push({ path: nextPath, phone });
    }
  };
  walk(call);
  return matches;
}

function zoomCallBestNumber(call = {}, role = 'caller', party = {}) {
  const direct = role === 'caller'
    ? zoomCallField(call, 'caller_number', 'caller_did_number', 'caller.phone_number', 'from.phone_number', 'from.did_number', 'source.phone_number', 'source.did_number')
    : zoomCallField(call, 'callee_number', 'callee_did_number', 'callee.phone_number', 'to.phone_number', 'to.did_number', 'destination.phone_number', 'destination.did_number');
  return usableZoomPhone(direct) || usableZoomPhone(zoomCallPartyNumber(party)) || zoomCallPhoneCandidates(call, role)[0]?.phone || '';
}

function zoomCallParty(call = {}, role = 'caller') {
  const regex = role === 'caller' ? /caller|from|source/i : /callee|to|target|destination/i;
  return zoomCallParticipants(call).find(item => regex.test(`${item.role || ''} ${item.type || ''} ${item.direction || ''}`)) || {};
}

function normalizeZoomCallRecord(db, account, call = {}) {
  const caller = zoomCallParty(call, 'caller');
  const callee = zoomCallParty(call, 'callee');
  const callerNumber = zoomCallBestNumber(call, 'caller', caller);
  const calleeNumber = zoomCallBestNumber(call, 'callee', callee);
  const startedAt = zoomCallField(call, 'start_time', 'date_time', 'startTime', 'call_start_time', 'answer_start_time') || new Date().toISOString();
  const callKey = String(call.call_history_uuid || call.call_history_id || call.call_id || call.id || [startedAt, callerNumber, calleeNumber, call.duration].join('|'));
  const direction = String(call.direction || call.call_direction || '').toLowerCase() || 'unknown';
  const ownerName = String(call.owner?.name || call.user_name || call.extension_name || call.user?.name || '').trim();
  const participants = zoomCallParticipants(call).map(item => ({
    role: item.role || item.type || item.direction || '',
    name: zoomCallPartyName(item),
    number: zoomCallPartyNumber(item),
    email: Emails.normalizeEmail(item.email || item.user_email || ''),
    extension: String(item.extension_number || item.extension || '').trim()
  })).filter(item => item.name || item.number || item.email || item.extension);
  const record = {
    id: `ZC-${Events.numericHash(`${account.accountId}|${callKey}`)}`,
    zoom_call_id: String(call.call_id || callKey),
    zoom_call_history_uuid: String(call.call_history_uuid || call.call_history_id || call.id || ''),
    zoom_account_id: account.accountId,
    zoom_account_label: account.label,
    started_at: startedAt,
    direction,
    result: String(call.result || call.call_result || call.disposition || call.status || ''),
    duration: Number(call.duration || call.talk_time || call.total_duration || 0),
    caller_name: String(zoomCallField(call, 'caller_name', 'from.name', 'caller.name') || zoomCallPartyName(caller) || ''),
    caller_number: callerNumber,
    caller_digits: phoneDigits(callerNumber),
    callee_name: String(zoomCallField(call, 'callee_name', 'to.name', 'callee.name') || zoomCallPartyName(callee) || ''),
    callee_number: calleeNumber,
    callee_digits: phoneDigits(calleeNumber),
    owner_name: ownerName,
    owner_extension: String(call.extension_number || call.extension || call.owner?.extension_number || '').trim(),
    site_name: String(call.site?.name || ''),
    path: String(call.path || call.connect_type || call.call_type || call.call_path || ''),
    source: 'Zoom Phone',
    source_detail: [account.label, ownerName, String(call.site?.name || ''), String(call.path || call.connect_type || call.call_type || '')].filter(Boolean).join(' / '),
    call_type: String(call.call_type || call.type || call.connect_type || ''),
    department: String(call.department || call.cost_center || ''),
    participants,
    raw: call
  };
  const match = zoomCallLeadMatch(db, record);
  const lead = match.lead;
  if (lead) {
    record.lead_id = lead.id;
    record.lead_name = Util.fullName(lead);
    record.matched_side = match.side;
    record.matched_number = match.number;
    record.matched_source = 'CRM lead phone';
  }
  return record;
}

async function fetchZoomAccountCallHistory(auth, account, maxCalls = 1000, options = {}) {
  const calls = [];
  const warnings = [];
  for (const range of zoomCallHistoryRanges(options)) {
    if (calls.length >= maxCalls) break;
    let nextPageToken = '';
    while (calls.length < maxCalls) {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        page_size: String(Math.max(1, Math.min(100, maxCalls - calls.length))),
        time_type: 'start_time'
      });
      if (nextPageToken) params.set('next_page_token', nextPageToken);
      try {
        const result = await fetchZoomJson(`https://api.zoom.us/v2/phone/call_history?${params}`, { headers: auth, timeoutMs: 20000, attempts: 1 }, `Zoom phone calls for ${account.label}`);
        const pageCalls = result.call_history || result.call_logs || result.calls || [];
        calls.push(...pageCalls);
        nextPageToken = result.next_page_token || '';
        if (!nextPageToken || !pageCalls.length) break;
      } catch (error) {
        warnings.push(error.message || 'Zoom Phone call history failed.');
        break;
      }
    }
  }
  return { calls, warnings };
}

async function importZoomCalls(db, user, maxCalls = zoomCallMaxRecords(), options = {}) {
  db.zoom ||= { imported_meeting_ids: [] };
  db.zoom.calls ||= [];
  const accounts = zoomAccounts();
  if (!accounts.length) throw Http.statusError(400, 'Zoom credentials are not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env.');
  const existing = new Map((db.zoom.calls || []).map(call => {
    const hydrated = hydrateZoomStoredCall(db, call);
    return [hydrated.id, hydrated];
  }));
  let scanned = 0, importedCalls = 0, updatedCalls = 0;
  const warnings = [];
  for (const account of accounts) {
    if (scanned >= maxCalls) break;
    const accessToken = await zoomAccessToken(account);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const result = await fetchZoomAccountCallHistory(auth, account, maxCalls - scanned, options);
    warnings.push(...result.warnings);
    for (const item of result.calls) {
      const record = normalizeZoomCallRecord(db, account, item);
      scanned += 1;
      if (existing.has(record.id)) {
        existing.set(record.id, { ...existing.get(record.id), ...record, updated_at: new Date().toISOString() });
        updatedCalls += 1;
      } else {
        existing.set(record.id, { ...record, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        importedCalls += 1;
      }
      if (scanned >= maxCalls) break;
    }
  }
  db.zoom.calls = [...existing.values()].sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0)).slice(0, Math.max(zoomCallMaxRecords(options), existing.size));
  db.zoom.last_call_sync_at = new Date().toISOString();
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Zoom calls synced', 'integration', 'Zoom Phone', `${importedCalls} created, ${updatedCalls} updated, ${scanned} scanned across ${accounts.length} accounts`);
  if (options.save !== false) await Storage.saveDb(db);
  return {
    imported_calls: importedCalls,
    updated_calls: updatedCalls,
    scanned,
    accounts: accounts.length,
    call_history_months: zoomCallHistoryMonths(options),
    warnings: [...new Set(warnings.filter(Boolean))],
    reconciliation,
    last_sync_at: db.zoom.last_call_sync_at
  };
}

function hydrateZoomStoredCall(db, call = {}) {
  if ((call.caller_number && call.callee_number) || !call.raw) return call;
  const account = {
    accountId: call.zoom_account_id || call.raw.zoom_account_id || 'zoom',
    label: call.zoom_account_label || call.raw.zoom_account_label || 'Zoom'
  };
  const normalized = normalizeZoomCallRecord(db, account, call.raw);
  return {
    ...call,
    ...normalized,
    id: call.id || normalized.id,
    created_at: call.created_at,
    updated_at: call.updated_at,
    raw: call.raw
  };
}

async function fetchZoomReportMeetings(auth, account, host, maxMeetings = 100, options = {}) {
  if (!zoomIncludeHistory()) return { meetings: [], warning: '' };
  const meetings = [];
  const ranges = zoomReportHistoryRanges(options);
  for (const range of ranges) {
    if (meetings.length >= maxMeetings) break;
    let nextPageToken = '';
    while (meetings.length < maxMeetings) {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        page_size: String(Math.max(1, Math.min(100, maxMeetings - meetings.length)))
      });
      if (nextPageToken) params.set('next_page_token', nextPageToken);
      try {
        const list = await fetchZoomJson(`https://api.zoom.us/v2/report/users/${encodeURIComponent(host.id || zoomUserId())}/meetings?${params}`, { headers: auth, timeoutMs: 12000, attempts: 1 }, `Zoom history for ${account.label} / ${host.label || host.id}`);
        meetings.push(...(list.meetings || []));
        nextPageToken = list.next_page_token || '';
        if (!nextPageToken || !(list.meetings || []).length) break;
      } catch (error) {
        if ([400, 401, 403, 404].includes(Number(error.status || 0))) return { meetings, warning: error.message || 'Zoom history scope is unavailable.' };
        throw error;
      }
    }
  }
  return { meetings, warning: '', ranges };
}

async function importZoomMeetings(db, user, maxMeetings = 25, options = {}) {
  db.zoom ||= { imported_meeting_ids: [] };
  db.zoom.sync_state ||= {};
  const meetings = [];
  const seenMeetings = new Set();
  const leadByEmail = zoomLeadByEmailMap(db);
  const attendeeAvailability = { registrantsUnavailable: new Set(), participantsUnavailable: new Set() };
  const accounts = zoomAccounts();
  if (!accounts.length) throw Http.statusError(400, 'Zoom credentials are not configured. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET to .env.');
  let hostCount = 0;
  let importedAttendees = 0;
  let importedPhones = 0;
  const historyWarnings = [];
  const meetingTypes = zoomMeetingTypes();
  for (const account of accounts) {
    if (meetings.length >= maxMeetings) break;
    const accessToken = await zoomAccessToken(account);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const hosts = await fetchZoomMeetingHosts(auth, Number(process.env.ZOOM_MAX_USERS || 100), account);
    hostCount += hosts.length;
    for (const host of hosts) {
      if (meetings.length >= maxMeetings) break;
      const syncKey = `${account.accountId}:${host.id || zoomUserId()}`;
      const previousSyncState = db.zoom.sync_state[syncKey] || {};
      db.zoom.sync_state[syncKey] = {
        ...previousSyncState,
        zoom_account_id: account.accountId,
        zoom_account_label: account.label,
        zoom_user_id: host.id || zoomUserId(),
        zoom_user_label: host.label || host.id || zoomUserId(),
        last_attempt_at: new Date().toISOString(),
        status: 'running'
      };
      for (const meetingType of meetingTypes) {
        if (meetings.length >= maxMeetings) break;
        let nextPageToken = '';
        while (meetings.length < maxMeetings) {
          const params = new URLSearchParams({
            type: meetingType,
            page_size: String(Math.max(1, Math.min(100, maxMeetings - meetings.length)))
          });
          if (nextPageToken) params.set('next_page_token', nextPageToken);
          let list;
          try {
            list = await fetchZoomJson(`https://api.zoom.us/v2/users/${encodeURIComponent(host.id || zoomUserId())}/meetings?${params}`, { headers: auth, timeoutMs: 20000 }, `Zoom meetings for ${account.label} / ${host.label || host.id} / ${meetingType}`);
          } catch (error) {
            historyWarnings.push(error.message || `Zoom meetings failed for ${host.label || host.id} / ${meetingType}`);
            break;
          }
          for (const meeting of list.meetings || []) {
            const key = `${account.accountId}-${host.id || zoomUserId()}-${meeting.uuid || meeting.id || meeting.topic || 'meeting'}-${meeting.start_time || meeting.created_at || ''}`;
            if (seenMeetings.has(key)) continue;
            seenMeetings.add(key);
            const enrichedMeeting = await enrichZoomMeetingWithAttendees(auth, account, host, { ...meeting, host_id: host.id, host_label: host.label, zoom_account_id: account.accountId, zoom_account_label: account.label, zoom_list_type: meetingType }, leadByEmail, historyWarnings, attendeeAvailability);
            importedAttendees += enrichedMeeting.zoom_attendee_count || 0;
            importedPhones += enrichedMeeting.zoom_phone_count || 0;
            meetings.push(enrichedMeeting);
            if (meetings.length >= maxMeetings) break;
          }
          nextPageToken = list.next_page_token || '';
          if (!nextPageToken || !(list.meetings || []).length) break;
        }
      }
      if (zoomIncludeHistory() && meetings.length < maxMeetings) {
        const reportDisabled = previousSyncState.report_history_unavailable && zoomReportUnsupportedWarning(previousSyncState.last_error);
        const history = reportDisabled
          ? { meetings: [], warning: '', ranges: [], skipped: true }
          : await fetchZoomReportMeetings(auth, account, host, maxMeetings - meetings.length, { ...options, sync_state: previousSyncState });
        if (history.warning) {
          if (!zoomReportUnsupportedWarning(history.warning)) historyWarnings.push(history.warning);
          db.zoom.sync_state[syncKey] = {
            ...db.zoom.sync_state[syncKey],
            status: 'warning',
            last_error: history.warning,
            report_history_unavailable: zoomReportUnsupportedWarning(history.warning),
            last_report_ranges: history.ranges || []
          };
        } else {
          db.zoom.sync_state[syncKey] = {
            ...db.zoom.sync_state[syncKey],
            status: 'ok',
            initial_backfill_completed: history.skipped ? Boolean(previousSyncState.initial_backfill_completed) : true,
            last_successful_sync_at: new Date().toISOString(),
            last_error: history.skipped ? (previousSyncState.last_error || '') : '',
            report_history_unavailable: history.skipped ? Boolean(previousSyncState.report_history_unavailable) : false,
            last_report_ranges: history.ranges || []
          };
        }
        for (const meeting of history.meetings || []) {
          const key = `${account.accountId}-${host.id || zoomUserId()}-${meeting.uuid || meeting.id || meeting.topic || 'meeting'}-${meeting.start_time || meeting.created_at || ''}`;
          if (seenMeetings.has(key)) continue;
          seenMeetings.add(key);
          const enrichedMeeting = await enrichZoomMeetingWithAttendees(auth, account, host, { ...meeting, duration: meeting.duration || meeting.total_minutes, status: meeting.status || 'past', host_id: host.id, host_label: host.label, zoom_account_id: account.accountId, zoom_account_label: account.label, zoom_list_type: 'report_history' }, leadByEmail, historyWarnings, attendeeAvailability);
          importedAttendees += enrichedMeeting.zoom_attendee_count || 0;
          importedPhones += enrichedMeeting.zoom_phone_count || 0;
          meetings.push(enrichedMeeting);
          if (meetings.length >= maxMeetings) break;
        }
      }
    }
  }
  let importedEvents = 0, updatedEvents = 0;
  for (const meeting of meetings.slice(0, maxMeetings)) {
    const meetingId = String(meeting.id || '').trim();
    const meetingUuid = String(meeting.uuid || '').trim();
    const startAt = meeting.start_time || meeting.created_at || new Date().toISOString();
    const recordForMatch = {
      name: meeting.topic || 'Zoom meeting',
      start_at: startAt,
      location: 'Zoom',
      zoom_meeting_id: meetingId,
      zoom_meeting_uuid: meetingUuid
    };
    let existing = (db.events || []).find(item => meetingId && String(item.zoom_meeting_id || '') === meetingId && (!item.zoom_account_id || !meeting.zoom_account_id || String(item.zoom_account_id) === String(meeting.zoom_account_id))) ||
      (db.events || []).find(item => meetingUuid && String(item.zoom_meeting_uuid || '') === meetingUuid && (!item.zoom_account_id || !meeting.zoom_account_id || String(item.zoom_account_id) === String(meeting.zoom_account_id))) ||
      Events.findSpreadsheetEvent(db, recordForMatch);
    const record = {
      id: existing?.id || Util.nextId('EV', [db.events]),
      zoom_meeting_id: meetingId,
      zoom_meeting_uuid: meetingUuid,
      zoom_host_id: meeting.host_id || '',
      zoom_host_label: meeting.host_label || '',
      zoom_account_id: meeting.zoom_account_id || existing?.zoom_account_id || '',
      zoom_account_label: meeting.zoom_account_label || existing?.zoom_account_label || '',
      zoom_list_type: meeting.zoom_list_type || existing?.zoom_list_type || '',
      name: meeting.topic || 'Zoom meeting',
      location: 'Zoom',
      start_at: startAt,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      end_at: meeting.duration ? new Date(new Date(startAt).getTime() + Number(meeting.duration || 0) * 60000).toISOString() : existing?.end_at || null,
      campaign: [meeting.zoom_account_label || 'Zoom', meeting.host_label].filter(Boolean).join(' - '),
      capacity: Math.max(Number(existing?.capacity || 0), Number(meeting.zoom_attendees?.length || 0)),
      registrations: Math.max(Number(existing?.registrations || 0), Number(existing?.attendees?.length || 0), Number(meeting.zoom_attendees?.length || 0)),
      attendance: Math.max(Number(existing?.attendance || 0), Number((meeting.zoom_attendees || []).filter(attendee => attendee.attended_at || String(attendee.status || '').toLowerCase() === 'attended').length || 0)),
      attendees: Events.mergeEventAttendees(existing?.attendees || [], meeting.zoom_attendees || []),
      description: meeting.agenda || existing?.description || '',
      status: meeting.status || existing?.status || '',
      timezone: meeting.timezone || existing?.timezone || '',
      meeting_link: meeting.join_url || existing?.meeting_link || existing?.zoom_link || '',
      zoom_link: meeting.join_url || existing?.zoom_link || existing?.meeting_link || ''
    };
    if (existing) {
      Object.assign(existing, record);
      updatedEvents += 1;
    } else {
      db.events.push(record);
      importedEvents += 1;
    }
    if (meetingId && !(db.zoom.imported_meeting_ids || []).includes(meetingId)) {
      db.zoom.imported_meeting_ids = [...(db.zoom.imported_meeting_ids || []), meetingId];
    }
  }
  db.zoom.last_sync_at = new Date().toISOString();
  db.zoom.user_id = zoomSyncAllUsers() ? `all users across ${accounts.length} accounts` : (process.env.ZOOM_USER_ID || 'me');
  db.zoom.accounts = accounts.length;
  const reportHistorySkipped = Object.values(db.zoom.sync_state || {}).filter(item => item?.report_history_unavailable).length;
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Zoom meetings synced', 'integration', 'Zoom', `${importedEvents} created, ${updatedEvents} updated, ${meetings.length} scanned from ${hostCount} users across ${accounts.length} accounts, ${importedAttendees} attendees, ${importedPhones} phones (${meetingTypes.join(', ')}${zoomIncludeHistory() ? ', report_history' : ''})`);
  if (options.save !== false) await Storage.saveDb(db);
  return {
    imported_events: importedEvents,
    updated_events: updatedEvents,
    scanned: meetings.length,
    imported_attendees: importedAttendees,
    imported_phones: importedPhones,
    users: hostCount,
    accounts: accounts.length,
    history: zoomIncludeHistory(),
    report_history_months: zoomReportHistoryMonths(options),
    history_months: zoomReportHistoryMonths(options),
    history_from: options.history_from || process.env.ZOOM_HISTORY_FROM || '',
    history_warnings: [...new Set(historyWarnings)],
    report_history_skipped: reportHistorySkipped,
    all_users: zoomSyncAllUsers(),
    reconciliation,
    last_sync_at: db.zoom.last_sync_at
  };
}

exports.mergeZoomState = mergeZoomState;
exports.loadZoomEventPageDb = loadZoomEventPageDb;
exports.loadZoomCallPageDb = loadZoomCallPageDb;
exports.loadZoomNumberPageDb = loadZoomNumberPageDb;
exports.zoomConfigured = zoomConfigured;
exports.zoomAccounts = zoomAccounts;
exports.wait = wait;
exports.scheduleZoomAutoSync = scheduleZoomAutoSync;
exports.zoomSyncAllUsers = zoomSyncAllUsers;
exports.zoomMeetingType = zoomMeetingType;
exports.zoomReportHistoryMonths = zoomReportHistoryMonths;
exports.samePhone = samePhone;
exports.zoomCallLeadMatch = zoomCallLeadMatch;
exports.importZoomCalls = importZoomCalls;
exports.hydrateZoomStoredCall = hydrateZoomStoredCall;
exports.importZoomMeetings = importZoomMeetings;
