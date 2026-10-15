'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const Config = require('./config');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Workspace = require('./workspace');
const Audit = require('./audit');
const Programmes = require('./programmes');
const Leads = require('./leads');
const Tasks = require('./tasks');
const Emails = require('./emails');
const Applications = require('./applications');
const Eventbrite = require('./integrations/eventbrite');
const Zoom = require('./integrations/zoom');
const Zoho = require('./integrations/zoho');
const Jobs = require('./jobs');

let eventAutoSyncTimer = null;

function importEventRows(db) {
  return (db.events || []).map(item => ({
    id: item.id,
    name: item.name || null,
    start_at: item.start_at || null,
    location: item.location || null,
    campaign: item.campaign || null,
    capacity: item.capacity || 0,
    registrations: item.registrations || 0,
    attendance: item.attendance || 0,
    attendees: item.attendees || [],
    data: item
  }));
}

function uniqueRowsById(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function saveEventImportTables(db, options = {}) {
  if (!State.postgresPool) return Storage.saveDb(db);
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    let gmailState = db.gmail || {};
    if (options.preserveGmail) {
      const current = await client.query(`select gmail from app_workspace where id = $1`, ['main']);
      gmailState = current.rows[0]?.gmail || gmailState;
    }
    const metaState = await Storage.workspaceMetaForSave(client, db, options);
    await client.query(
      `insert into app_workspace (id, demo, stages, sources, gmail, eventbrite, meta, updated_at)
       values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
       on conflict (id) do update set
         demo = excluded.demo,
         stages = excluded.stages,
         sources = excluded.sources,
         gmail = excluded.gmail,
         eventbrite = excluded.eventbrite,
         meta = excluded.meta,
         updated_at = now()`,
      ['main', Boolean(db.demo), Applications.jsonValue(db.stages || []), Applications.jsonValue(db.sources || []), Applications.jsonValue(gmailState), Applications.jsonValue(db.eventbrite || {}), Applications.jsonValue(metaState)]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(id text, name text, level text, data jsonb)
       )
       insert into app_programmes (id, name, level, data)
       select id, name, level, data from rows
       on conflict (id) do update set name = excluded.name, level = excluded.level, data = excluded.data
       where app_programmes.name is distinct from excluded.name
          or app_programmes.level is distinct from excluded.level
          or app_programmes.data is distinct from excluded.data`,
      [Applications.jsonValue(uniqueRowsById(Programmes.importProgrammeRows(db)))]
    );
    if (!options.skipLeads) {
      await client.query(
        `with rows as (
           select * from jsonb_to_recordset($1::jsonb) as x(
             id text, person_id text, first_name text, last_name text, email text, employer text, phone text, city text,
             programme_id text, programme text, level text, owner_id text, owner text, stage text, priority text,
             source_first_touch text, source_lead_capture text, contact_permission text, created_at text, next_action_at text, data jsonb
           )
         )
         insert into app_leads (id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data)
         select id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at::timestamptz, next_action_at::timestamptz, data from rows
         on conflict (id) do update set
           person_id = excluded.person_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
           employer = excluded.employer, phone = excluded.phone, city = excluded.city, programme_id = excluded.programme_id,
           programme = excluded.programme, level = excluded.level, owner_id = excluded.owner_id, owner = excluded.owner,
           stage = excluded.stage, priority = excluded.priority, source_first_touch = excluded.source_first_touch,
           source_lead_capture = excluded.source_lead_capture, contact_permission = excluded.contact_permission,
           created_at = excluded.created_at, next_action_at = excluded.next_action_at, data = excluded.data
         where app_leads.person_id is distinct from excluded.person_id
            or app_leads.first_name is distinct from excluded.first_name
            or app_leads.last_name is distinct from excluded.last_name
            or app_leads.email is distinct from excluded.email
            or app_leads.employer is distinct from excluded.employer
            or app_leads.phone is distinct from excluded.phone
            or app_leads.city is distinct from excluded.city
            or app_leads.programme_id is distinct from excluded.programme_id
            or app_leads.programme is distinct from excluded.programme
            or app_leads.level is distinct from excluded.level
            or app_leads.owner_id is distinct from excluded.owner_id
            or app_leads.owner is distinct from excluded.owner
            or app_leads.stage is distinct from excluded.stage
            or app_leads.priority is distinct from excluded.priority
            or app_leads.source_first_touch is distinct from excluded.source_first_touch
            or app_leads.source_lead_capture is distinct from excluded.source_lead_capture
            or app_leads.contact_permission is distinct from excluded.contact_permission
            or app_leads.created_at is distinct from excluded.created_at
            or app_leads.next_action_at is distinct from excluded.next_action_at
            or app_leads.data is distinct from excluded.data`,
        [Applications.jsonValue(uniqueRowsById(Leads.importLeadRows(db)))]
      );
    }
    if (!options.skipTasks) await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, title text, lead_id text, kind text, status text, due_at text, completed_at text, priority text, owner_id text, data jsonb
         )
       )
       insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
       select id, title, lead_id, kind, status, due_at::timestamptz, completed_at::timestamptz, priority, owner_id, data from rows
       on conflict (id) do update set
         title = excluded.title, lead_id = excluded.lead_id, kind = excluded.kind, status = excluded.status,
         due_at = excluded.due_at, completed_at = excluded.completed_at, priority = excluded.priority,
         owner_id = excluded.owner_id, data = excluded.data
       where app_tasks.title is distinct from excluded.title
          or app_tasks.lead_id is distinct from excluded.lead_id
          or app_tasks.kind is distinct from excluded.kind
          or app_tasks.status is distinct from excluded.status
          or app_tasks.due_at is distinct from excluded.due_at
          or app_tasks.completed_at is distinct from excluded.completed_at
          or app_tasks.priority is distinct from excluded.priority
          or app_tasks.owner_id is distinct from excluded.owner_id
          or app_tasks.data is distinct from excluded.data`,
      [Applications.jsonValue(uniqueRowsById(Tasks.importTaskRows(db)))]
    );
    if (!options.skipAudit) await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, name text, start_at text, location text, campaign text, capacity int, registrations int, attendance int, attendees jsonb, data jsonb
         )
       )
       insert into app_events (id, name, start_at, location, campaign, capacity, registrations, attendance, attendees, data)
       select id, name, start_at::timestamptz, location, campaign, capacity, registrations, attendance, attendees, data from rows
       on conflict (id) do update set
         name = excluded.name, start_at = excluded.start_at, location = excluded.location, campaign = excluded.campaign,
         capacity = excluded.capacity, registrations = excluded.registrations, attendance = excluded.attendance,
         attendees = excluded.attendees, data = excluded.data
       where app_events.name is distinct from excluded.name
          or app_events.start_at is distinct from excluded.start_at
          or app_events.location is distinct from excluded.location
          or app_events.campaign is distinct from excluded.campaign
          or app_events.capacity is distinct from excluded.capacity
          or app_events.registrations is distinct from excluded.registrations
          or app_events.attendance is distinct from excluded.attendance
          or app_events.attendees is distinct from excluded.attendees
          or app_events.data is distinct from excluded.data`,
      [Applications.jsonValue(uniqueRowsById(importEventRows(db)))]
    );
    await client.query(
      `with rows as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, occurred_at text, actor text, action text, entity text, entity_id text, data jsonb
         )
       )
       insert into app_audit (id, occurred_at, actor, action, entity, entity_id, data)
       select id, occurred_at::timestamptz, actor, action, entity, entity_id, data from rows
       on conflict (id) do update set
         occurred_at = excluded.occurred_at, actor = excluded.actor, action = excluded.action,
         entity = excluded.entity, entity_id = excluded.entity_id, data = excluded.data
       where app_audit.occurred_at is distinct from excluded.occurred_at
          or app_audit.actor is distinct from excluded.actor
          or app_audit.action is distinct from excluded.action
          or app_audit.entity is distinct from excluded.entity
          or app_audit.entity_id is distinct from excluded.entity_id
          or app_audit.data is distinct from excluded.data`,
      [Applications.jsonValue(uniqueRowsById(Audit.importAuditRows(db)))]
    );
    if (!db.__partial_load) await Zoho.upsertZohoRecordRows(client, Zoho.zohoRecordRows(db));
    await client.query('commit');
    State.dbCache = db.__partial_load ? null : Storage.cloneDb(Workspace.recalculate(Storage.dbWithSavedMeta(db, metaState, { gmail: gmailState })));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function numericHash(value, attempt = 0) {
  const input = `${String(value || '').trim().toLowerCase()}#${attempt}`;
  const hex = crypto.createHash('sha256').update(input).digest('hex').slice(0, 15);
  return String((BigInt(`0x${hex}`) % 900000000000n) + 100000000000n);
}

function eventSourceName(event = {}, attendee = {}) {
  if (event.zoom_meeting_id || event.zoom_meeting_uuid || attendee.zoom_source || String(event.location || '').toLowerCase() === 'zoom') return 'Zoom';
  if (event.eventbrite_event_id || attendee.eventbrite_attendee_id) return 'Eventbrite';
  return 'Event';
}

function leadInputFromAttendee(db, event = {}, attendee = {}) {
  const source = eventSourceName(event, attendee);
  const email = Emails.normalizeEmail(attendee.email);
  const fallbackName = [attendee.first_name, attendee.last_name].filter(Boolean).join(' ') || attendee.name || `${source} attendee`;
  const parts = Util.nameParts(fallbackName, email || `${attendee.id || numericHash(fallbackName)}@${source.toLowerCase()}.local`);
  const programme = programmeForEvent(db, event.name || event.description || event.campaign || '');
  return {
    first_name: attendee.first_name || parts.first_name || source,
    last_name: attendee.last_name || parts.last_name || 'Attendee',
    programme_id: programme.id,
    email: email || `${attendee.id || numericHash(`${event.id || event.name}:${fallbackName}`)}@${source.toLowerCase()}.local`,
    employer: attendee.employer || attendee.company || '',
    phone: attendee.phone || '',
    city: attendee.city || '',
    stage: 'New lead',
    priority: 'P2',
    source_first_touch: source,
    source_lead_capture: source,
    contact_permission: attendee.contact_permission || 'Unknown',
    created_at: attendee.created_at || attendee.attended_at || event.start_at || event.created_at || new Date().toISOString(),
    eventbrite_attendee_id: attendee.eventbrite_attendee_id || ''
  };
}

function eventListDataSql() {
  return `
    jsonb_build_object(
      'id', e.id,
      'name', coalesce(e.name, e.data->>'name', 'Event'),
      'title', coalesce(e.name, e.data->>'title', e.data->>'name', 'Event'),
      'start_at', e.start_at,
      'end_at', coalesce(e.data->>'end_at', e.data->>'endAt'),
      'duration', e.data->'duration',
      'duration_mins', e.data->'duration_mins',
      'source', e.data->>'source',
      'eventbrite_event_id', e.data->>'eventbrite_event_id',
      'location', coalesce(e.location, e.data->>'location', ''),
      'campaign', coalesce(e.campaign, e.data->>'campaign', ''),
      'capacity', coalesce(e.capacity, nullif(e.data->>'capacity', '')::int, 0),
      'registrations', greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)),
      'attendance', coalesce(e.attendance, a.attended, 0),
      'attendee_count', coalesce(a.attendee_count, 0),
      'description', coalesce(e.data->>'description', ''),
      'status', coalesce(e.data->>'status', ''),
      'meeting_link', coalesce(e.data->>'meeting_link', e.data->>'zoom_link', ''),
      'zoom_link', coalesce(e.data->>'zoom_link', e.data->>'meeting_link', ''),
      'zoom_meeting_id', coalesce(e.data->>'zoom_meeting_id', ''),
      'zoom_meeting_uuid', coalesce(e.data->>'zoom_meeting_uuid', ''),
      'zoom_host_id', coalesce(e.data->>'zoom_host_id', ''),
      'zoom_host_label', coalesce(e.data->>'zoom_host_label', ''),
      'zoom_account_id', coalesce(e.data->>'zoom_account_id', ''),
      'zoom_account_label', coalesce(e.data->>'zoom_account_label', ''),
      'zoom_list_type', coalesce(e.data->>'zoom_list_type', e.data->>'status', ''),
      'metrics', jsonb_build_object(
        'booked', greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)),
        'confirmed', coalesce(a.confirmed, 0),
        'attended', greatest(coalesce(e.attendance, 0), coalesce(a.attended, 0)),
        'declined', coalesce(a.declined, 0),
        'noAnswer', coalesce(a.no_answer, 0),
        'pending', greatest(0, greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)) - coalesce(a.confirmed, 0) - coalesce(a.attended, 0) - coalesce(a.declined, 0)),
        'capacity', coalesce(e.capacity, nullif(e.data->>'capacity', '')::int, greatest(coalesce(e.registrations, 0), coalesce(a.attendee_count, 0)))
      )
    )
  `;
}

const EVENT_ATTENDEE_STATS_SQL = `
  left join lateral (
    select
      count(*)::int as attendee_count,
      count(*) filter (where recorded.attendance = 'attended')::int as attended,
      count(*) filter (where recorded.attendance <> 'attended' and lower(coalesce(x.value->>'status', x.value->>'outcome', '')) ~ 'confirm|confirmed')::int as confirmed,
      count(*) filter (where lower(coalesce(x.value->>'status', '')) ~ 'declined|cancel|no show|absent')::int as declined,
      count(*) filter (where lower(coalesce(x.value->>'status', '')) ~ 'no answer|not reached')::int as no_answer
    from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) x
    cross join lateral (select case
      when lower(trim(coalesce(x.value->>'attendance', ''))) = 'did not attend' then 'absent'
      when lower(trim(coalesce(x.value->>'attendance', ''))) = 'attended' then 'attended'
      when coalesce(nullif(x.value->>'attended_at', ''), nullif(x.value->>'checked_in_at', ''), '') <> '' then 'attended'
      when lower(trim(coalesce(x.value->>'outcome', ''))) in ('no show','no-show','absent','did not attend','not attended')
        or lower(trim(coalesce(x.value->>'status', ''))) in ('no show','no-show','absent','did not attend','not attended') then 'absent'
      when lower(trim(coalesce(x.value->>'outcome', ''))) in ('attended','present','checked in','checked_in','checked-in')
        or lower(trim(coalesce(x.value->>'status', ''))) in ('attended','present','checked in','checked_in','checked-in') then 'attended'
      else 'unknown' end as attendance) recorded
  ) a on true`;

async function loadEventDetailDb(id, trace = null) {
  await Perf.perfPhase(trace, 'events_storage', () => Storage.ensureStorage());
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const event = (await Storage.loadDb()).events.find(item => String(item.id) === String(id));
    if (!event) throw Http.statusError(404, 'Event not found.');
    return { event };
  }
  const result = await Storage.timedPostgresQuery(trace, 'event_detail', `select data from app_events where id = $1 limit 1`, [String(id)]);
  const event = result.rows[0]?.data;
  if (!event) throw Http.statusError(404, 'Event not found.');
  return { event };
}

async function loadEventPeoplePage(id, options = {}, trace = null) {
  const offset = Math.max(0, Math.min(1000000, Number.parseInt(options.offset, 10) || 0));
  const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 50));
  await Storage.ensureStorage();
  let event, people, total;
  if (State.postgresPool && Storage.usesPostgresStorage()) {
    const result = await Storage.timedPostgresQuery(trace, 'event_people', `select e.id,
      jsonb_array_length(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end)::int as total,
      (select coalesce(jsonb_agg(a.person order by a.position), '[]'::jsonb) from (
        select person, position from jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end)
        with ordinality as p(person, position) order by position limit $2 offset $3
      ) a) as people from app_events e where e.id = $1`, [String(id), limit, offset]);
    event = result.rows[0];
    total = Number(event?.total || 0); people = event?.people || [];
  } else {
    event = (await Storage.loadDb()).events.find(item => String(item.id) === String(id));
    const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
    total = attendees.length; people = attendees.slice(offset, offset + limit);
  }
  if (!event) throw Http.statusError(404, 'Event not found.');
  return { event_id: String(id), total, offset, limit, has_more: offset + people.length < total,
    items: people.map((person, index) => ({
      id: String(person.id || `${id}-person-${offset + index}`),
      name: person.name || [person.first_name, person.last_name].filter(Boolean).join(' ') || '',
      email: person.email || '', phone: person.phone || '',
      status: person.status || person.outcome || '',
      attendance: person.attendance || '',
      attended_at: person.attended_at || person.checked_in_at || null,
      registered_at: person.registered_at || person.created_at || null,
      lead_id: person.lead_id || null,
    })) };
}

// Events are loaded as bounded summaries. Attendees stay off the hot list path and are fetched
// only for a single event detail dialog.
async function loadEventPage(options = {}, trace = null) {
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
  const upcomingOnly = ['1', 'true'].includes(String(options.upcoming || '').toLowerCase());
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const cursor = Util.decodePageCursor(options.cursor, 'event cursor');
  if (options.cursor && (!cursor || typeof cursor.id !== 'string' || !cursor.id || (cursor.start_at && !Number.isFinite(Date.parse(cursor.start_at))))) {
    throw Http.statusError(400, 'Invalid event cursor.');
  }
  const search = String(options.search || '').trim().toLowerCase().slice(0, 200);
  const source = String(options.source || 'all');
  if (!['all', 'Zoom', 'Eventbrite', 'Manual'].includes(source)) throw Http.statusError(400, 'Invalid event source.');
  const dateBound = name => {
    if (!options[name]) return null;
    const value = Date.parse(options[name]);
    if (!Number.isFinite(value)) throw Http.statusError(400, `Invalid ${name}.`);
    return new Date(value).toISOString();
  };
  const startFrom = dateBound('start_from') || (upcomingOnly ? new Date().toISOString() : null);
  const startTo = dateBound('start_to');
  await Perf.perfPhase(trace, 'events_storage', () => Storage.ensureStorage());
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const db = await Storage.loadDb();
    const events = (db.events || [])
      .filter(event => {
        const start = Date.parse(event.start_at);
        const label = String(event.source || (event.zoom_meeting_id || event.zoom_meeting_uuid ? 'Zoom' : event.eventbrite_event_id ? 'Eventbrite' : event.campaign || '')).toLowerCase();
        const eventSource = label.includes('zoom') ? 'Zoom' : label.includes('eventbrite') ? 'Eventbrite' : 'Manual';
        return (!startFrom || start >= Date.parse(startFrom)) && (!startTo || start < Date.parse(startTo))
          && (source === 'all' || source === eventSource)
          && (!search || `${event.name || event.title || ''} ${event.location || ''}`.toLowerCase().includes(search));
      })
      .sort((a, b) => {
        const aDate = Date.parse(a.start_at), bDate = Date.parse(b.start_at);
        if (!Number.isFinite(aDate) || !Number.isFinite(bDate)) {
          if (Number.isFinite(aDate)) return -1;
          if (Number.isFinite(bDate)) return 1;
        } else if (aDate !== bDate) return upcomingOnly ? aDate - bDate : bDate - aDate;
        return upcomingOnly ? String(a.id).localeCompare(String(b.id)) : String(b.id).localeCompare(String(a.id));
      });
    const start = cursor?.id ? Math.max(0, events.findIndex(item => item.id === cursor.id) + 1) : 0;
    const page = events.slice(start, start + limit);
    const nextCursor = start + page.length < events.length ? Util.encodePageCursor({ start_at: page[page.length - 1]?.start_at || null, id: page[page.length - 1]?.id || '' }) : '';
    return { items: page, total: includeTotal ? events.length : null, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
  }
  const conditions = [];
  const values = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  if (startFrom) conditions.push(`e.start_at >= ${bind(startFrom)}::timestamptz`);
  if (startTo) conditions.push(`e.start_at < ${bind(startTo)}::timestamptz`);
  if (search) conditions.push(`position(${bind(search)} in lower(coalesce(e.name, e.data->>'name', e.data->>'title', '') || ' ' || coalesce(e.location, e.data->>'location', ''))) > 0`);
  if (source !== 'all') {
    const label = `lower(coalesce(nullif(e.data->>'source', ''), case when coalesce(e.data->>'zoom_meeting_id', e.data->>'zoom_meeting_uuid', '') <> '' then 'Zoom' when coalesce(e.data->>'eventbrite_event_id', '') <> '' then 'Eventbrite' end, e.campaign, ''))`;
    conditions.push(`(case when ${label} like '%zoom%' then 'Zoom' when ${label} like '%eventbrite%' then 'Eventbrite' else 'Manual' end) = ${bind(source)}`);
  }
  const countWhere = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const countValues = [...values];
  if (cursor?.id) {
    const idParam = bind(String(cursor.id || ''));
    if (cursor.start_at) {
      const startParam = bind(cursor.start_at);
      conditions.push(upcomingOnly
        ? `(start_at > ${startParam}::timestamptz or (start_at = ${startParam}::timestamptz and id > ${idParam}) or start_at is null)`
        : `(start_at < ${startParam}::timestamptz or (start_at = ${startParam}::timestamptz and id < ${idParam}) or start_at is null)`);
    } else {
      conditions.push(upcomingOnly ? `(start_at is null and id > ${idParam})` : `(start_at is null and id < ${idParam})`);
    }
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const order = upcomingOnly ? `e.start_at asc nulls last, e.id asc` : `e.start_at desc nulls last, e.id desc`;
  const [list, count] = await Promise.all([
    Storage.timedPostgresQuery(trace, 'events_page', `select ${eventListDataSql()} as data, e.start_at from app_events e ${EVENT_ATTENDEE_STATS_SQL} ${where} order by ${order} limit $${values.length + 1}`, [...values, limit + 1]),
    includeTotal ? Storage.timedPostgresQuery(trace, 'events_count', `select count(*)::int as total from app_events e ${countWhere}`, countValues) : Promise.resolve(null)
  ]);
  return Perf.perfPhase(trace, 'mapping', async () => {
    const rows = list.rows.slice(0, limit).map(row => row.data).filter(Boolean);
    const last = list.rows.slice(0, limit).at(-1);
    const nextCursor = list.rows.length > limit && last?.data?.id ? Util.encodePageCursor({ start_at: last.start_at || last.data.start_at || null, id: last.data.id }) : '';
    return { items: rows, total: count ? Number(count.rows[0]?.total || 0) : null, hasMore: Boolean(nextCursor), has_more: Boolean(nextCursor), nextCursor, next_cursor: nextCursor, limit };
  });
}

async function loadMarketingSummary() {
  if (!State.postgresPool) return null;
  try {
    const result = await State.postgresPool.query(`
      select
        coalesce(sum(m.revenue), 0)::float as revenue,
        coalesce(sum(m.ticket_sales), 0)::int as ticket_sales,
        coalesce(sum(m.delivered), 0)::int as delivered,
        coalesce(sum(m.opened), 0)::int as opened,
        coalesce(sum(m.clicks), 0)::int as clicks,
        coalesce(sum(m.unsubscribed), 0)::int as unsubscribed,
        coalesce(sum(m.bounced), 0)::int as bounced,
        coalesce(max((s.data->>'fallback_unsubscribe_rate')::numeric), 0)::float as fallback_unsubscribe_rate,
        coalesce(max((s.data->>'fallback_bounce_rate')::numeric), 0)::float as fallback_bounce_rate
      from app_marketing_campaign_metrics m
      cross join app_marketing_settings s
      where s.id = 'main'
    `);
    const row = result.rows[0] || {};
    const delivered = Number(row.delivered || 0);
    const fallbackUnsubRate = Number(row.fallback_unsubscribe_rate || 0);
    const fallbackBounceRate = Number(row.fallback_bounce_rate || 0);
    const unsubscribed = Number(row.unsubscribed || 0) || Math.round(delivered * fallbackUnsubRate);
    const bounced = Number(row.bounced || 0) || Math.round(delivered * fallbackBounceRate);
    return {
      revenue: Number(row.revenue || 0),
      ticket_sales: Number(row.ticket_sales || 0),
      delivered,
      opened: Number(row.opened || 0),
      clicks: Number(row.clicks || 0),
      unsubscribed,
      bounced,
      unsubscribe_rate: delivered ? unsubscribed / delivered : 0,
      bounce_rate: delivered ? bounced / delivered : 0,
      source: 'app_marketing_*'
    };
  } catch {
    return null;
  }
}

async function checkInAttendeeFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const eventResult = await client.query(
      `select data from app_events where attendees @> $1::jsonb limit 1 for update`,
      [JSON.stringify([{ id }])]
    );
    const event = eventResult.rows[0]?.data;
    if (!event) throw Http.statusError(404, 'Attendee not found.');
    const attendee = (event.attendees || []).find(item => item.id === id);
    if (!attendee) throw Http.statusError(404, 'Attendee not found.');
    attendee.attended_at = attendee.attended_at || new Date().toISOString();
    attendee.status = attendee.status || 'Attended';
    event.attendance = (event.attendees || []).filter(item => item.attended_at).length;
    let task = null;
    if (attendee.lead_id) {
      const leadResult = await client.query(`select data from app_leads where id = $1 limit 1`, [attendee.lead_id]);
      const lead = leadResult.rows[0]?.data;
      if (lead) {
        task = {
          id: `T-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          title: 'Follow up after event attendance',
          lead_id: lead.id,
          kind: 'Follow-up',
          status: 'Open',
          created_at: new Date().toISOString(),
          due_at: new Date(Date.now() + 86400000).toISOString(),
          priority: lead.priority,
          owner_id: lead.owner_id
        };
        await client.query(
          `insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
           values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`,
          [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, Applications.jsonValue(task)]
        );
        await Audit.appendAuditFast(client, user, 'Event attendee checked in', 'lead', lead.id, `${attendee.first_name || ''} ${attendee.last_name || ''}`.trim());
      }
    }
    await client.query(
      `update app_events set attendance = $2, attendees = $3::jsonb, data = $4::jsonb where id = $1`,
      [event.id, event.attendance, Applications.jsonValue(event.attendees || []), Applications.jsonValue(event)]
    );
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, attendee, event, task };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function scheduleEventAutoSync(delayMs) {
  if (!Config.EVENT_AUTO_SYNC_ENABLED) return;
  if (eventAutoSyncTimer) clearTimeout(eventAutoSyncTimer);
  const delay = Math.max(1000, Number(delayMs) || Config.EVENT_AUTO_SYNC_INTERVAL_MS);
  State.eventAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
  eventAutoSyncTimer = setTimeout(runEventAutoSync, delay);
  if (eventAutoSyncTimer.unref) eventAutoSyncTimer.unref();
}

async function runEventAutoSync() {
  if (!Config.EVENT_AUTO_SYNC_ENABLED) return;
  if (State.zoomAutoSyncRunning) return scheduleEventAutoSync(60 * 1000);
  if (State.eventAutoSyncRunning) return scheduleEventAutoSync(Config.EVENT_AUTO_SYNC_INTERVAL_MS);
  State.eventAutoSyncRunning = true;
  State.eventAutoSyncState.running = true;
  console.log('Event auto sync starting.');
  try {
    const db = await Storage.loadDb();
    const user = Jobs.autoSyncUser(db);
    const results = {};
    if (Eventbrite.eventbriteConfigured() || Eventbrite.eventbritePrivateTokenConfigured()) {
      try {
        results.eventbrite = await Eventbrite.importEventbriteEvents(db, user, Config.EVENT_AUTO_SYNC_MAX_EVENTS, { save: false });
        await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
      } catch (error) {
        results.eventbrite = { error: error.message || 'Eventbrite sync failed.' };
      }
    } else {
      results.eventbrite = { skipped: true, reason: 'Eventbrite is not configured.' };
    }
    if (Config.EVENTS_SHEET_URL) {
      try {
        results.sheet = await importSpreadsheetEvents(db, user, { filename: 'auto-events-sheet', google_url: Config.EVENTS_SHEET_URL });
        await saveEventImportTables(db, { preserveGmail: true, preserveZoom: true });
      } catch (error) {
        results.sheet = { error: error.message || 'Sheet sync failed.' };
      }
    } else {
      results.sheet = { skipped: true, reason: 'EVENTS_SHEET_URL is not configured.' };
    }
    if (Zoom.zoomConfigured() && !Config.ZOOM_AUTO_SYNC_ENABLED) {
      try {
        results.zoom = await Zoom.importZoomMeetings(db, user, Number(process.env.ZOOM_MAX_MEETINGS || 500), { save: false });
        await saveEventImportTables(db, { preserveGmail: true });
      } catch (error) {
        results.zoom = { error: error.message || 'Zoom sync failed.' };
      }
    } else if (Config.ZOOM_AUTO_SYNC_ENABLED) {
      results.zoom = { skipped: true, reason: 'Zoom auto sync runs in its own worker.' };
    } else {
      results.zoom = { skipped: true, reason: 'Zoom is not configured.' };
    }
    State.eventAutoSyncState.last_result = results;
    const errors = Object.values(results).filter(item => item?.error).map(item => item.error);
    State.eventAutoSyncState.last_error = errors.length ? errors.join('; ') : null;
    console.log(`Event auto sync finished: ${JSON.stringify(results)}`);
  } catch (error) {
    State.eventAutoSyncState.last_error = error.message || 'Event auto sync failed.';
    console.error(`Event auto sync failed: ${State.eventAutoSyncState.last_error}`);
  } finally {
    State.eventAutoSyncRunning = false;
    State.eventAutoSyncState.running = false;
    scheduleEventAutoSync(Config.EVENT_AUTO_SYNC_INTERVAL_MS);
  }
}

function programmeForEvent(db, eventName = '') {
  return Programmes.programmeForText(db, eventName);
}

function eventVenue(event) {
  if (event.online_event) return 'Online';
  const venue = event.venue || {};
  return venue.name || venue.address?.localized_area_display || venue.address?.city || 'Eventbrite';
}

function leadFromAttendee(db, user, attendee, event) {
  const profile = attendee.profile || {};
  const email = String(profile.email || attendee.email || '').toLowerCase();
  const first_name = profile.first_name || profile.name?.split(/\s+/)[0] || 'Eventbrite';
  const last_name = profile.last_name || profile.name?.split(/\s+/).slice(1).join(' ') || 'Attendee';
  const programme = programmeForEvent(db, event.name?.text || '');
  const result = Leads.ensureLeadRecord(db, user, {
    first_name,
    last_name,
    programme_id: programme.id,
    email: email || `${attendee.id}@eventbrite.local`,
    employer: profile.company || '',
    phone: profile.cell_phone || profile.home_phone || '',
    city: profile.addresses?.home?.city || '',
    stage: 'New lead',
    priority: 'P2',
    source_first_touch: 'Event',
    source_lead_capture: 'Event',
    contact_permission: 'Unknown',
    created_at: attendee.created || event.created || new Date().toISOString(),
    eventbrite_attendee_id: attendee.id
  }, {
    taskTitle: `Follow up after ${event.name?.text || 'Eventbrite event'}`,
    taskKind: 'Follow-up'
  });
  return result.lead;
}

function normalizeColumnName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function rowValue(row, names) {
  const wanted = names.map(normalizeColumnName);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normalizeColumnName(key)) && value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function truthySpreadsheetValue(value) {
  return /^(yes|y|true|1|attended|checked in|check in|present)$/i.test(String(value || '').trim());
}

function spreadsheetDateValue(dateValue, timeValue = '') {
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) return dateValue.toISOString();
  if (typeof dateValue === 'number') {
    const parsed = XLSX.SSF.parse_date_code(dateValue);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 9, parsed.M || 0, parsed.S || 0)).toISOString();
  }
  const dateText = String(dateValue || '').trim();
  const timeText = String(timeValue || '').trim();
  if (!dateText) return new Date().toISOString();
  const direct = new Date(timeText && !/\d{1,2}:\d{2}/.test(dateText) ? `${dateText} ${timeText}` : dateText);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const dmy = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(.+))?$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const parsed = new Date(`${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}T${timeText || dmy[4] || '09:00'}:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizedEventName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]+/g, '');
}

function eventMasterDateToken(value) {
  const text = String(value || '').trim();
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g);
  if (iso?.length) return iso[iso.length - 1].replace(/\.\d+Z$/, 'Z');
  const date = text.match(/\d{4}-\d{2}-\d{2}/);
  return date ? date[0] : '';
}

function eventStartToken(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 16);
  return text.slice(0, 16).toLowerCase();
}

function spreadsheetEventKey(event) {
  const name = normalizedEventName(event.name);
  const masterDate = eventMasterDateToken(event.master_event_key);
  if (name && masterDate) return `event:${name}|${masterDate}`;
  const start = eventStartToken(event.start_at);
  if (name && start) return `event:${name}|${start}`;
  const sheetId = String(event.sheet_event_id || event.eventbrite_event_id || '').trim().toLowerCase();
  if (sheetId) return `sheet:${sheetId}`;
  return [event.name, event.start_at, event.location].map(item => String(item || '').trim().toLowerCase()).join('|');
}

function findSpreadsheetEvent(db, eventRecord) {
  const key = spreadsheetEventKey(eventRecord);
  const name = normalizedEventName(eventRecord.name);
  const masterDate = eventMasterDateToken(eventRecord.master_event_key);
  const startDay = String(eventRecord.start_at || '').slice(0, 10);
  return (db.events || []).find(item => spreadsheetEventKey(item) === key) ||
    (db.events || []).find(item => {
      if (normalizedEventName(item.name) !== name) return false;
      const itemMasterDate = eventMasterDateToken(item.master_event_key);
      if (masterDate && itemMasterDate) return itemMasterDate === masterDate;
      return String(item.start_at || '').slice(0, 10) === startDay;
    }) ||
    null;
}

function mergeSpreadsheetEventRecord(target, eventRecord) {
  const attendees = target.attendees || [];
  const capacity = Math.max(Number(target.capacity || 0), Number(eventRecord.capacity || 0), attendees.length);
  Object.assign(target, {
    ...eventRecord,
    id: target.id,
    attendees,
    capacity,
    created_at: target.created_at || eventRecord.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return target;
}

function mergeEventAttendees(primary = [], secondary = []) {
  const byKey = new Map();
  for (const attendee of [...primary, ...secondary]) {
    const key = Emails.normalizeEmail(attendee.email) || attendee.eventbrite_attendee_id || attendee.attendee_id || attendee.id;
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) || {}), ...attendee });
  }
  return [...byKey.values()];
}

function googleSheetExportUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const id = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return '';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}

async function spreadsheetBufferFromImport({ filename = 'events.xlsx', file_base64 = '', google_url = '' } = {}) {
  if (google_url) {
    const exportUrl = googleSheetExportUrl(google_url);
    if (!exportUrl) throw Http.statusError(400, 'Use a Google Sheets link, not a Google Doc link.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(exportUrl, { signal: controller.signal });
      if (!response.ok) throw Http.statusError(400, 'Could not read this Google Sheet. Share it with anyone who has the link, then try again.');
      return { filename: `${filename || 'google-sheet'}.xlsx`, buffer: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      if (error.name === 'AbortError') throw Http.statusError(504, 'Google Sheet request timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!file_base64) throw Http.statusError(400, 'Upload an Excel file or paste a Google Sheets link first.');
  const buffer = Buffer.from(String(file_base64).replace(/^data:[^,]+,/, ''), 'base64');
  return { filename, buffer };
}

async function importSpreadsheetEvents(db, user, input = {}) {
  db.eventbrite ||= { connected: false, imported_event_ids: [], imported_attendee_ids: [] };
  const eventIncrementalStart = Config.EVENTS_INCREMENTAL_ONLY ? Storage.ensureIncrementalStart(db.eventbrite, 'events_incremental_started_at') : null;
  const { filename, buffer } = await spreadsheetBufferFromImport(input);
  if (!buffer.length) throw Http.statusError(400, 'The uploaded file is empty.');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames.length) throw Http.statusError(400, 'No sheets were found in this file.');
  const allRows = workbook.SheetNames.flatMap(sheetName => {
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false })
      .filter(row => Object.values(row).some(value => String(value || '').trim()))
      .map(row => ({ ...row, __sheet: sheetName }));
  });
  const rows = allRows.filter(row => {
    const hasAttendee = Emails.normalizeEmail(rowValue(row, ['email', 'email address', 'attendee email', 'learner email', 'student email'])) ||
      rowValue(row, ['attendee id']) ||
      rowValue(row, ['attendee name', 'full name', 'learner name', 'student name', 'name']);
    const hasEvent = rowValue(row, ['event name', 'event', 'event title', 'title', 'session']);
    return hasEvent || hasAttendee;
  });
  if (!rows.length) throw Http.statusError(400, 'No usable rows were found in this file.');

  const eventMap = new Map();
  let importedAttendees = 0;
  let linkedLeads = 0;
  for (const row of rows) {
    const email = Emails.normalizeEmail(rowValue(row, ['email', 'email address', 'attendee email', 'learner email', 'student email']));
    const eventName = String(rowValue(row, ['event name', 'event', 'event title', 'title', 'session']) || path.basename(filename, path.extname(filename)) || 'Imported event').trim();
    const startAt = spreadsheetDateValue(rowValue(row, ['start_at', 'start at', 'date', 'event date', 'start date', 'when']), rowValue(row, ['time', 'start time', 'event time']));
    const meetingLink = String(rowValue(row, ['google meet', 'google meet link', 'meet link', 'zoom link', 'meeting link', 'meeting url', 'join link']) || '').trim();
    const eventRecord = {
      name: eventName,
      location: String(rowValue(row, ['location', 'venue', 'place', 'city']) || 'Imported').trim(),
      start_at: startAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      campaign: String(rowValue(row, ['campaign', 'source', 'channel']) || 'Excel import').trim(),
      capacity: Number(rowValue(row, ['capacity', 'spaces', 'seats']) || 0) || 0,
      sheet_event_id: String(rowValue(row, ['event id']) || '').trim(),
      master_event_key: String(rowValue(row, ['master event key']) || '').trim(),
      description: String(rowValue(row, ['description']) || '').trim(),
      status: String(rowValue(row, ['status', 'event status']) || '').trim(),
      timezone: String(rowValue(row, ['timezone']) || '').trim(),
      ...(meetingLink ? { meeting_link: meetingLink, zoom_link: meetingLink } : {})
    };
    const existing = findSpreadsheetEvent(db, eventRecord);
    const startsAfterIncrementalStart = !eventIncrementalStart || new Date(eventRecord.start_at) >= eventIncrementalStart;
    if (Config.EVENTS_INCREMENTAL_ONLY && !existing && !startsAfterIncrementalStart) continue;
    const key = spreadsheetEventKey(eventRecord);
    if (!eventMap.has(key)) {
      eventMap.set(key, existing ? mergeSpreadsheetEventRecord(existing, eventRecord) : {
        id: Util.nextId('EV', [db.events, [...eventMap.values()]]),
        ...eventRecord,
        attendees: []
      });
    }
    const event = eventMap.get(key);
    if (meetingLink) {
      event.meeting_link = meetingLink;
      event.zoom_link = meetingLink;
    }
    const full = String(rowValue(row, ['attendee name', 'full name', 'learner name', 'student name', 'name']) || '').trim();
    const parts = Util.nameParts(full, email || 'attendee@event.local');
    const first_name = String(rowValue(row, ['first name', 'firstname', 'forename', 'given name']) || parts.first_name || 'Event').trim();
    const last_name = String(rowValue(row, ['last name', 'lastname', 'surname', 'family name']) || parts.last_name || 'Attendee').trim();
    if (!email && !full && !rowValue(row, ['first name', 'firstname'])) continue;
    const programme = programmeForEvent(db, event.name);
    const result = Leads.ensureLeadRecord(db, user, {
      first_name,
      last_name,
      programme_id: programme.id,
      email: email || `${numericHash(`${event.name}:${first_name}:${last_name}`)}@event.local`,
      employer: String(rowValue(row, ['employer', 'company', 'organisation', 'organization']) || '').trim(),
      phone: String(rowValue(row, ['phone', 'mobile', 'telephone']) || '').trim(),
      city: String(rowValue(row, ['city', 'town']) || '').trim(),
      stage: 'New lead',
      priority: String(rowValue(row, ['priority']) || 'P2').trim(),
      source_first_touch: 'Event',
      source_lead_capture: 'Event',
      contact_permission: String(rowValue(row, ['contact permission', 'consent', 'permission']) || 'Unknown').trim(),
      created_at: startAt
    }, {
      taskTitle: `Follow up after ${event.name}`,
      taskKind: 'Follow-up'
    });
    const lead = result.lead;
    if (lead) linkedLeads += 1;
    const attendeeId = `XL-${numericHash(`${event.id}:${email || first_name}:${last_name}`)}`;
    const attendedAt = rowValue(row, ['attended_at', 'attended at', 'checked in at', 'check in time']);
    const attended = attendedAt || truthySpreadsheetValue(rowValue(row, ['attended', 'checked in', 'check in', 'present']));
    const attendee = {
      id: attendeeId,
      attendee_id: String(rowValue(row, ['attendee id']) || '').trim(),
      attendee_dedupe_key: String(rowValue(row, ['attendee dedupe key']) || '').trim(),
      attendee_unique_key: String(rowValue(row, ['attendee unique key']) || '').trim(),
      lead_id: lead?.id || '',
      first_name: lead?.first_name || first_name,
      last_name: lead?.last_name || last_name,
      email: lead?.email || email,
      phone: String(rowValue(row, ['phone', 'mobile', 'telephone']) || lead?.phone || '').trim(),
      job_title: String(rowValue(row, ['job title', 'title', 'role']) || '').trim(),
      status: String(rowValue(row, ['status', 'attendance status']) || '').trim(),
      zoom_link: meetingLink,
      source_account: String(rowValue(row, ['source account', 'owner', 'account']) || '').trim(),
      reminder_1_day: String(rowValue(row, ['1 day before event']) || '').trim(),
      reminder_2_hours: String(rowValue(row, ['2 hours before event']) || '').trim(),
      attended_at: attendedAt ? spreadsheetDateValue(attendedAt) : attended ? new Date().toISOString() : null
    };
    const existingAttendee = (event.attendees || []).find(item => Emails.normalizeEmail(item.email) === Emails.normalizeEmail(attendee.email) || item.id === attendee.id);
    if (existingAttendee) Object.assign(existingAttendee, attendee);
    else {
      event.attendees ||= [];
      event.attendees.push(attendee);
      importedAttendees += 1;
    }
  }

  let importedEvents = 0;
  for (const event of eventMap.values()) {
    event.registrations = (event.attendees || []).length;
    event.attendance = (event.attendees || []).filter(item => item.attended_at).length;
    if (!event.capacity || event.capacity < event.registrations) event.capacity = event.registrations;
    if (!db.events.some(item => item.id === event.id)) {
      db.events.push(event);
      importedEvents += 1;
    }
  }
  if (!eventMap.size && Config.EVENTS_INCREMENTAL_ONLY) return { imported_events: 0, updated_events: 0, imported_attendees: 0, linked_leads: 0, skipped_old: true };
  if (!eventMap.size) throw Http.statusError(400, 'No event rows were found. Include at least attendee name or email.');
  const reconciliation = Workspace.reconcileImportedData(db, user);
  Audit.addAudit(db, user, 'Events imported from Excel', 'integration', 'Excel', `${eventMap.size} events, ${importedAttendees} attendees, ${linkedLeads} linked leads`);
  return { imported_events: importedEvents, updated_events: eventMap.size - importedEvents, imported_attendees: importedAttendees, linked_leads: linkedLeads + reconciliation.attendees_linked, reconciliation };
}

exports.importEventRows = importEventRows;
exports.saveEventImportTables = saveEventImportTables;
exports.numericHash = numericHash;
exports.eventSourceName = eventSourceName;
exports.leadInputFromAttendee = leadInputFromAttendee;
exports.loadEventDetailDb = loadEventDetailDb;
exports.loadEventPeoplePage = loadEventPeoplePage;
exports.loadEventPage = loadEventPage;
exports.loadMarketingSummary = loadMarketingSummary;
exports.checkInAttendeeFastDb = checkInAttendeeFastDb;
exports.runEventAutoSync = runEventAutoSync;
exports.programmeForEvent = programmeForEvent;
exports.eventVenue = eventVenue;
exports.leadFromAttendee = leadFromAttendee;
exports.findSpreadsheetEvent = findSpreadsheetEvent;
exports.mergeEventAttendees = mergeEventAttendees;
exports.importSpreadsheetEvents = importSpreadsheetEvents;
