'use strict';

const crypto = require('node:crypto');
const Config = require('./config');
const State = require('./state');
const Util = require('./util');
const Http = require('./http');
const Perf = require('./perf');
const Storage = require('./storage');
const Workspace = require('./workspace');
const Audit = require('./audit');
const Programmes = require('./programmes');
const Emails = require('./emails');
const Applications = require('./applications');
const Bootstrap = require('./bootstrap');
const Zoom = require('./integrations/zoom');

let identityCleanupRunning = false;
function refreshLeadSoftDelete(trace = null, { force = false } = {}) {
  if (!State.postgresPool) return State.leadSoftDelete.enabled;
  if (Config.LEAD_SOFT_DELETE_CONFIG === 'false') return false;
  if (!force && String(process.env.SKIP_SCHEMA_SETUP || '').toLowerCase() === 'true') return State.leadSoftDelete.enabled;
  if (!force && State.leadSoftDelete.checkedAt) return State.leadSoftDelete.enabled;
  State.leadSoftDelete.pending ||= Storage.tracedPostgresPoolQuery(trace, 'storage_lead_soft_delete_column',
    `select exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'app_leads' and column_name = 'deleted_at') as enabled`
  ).then(result => {
    State.leadSoftDelete = { enabled: Boolean(result.rows?.[0]?.enabled), checkedAt: Date.now(), pending: null };
    return State.leadSoftDelete.enabled;
  }).catch(() => {
    State.leadSoftDelete = { ...State.leadSoftDelete, checkedAt: Date.now(), pending: null };
    return State.leadSoftDelete.enabled;
  });
  return State.leadSoftDelete.pending;
}

function activeLeadCondition(alias = '') {
  return State.leadSoftDelete.enabled ? `${alias ? `${alias}.` : ''}deleted_at is null` : 'true';
}

function importLeadRows(db) {
  return (db.leads || []).map(item => ({
    id: item.id,
    person_id: item.person_id || null,
    first_name: item.first_name || null,
    last_name: item.last_name || null,
    email: Emails.normalizeEmail(item.email),
    employer: item.employer || null,
    phone: item.phone || null,
    city: item.city || null,
    programme_id: item.programme_id || null,
    programme: item.programme || null,
    level: item.level || null,
    owner_id: item.owner_id || null,
    owner: item.owner || null,
    stage: item.stage || null,
    priority: item.priority || null,
    source_first_touch: item.source_first_touch || null,
    source_lead_capture: item.source_lead_capture || null,
    contact_permission: item.contact_permission || null,
    created_at: item.created_at || null,
    next_action_at: item.next_action_at || null,
    data: item
  }));
}

function isExcludedLeadSender(email, firstName = '', lastName = '') {
  const address = Emails.normalizeEmail(email);
  const name = `${firstName} ${lastName}`.trim().toLowerCase();
  return address.startsWith('alice@') || address.includes('alicepearce@') || /\balice\b/.test(name);
}

function addLeadSource(lead, source, detail = {}) {
  if (!source) return;
  lead.source_history ||= [];
  if (!lead.source_history.some(item => item.source === source && item.provider_id === detail.provider_id)) {
    lead.source_history.push({ source, provider_id: detail.provider_id || '', captured_at: detail.captured_at || new Date().toISOString(), ...detail });
  }
}

function mergeLeadData(target, incoming) {
  if (incoming.programme_id && (!target.programme_id || (Programmes.isPlaceholderProgramme(target) && !Programmes.isPlaceholderProgramme(incoming)))) {
    target.programme_id = incoming.programme_id;
    target.programme = incoming.programme;
    target.level = incoming.level;
  }
  for (const key of ['first_name', 'last_name', 'email', 'employer', 'phone', 'city', 'owner_id', 'owner', 'priority', 'contact_permission']) {
    if (!target[key] && incoming[key]) target[key] = incoming[key];
  }
  for (const key of ['eventbrite_attendee_id', 'meta_lead_id', 'meta_form_id', 'meta_form_name', 'apollo_person_id', 'zoho_record_id', 'zoho_module']) {
    if (incoming[key] && !target[key]) target[key] = incoming[key];
  }
  if (incoming.created_at && (!target.created_at || new Date(incoming.created_at) < new Date(target.created_at))) {
    target.created_at = incoming.created_at;
    target.source_first_touch = incoming.source_first_touch || target.source_first_touch;
  }
  if (incoming.source_lead_capture) target.source_lead_capture = incoming.source_lead_capture;
  addLeadSource(target, incoming.source_lead_capture || incoming.source_first_touch, {
    provider_id: incoming.gmail_message_id || incoming.eventbrite_attendee_id || incoming.meta_lead_id || incoming.apollo_person_id || incoming.zoho_record_id || '',
    captured_at: incoming.created_at
  });
  target.full_name = Util.fullName(target);
  return target;
}

function findMatchingLead(db, incoming) {
  const email = Emails.normalizeEmail(incoming.email);
  if (incoming.id) {
    const byId = db.leads.find(item => item.id === incoming.id);
    if (byId) return byId;
  }
  if (incoming.meta_lead_id) {
    const byMeta = db.leads.find(item => item.meta_lead_id === incoming.meta_lead_id);
    if (byMeta) return byMeta;
  }
  if (incoming.eventbrite_attendee_id) {
    const byEventbrite = db.leads.find(item => item.eventbrite_attendee_id === incoming.eventbrite_attendee_id);
    if (byEventbrite) return byEventbrite;
  }
  if (incoming.apollo_person_id) {
    const byApollo = db.leads.find(item => item.apollo_person_id === incoming.apollo_person_id);
    if (byApollo) return byApollo;
  }
  if (incoming.zoho_record_id) {
    const byZoho = db.leads.find(item => item.zoho_record_id === incoming.zoho_record_id);
    if (byZoho) return byZoho;
  }
  if (email) return db.leads.find(item => Emails.normalizeEmail(item.email) === email) || null;
  return null;
}

function ensureLeadRecord(db, user, incoming, options = {}) {
  const email = Emails.normalizeEmail(incoming.email);
  if (isExcludedLeadSender(email, incoming.first_name, incoming.last_name)) return { lead: null, created: false, excluded: true };
  const programme = Programmes.programmeById(db, incoming.programme_id) || Programmes.programmeForText(db, [incoming.programme, incoming.level, incoming.programme_text].filter(Boolean).join(' '));
  const owner = db.users.find(item => item.id === incoming.owner_id) || user || db.users[0];
  const normalized = {
    id: incoming.id,
    first_name: incoming.first_name || Util.nameParts('', email).first_name,
    last_name: incoming.last_name || Util.nameParts('', email).last_name,
    full_name: `${incoming.first_name || Util.nameParts('', email).first_name} ${incoming.last_name || Util.nameParts('', email).last_name}`,
    programme: programme?.name || incoming.programme || 'Programme not identified',
    programme_id: programme?.id || incoming.programme_id || 'pr-unknown',
    email,
    employer: incoming.employer || '',
    phone: incoming.phone || '',
    city: incoming.city || '',
    owner: owner?.name || incoming.owner || 'Sales',
    owner_id: owner?.id || incoming.owner_id || 'local-user',
    stage: incoming.stage || 'New lead',
    priority: incoming.priority || 'P2',
    source_first_touch: incoming.source_first_touch || incoming.source_lead_capture || 'Email',
    source_lead_capture: incoming.source_lead_capture || incoming.source_first_touch || 'Email',
    contact_permission: incoming.contact_permission || 'Unknown',
    level: programme?.level || incoming.level || 'Needs review',
    person_id: incoming.person_id,
    created_at: incoming.created_at || new Date().toISOString(),
    next_action_at: incoming.next_action_at || null,
    eventbrite_attendee_id: incoming.eventbrite_attendee_id,
    meta_lead_id: incoming.meta_lead_id,
    meta_form_id: incoming.meta_form_id,
    meta_form_name: incoming.meta_form_name,
    apollo_person_id: incoming.apollo_person_id,
    zoho_record_id: incoming.zoho_record_id,
    zoho_module: incoming.zoho_module,
    gmail_message_id: incoming.gmail_message_id
  };
  const existing = findMatchingLead(db, normalized);
  if (existing) return { lead: mergeLeadData(existing, normalized), created: false, excluded: false };
  const id = Emails.leadIdForEmail(db, email);
  const lead = {
    ...normalized,
    id,
    person_id: id
  };
  addLeadSource(lead, lead.source_lead_capture, {
    provider_id: lead.gmail_message_id || lead.eventbrite_attendee_id || lead.meta_lead_id || lead.apollo_person_id || lead.zoho_record_id || '',
    captured_at: lead.created_at
  });
  delete lead.gmail_message_id;
  db.leads.push(lead);
  if (options.taskTitle && !db.tasks.some(task => task.lead_id === lead.id && task.title === options.taskTitle && task.status === 'Open')) {
    db.tasks.push({
      id: Util.nextId('T', [db.tasks]),
      title: options.taskTitle,
      lead_id: lead.id,
      kind: options.taskKind || 'Follow-up',
      status: 'Open',
      created_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 86400000).toISOString(),
      priority: lead.priority,
      owner_id: lead.owner_id
    });
  }
  return { lead, created: true, excluded: false };
}

function relinkLeadReferences(db, fromId, toId) {
  for (const collection of [db.tasks || [], db.emails || [], db.applications || []]) {
    collection.forEach(item => {
      if (item.lead_id === fromId) item.lead_id = toId;
    });
  }
  for (const event of db.events || []) {
    (event.attendees || []).forEach(attendee => {
      if (attendee.lead_id === fromId) attendee.lead_id = toId;
    });
  }
  for (const item of db.audit || []) {
    if (item.entity === 'lead' && item.entity_id === fromId) item.entity_id = toId;
  }
  for (const item of db.attribution || []) {
    if (item.id === fromId) item.id = toId;
    if (item.lead_id === fromId) item.lead_id = toId;
  }
}

function cleanupExcludedLeads(db) {
  const excludedIds = new Set();
  db.leads = (db.leads || []).filter(lead => {
    const excluded = isExcludedLeadSender(lead.email, lead.first_name, lead.last_name);
    if (excluded) excludedIds.add(lead.id);
    return !excluded;
  });
  if (!excludedIds.size) return 0;
  for (const email of db.emails || []) {
    if (excludedIds.has(email.lead_id)) email.lead_id = '';
  }
  for (const event of db.events || []) {
    (event.attendees || []).forEach(attendee => {
      if (excludedIds.has(attendee.lead_id)) attendee.lead_id = '';
    });
  }
  db.tasks = (db.tasks || []).filter(task => !excludedIds.has(task.lead_id));
  db.applications = (db.applications || []).filter(app => !excludedIds.has(app.lead_id));
  db.attribution = (db.attribution || []).filter(item => !excludedIds.has(item.id) && !excludedIds.has(item.lead_id));
  return excludedIds.size;
}

function dedupeLeadRecords(db, user) {
  const removedExcluded = cleanupExcludedLeads(db);
  const byEmail = new Map();
  const duplicates = new Set();
  let migrated = 0;
  let merged = 0;
  for (const lead of db.leads || []) {
    const email = Emails.normalizeEmail(lead.email);
    const identity = email || `${lead.id || lead.person_id || Util.fullName(lead)}@lead.local`;
    const id = Emails.leadIdForEmail(db, identity, lead);
    if (lead.id !== id) {
      if (lead.id) relinkLeadReferences(db, lead.id, id);
      lead.id = id;
      migrated += 1;
    }
    if (lead.person_id !== id) {
      lead.person_id = id;
      migrated += 1;
    }
    if (!email) {
      lead.full_name = Util.fullName(lead);
      continue;
    }
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, lead);
      continue;
    }
    mergeLeadData(existing, lead);
    relinkLeadReferences(db, lead.id, existing.id);
    duplicates.add(lead);
    merged += 1;
  }
  if (duplicates.size) db.leads = db.leads.filter(lead => !duplicates.has(lead));
  for (const email of db.emails || []) {
    if (email.lead_id && db.leads.some(lead => lead.id === email.lead_id)) continue;
    const lead = db.leads.find(item => Emails.normalizeEmail(item.email) === Emails.normalizeEmail(email.email));
    if (lead && !isExcludedLeadSender(email.email, email.first_name, email.last_name)) email.lead_id = lead.id;
  }
  if (removedExcluded || merged || migrated) Audit.addAudit(db, user, 'Lead identity cleanup', 'lead', 'dedupe', `${merged} duplicate lead${merged === 1 ? '' : 's'} merged, ${migrated} ID field${migrated === 1 ? '' : 's'} migrated, ${removedExcluded} excluded`);
  return { merged, migrated, removed_excluded: removedExcluded };
}

function validLeadIdSet(db) {
  return new Set((db.leads || []).map(lead => lead.id).filter(Boolean));
}

function leadByContact(db, { email = '', phone = '' } = {}) {
  const normalizedEmail = Emails.normalizeEmail(email);
  if (normalizedEmail) {
    const byEmail = (db.leads || []).find(lead => Emails.normalizeEmail(lead.email) === normalizedEmail);
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = (db.leads || []).find(lead => Zoom.samePhone(lead.phone, phone));
    if (byPhone) return byPhone;
  }
  return null;
}

function scheduleIdentityCleanup(db, user) {
  if (identityCleanupRunning) return;
  identityCleanupRunning = true;
  const snapshot = Storage.cloneDb(db);
  const actor = user ? { ...user } : null;
  setImmediate(async () => {
    try {
      const promoted = Emails.promoteEmailSendersToLeads(snapshot, actor);
      const reconciled = Workspace.reconcileImportedData(snapshot, actor, { audit: false });
      const deduped = dedupeLeadRecords(snapshot, actor);
      if (promoted.created || promoted.linked || reconciled.leads_created || reconciled.emails_linked || reconciled.attendees_linked || reconciled.calls_linked || deduped.merged || deduped.migrated || deduped.removed_excluded) await Storage.saveDb(snapshot);
    } catch (error) {
      console.error(`Lead identity cleanup failed: ${error.message}`);
    } finally {
      identityCleanupRunning = false;
    }
  });
}

function runIdentityCleanupInMemory(db, user) {
  // A bootstrap payload only contains the first page of every table. Writing it back
  // would delete every record outside that page, so partial workspaces are never saved.
  if (db && (db.__partial || db.__partial_load)) return false;
  const promoted = Emails.promoteEmailSendersToLeads(db, user);
  const reconciled = Workspace.reconcileImportedData(db, user, { audit: false });
  const deduped = dedupeLeadRecords(db, user);
  const changed = Boolean(promoted.created || promoted.linked || reconciled.leads_created || reconciled.emails_linked || reconciled.attendees_linked || reconciled.calls_linked || deduped.merged || deduped.migrated || deduped.removed_excluded);
  if (changed) {
    State.dbCache = Storage.cloneDb(Workspace.recalculate(db));
    scheduleIdentityCleanup(db, user);
  }
  return changed;
}

function filterLocalLeads(leads = [], filters = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  return leads.filter(lead => {
    if (filters.stage && String(lead.stage || '') !== filters.stage) return false;
    if (filters.owner_id && String(lead.owner_id || '') !== filters.owner_id) return false;
    if (filters.programme_id && String(lead.programme_id || '') !== filters.programme_id) return false;
    if (search) {
      const haystack = [
        lead.first_name,
        lead.last_name,
        lead.full_name,
        lead.email,
        lead.phone,
        lead.employer,
        lead.programme,
        lead.stage,
        lead.owner
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

const LEAD_PAGE_DEFAULT_LIMIT = 100;
const LEAD_PAGE_MAX_LIMIT = 200;

// Sorts the Leads list accepts. Column names cannot be bound as $n parameters, so only
// these fixed expressions ever reach the SQL text. created_at DESC, id DESC is served by
// idx_app_leads_cursor. app_leads has no updated_at or last-activity column to sort on.
const LEAD_SORTS = {
  created_at: { sql: 'created_at', cast: 'timestamptz' },
  name: { sql: `lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))`, cast: 'text' }
};

// Only what the Leads table and board render. The full record (notes, source history
// details, integration payloads) comes from GET /api/leads/:id.
const LEAD_LIST_COLUMNS = `
  id, person_id, first_name, last_name, email, employer, phone, city,
  programme_id, programme, level, owner_id, owner, stage, priority,
  source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at,
  data->>'zoho_record_id' as zoho_record_id,
  data->>'zoho_module' as zoho_module,
  (
    select coalesce(jsonb_agg(jsonb_build_object('source', s.source)), '[]'::jsonb)
    from (
      select distinct e->>'source' as source
      from jsonb_array_elements(case when jsonb_typeof(data->'source_history') = 'array' then data->'source_history' else '[]'::jsonb end) e
      where e->>'source' is not null
    ) s
  ) as source_history`;

function leadListRow(row) {
  const { sort_key: sortKey, ...lead } = row;
  return {
    ...lead,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    next_action_at: row.next_action_at ? new Date(row.next_action_at).toISOString() : null,
    full_name: [row.first_name, row.last_name].filter(Boolean).join(' ')
  };
}

// Cursors are opaque base64url JSON: { sort, dir, value, id }. value is the last row's
// sort key exactly as Postgres returned it as text (created_at keeps its microseconds),
// so the next page starts precisely after that row.
function encodeLeadCursor(sortKey, id, sort = 'created_at', dir = 'desc') {
  if (!id) return '';
  return Buffer.from(JSON.stringify({ sort, dir, value: sortKey ?? null, id: String(id) })).toString('base64url');
}

const LEAD_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

function decodeLeadCursor(cursor, sort = 'created_at', dir = 'desc') {
  if (!cursor) return null;
  let value;
  try {
    value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw Http.statusError(400, 'Invalid lead cursor.');
  }
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 200) {
    throw Http.statusError(400, 'Invalid lead cursor.');
  }
  // Cursors issued before sorting existed carry only { created_at, id }.
  const cursorSort = value.sort || 'created_at';
  const cursorDir = value.dir || 'desc';
  const cursorValue = value.sort ? value.value : value.created_at;
  if (cursorSort !== sort || cursorDir !== dir) throw Http.statusError(400, 'Lead cursor does not match the requested sort.');
  if (cursorValue !== null && cursorValue !== undefined && typeof cursorValue !== 'string') throw Http.statusError(400, 'Invalid lead cursor.');
  if (sort === 'created_at' && cursorValue && !LEAD_CURSOR_TIMESTAMP.test(cursorValue)) throw Http.statusError(400, 'Invalid lead cursor.');
  if (typeof cursorValue === 'string' && cursorValue.length > 400) throw Http.statusError(400, 'Invalid lead cursor.');
  return { id: value.id, value: cursorValue ?? null };
}

function leadPageOptions(options = {}) {
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, LEAD_PAGE_MAX_LIMIT)) : LEAD_PAGE_DEFAULT_LIMIT;
  const sort = String(options.sort || 'created_at').trim();
  if (!LEAD_SORTS[sort]) throw Http.statusError(400, `Unsupported lead sort. Use one of: ${Object.keys(LEAD_SORTS).join(', ')}.`);
  const dir = String(options.dir || (sort === 'name' ? 'asc' : 'desc')).trim().toLowerCase();
  if (!['asc', 'desc'].includes(dir)) throw Http.statusError(400, 'Lead sort direction must be asc or desc.');
  const parseDate = (input, label) => {
    const text = String(input || '').trim();
    if (!text) return null;
    const time = Date.parse(text);
    if (!Number.isFinite(time)) throw Http.statusError(400, `Invalid ${label} date.`);
    return new Date(time).toISOString();
  };
  const all = value => {
    const text = String(value || '').trim();
    return /^all( \w+)?$/i.test(text) ? '' : text.slice(0, 200);
  };
  return {
    limit,
    sort,
    dir,
    cursor: decodeLeadCursor(options.cursor, sort, dir),
    includeTotal: !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase()),
    filters: {
      search: String(options.search || '').trim().slice(0, 200),
      stage: all(options.stage),
      owner_id: all(options.owner_id || options.ownerId),
      programme_id: all(options.programme_id || options.programmeId),
      lead_source: all(options.lead_source || options.source),
      created_from: parseDate(options.created_from, 'created_from'),
      created_to: parseDate(options.created_to, 'created_to')
    }
  };
}

// WHERE conditions for the filters, appended to a shared values array so the $n numbers
// always line up with whichever optional filters are present.
function leadFilterConditions(filters, values) {
  const conditions = [];
  const bind = value => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.search) {
    // Every word must match one of the searchable fields. User-typed % and _ are escaped
    // so they match literally.
    const terms = filters.search.split(/\s+/).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      const p = bind(`%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`);
      conditions.push(`(first_name ilike ${p} or last_name ilike ${p} or email ilike ${p} or phone ilike ${p} or employer ilike ${p})`);
    }
  }
  if (filters.stage) conditions.push(`stage = ${bind(filters.stage)}`);
  if (filters.owner_id) conditions.push(`owner_id = ${bind(filters.owner_id)}`);
  if (filters.programme_id) conditions.push(`programme_id = ${bind(filters.programme_id)}`);
  if (filters.lead_source) {
    const p = bind(filters.lead_source);
    conditions.push(`(source_first_touch = ${p} or source_lead_capture = ${p} or data->'source_history' @> jsonb_build_array(jsonb_build_object('source', ${p}::text)))`);
  }
  if (filters.created_from) conditions.push(`created_at >= ${bind(filters.created_from)}::timestamptz`);
  if (filters.created_to) conditions.push(`created_at < ${bind(filters.created_to)}::timestamptz`);
  return conditions;
}

// Keyset condition for "rows after the cursor" in ORDER BY <key> <dir>, id <dir>.
// Postgres puts NULLs first for DESC and last for ASC, so a NULL key is handled explicitly.
function leadCursorCondition(sortDef, dir, cursor, values) {
  const bind = value => {
    values.push(value);
    return `$${values.length}`;
  };
  const key = sortDef.sql;
  const id = bind(cursor.id);
  if (cursor.value === null) {
    return dir === 'desc'
      ? `((${key} is null and id < ${id}) or ${key} is not null)`
      : `(${key} is null and id > ${id})`;
  }
  const value = `${bind(cursor.value)}::${sortDef.cast}`;
  return dir === 'desc'
    ? `((${key}, id) < (${value}, ${id}))`
    : `((${key}, id) > (${value}, ${id}) or ${key} is null)`;
}

function buildLeadPageQuery(options = {}) {
  const { limit, sort, dir, cursor, includeTotal, filters } = leadPageOptions(options);
  const sortDef = LEAD_SORTS[sort];
  const filterValues = [];
  const filterConditions = leadFilterConditions(filters, filterValues);
  if (State.leadSoftDelete.enabled) filterConditions.push(activeLeadCondition());
  const values = filterValues.slice();
  const conditions = filterConditions.slice();
  if (cursor) conditions.push(leadCursorCondition(sortDef, dir, cursor, values));
  values.push(limit + 1);
  const filterWhere = filterConditions.length ? `where ${filterConditions.join(' and ')}` : '';
  const listSql = `
    select ${LEAD_LIST_COLUMNS}, (${sortDef.sql})::text as sort_key
    from app_leads
    ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
    order by ${sortDef.sql} ${dir}, id ${dir}
    limit $${values.length}`;
  const combinedSql = includeTotal ? `
    with
    stage_counts as (
      select coalesce(jsonb_object_agg(coalesce(stage, ''), total), '{}'::jsonb) as counts
      from (select stage, count(*)::int as total from app_leads ${filterWhere} group by stage) s
    ),
    page as (
      select ${LEAD_LIST_COLUMNS}, (${sortDef.sql})::text as sort_key, ${sortDef.sql} as sort_value
      from app_leads
      ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
      order by ${sortDef.sql} ${dir}, id ${dir}
      limit $${values.length}
    )
    select page.*, (select counts from stage_counts) as stage_counts
    from page
    order by sort_value ${dir}, id ${dir}` : listSql;
  return {
    limit,
    sort,
    dir,
    cursor,
    includeTotal,
    filters,
    label: includeTotal ? 'leads_page_with_counts' : 'leads_page',
    sql: combinedSql,
    values
  };
}

async function explainBootstrapAndLeads(options = {}) {
  await Storage.ensureStorage();
  const bootstrap = Bootstrap.bootstrapPayloadQuery();
  const leads = buildLeadPageQuery({ limit: options.limit || 100, include_total: options.include_total || 'false' });
  const [bootstrapExplain, leadsExplain] = await Promise.all([
    Storage.explainPostgresQuery(bootstrap.label, bootstrap.sql, bootstrap.values),
    Storage.explainPostgresQuery(leads.label, leads.sql, leads.values)
  ]);
  return { bootstrap: bootstrapExplain, leads: leadsExplain };
}

async function loadLeadPage(options = {}, trace = null) {
  const parsed = leadPageOptions(options);
  await Perf.perfPhase(trace, 'leads_storage', () => Storage.ensureStorage());
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    const { limit, sort, dir, cursor, filters } = parsed;
    const db = await Storage.loadDb();
    const rows = filterLocalLeads(db.leads || [], filters)
      .sort((a, b) => {
        const timeDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
        return timeDiff || String(b.id).localeCompare(String(a.id));
      });
    const cursorIndex = cursor ? rows.findIndex(item => item.id === cursor.id) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const items = rows.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < rows.length;
    const last = items[items.length - 1];
    const nextCursor = hasMore ? encodeLeadCursor(last?.created_at || null, last?.id, sort, dir) : '';
    return { items, nextCursor, hasMore, total: rows.length, stage_counts: null, limit, sort, dir };
  }
  const query = buildLeadPageQuery(options);
  const list = await Perf.perfPhase(trace, 'leads_sql', () => Storage.timedPostgresQuery(trace, query.label, query.sql, query.values));
  return Perf.perfPhase(trace, 'mapping', async () => {
    const pageRows = list.rows.slice(0, query.limit);
    const items = pageRows.map(leadListRow);
    const hasMore = list.rows.length > query.limit;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore ? encodeLeadCursor(last.sort_key, last.id, query.sort, query.dir) : '';
    const stageCounts = query.includeTotal ? (list.rows[0]?.stage_counts || {}) : null;
    const total = stageCounts ? Object.values(stageCounts).reduce((sum, value) => sum + value, 0) : null;
    return { items, nextCursor, hasMore, total, stage_counts: stageCounts, limit: query.limit, sort: query.sort, dir: query.dir };
  });
}

// Lead detail reads only this lead and the rows linked to it.
async function loadLeadDetailDb(leadId, mergedFrom = null) {
  await refreshLeadSoftDelete();
  const row = (await State.postgresPool.query(`select data${State.leadSoftDelete.enabled ? ', merged_into_id' : ''} from app_leads where id = $1`, [leadId])).rows[0];
  // A merged duplicate opens its master (old links and bookmarks keep working).
  if (row?.merged_into_id && !mergedFrom) return { ...(await loadLeadDetailDb(row.merged_into_id, leadId)), merged_from: leadId };
  const lead = row?.data;
  if (!lead) throw Http.statusError(404, 'Lead not found.');
  const [tasks, emails, applications, audit] = await Promise.all([
    State.postgresPool.query(`select data from app_tasks where lead_id = $1 order by coalesce(completed_at, due_at) desc nulls last limit 200`, [leadId]),
    State.postgresPool.query(
      `select jsonb_build_object(
         'lead_id', lead_id, 'subject', data->'subject', 'received_at', received_at, 'owner', data->'owner',
         'direction', data->'direction', 'response_at', response_at, 'gmail_labels', data->'gmail_labels',
         'dashboard_folder', data->'dashboard_folder', 'trashed_at', data->'trashed_at'
       ) as data
       from app_emails where lead_id = $1 order by received_at desc nulls last limit 200`,
      [leadId]
    ),
    State.postgresPool.query(`select data from app_applications where lead_id = $1`, [leadId]),
    State.postgresPool.query(`select data from app_audit where entity_id = $1 order by occurred_at desc nulls last limit 200`, [leadId])
  ]);
  const related = {
    tasks: tasks.rows.map(row => row.data).filter(Boolean),
    emails: emails.rows.map(row => row.data).filter(Boolean),
    applications: applications.rows.map(row => row.data).filter(Boolean),
    audit: audit.rows.map(row => row.data).filter(Boolean)
  };
  return { lead, timeline: timeline(related, lead), tasks: related.tasks };
}

function leadIdentityKey(lead) {
  return String(lead?.zoho_record_id || lead?.crm_lead_id || lead?.id || '').trim().toLowerCase();
}

function uniqueLeadsByIdentity(leads = []) {
  const seen = new Set();
  return leads.filter(lead => {
    const key = leadIdentityKey(lead);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function updateLeadFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_leads where id = $1 for update`, [id]);
    const lead = result.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    if (body.stage !== undefined) lead.stage = body.stage;
    if (body.owner_id !== undefined) lead.owner_id = body.owner_id;
    if (body.priority !== undefined) lead.priority = body.priority;
    await client.query(
      `update app_leads set stage = $2, owner_id = $3, priority = $4, data = $5::jsonb where id = $1`,
      [lead.id, lead.stage || null, lead.owner_id || null, lead.priority || null, Applications.jsonValue(lead)]
    );
    const automaticApplication = await Applications.ensureApplicationForLeadFastDb(client, lead, user, {
      auditAction: 'Application auto-created for lead'
    });
    await Audit.appendAuditFast(client, user, 'Opportunity updated', 'lead', lead.id, body.reason);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, lead, application: automaticApplication ? Applications.publicApplication(automaticApplication.application) : null, attribution: automaticApplication?.attribution || null };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function addLeadNoteFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select id from app_leads where id = $1 limit 1`, [id]);
    if (!result.rows[0]) throw Http.statusError(404, 'Lead not found.');
    const audit = await Audit.appendAuditFast(client, user, 'Note added', 'lead', id, body.note);
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, audit };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function createLeadFastDb(body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const programmeResult = await client.query(`select data from app_programmes where id = $1 limit 1`, [body.programme_id]);
    const programme = programmeResult.rows[0]?.data;
    if (!programme) throw Http.statusError(400, 'Choose a programme.');
    const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    const ownerResult = body.owner_id
      ? await client.query(`select id, name, email, role from ${usersTable} where id = $1 limit 1`, [body.owner_id])
      : { rows: [] };
    const owner = ownerResult.rows[0] || user;
    const email = Emails.normalizeEmail(body.email);
    if (isExcludedLeadSender(email, body.first_name, body.last_name)) throw Http.statusError(400, 'This sender is excluded from lead creation.');
    const existingResult = email
      ? await client.query(`select data from app_leads where lower(email) = $1 and ${activeLeadCondition()} limit 1 for update`, [email])
      : { rows: [] };
    const now = new Date().toISOString();
    const normalized = {
      first_name: body.first_name || Util.nameParts('', email).first_name,
      last_name: body.last_name || Util.nameParts('', email).last_name,
      full_name: `${body.first_name || Util.nameParts('', email).first_name} ${body.last_name || Util.nameParts('', email).last_name}`,
      programme: programme.name,
      programme_id: programme.id,
      email,
      employer: body.employer || '',
      phone: body.phone || '',
      city: body.city || '',
      owner: owner?.name || user.name,
      owner_id: owner?.id || user.id,
      stage: 'New lead',
      priority: body.priority || 'P2',
      source_first_touch: body.source || 'Manual',
      source_lead_capture: body.source || 'Manual',
      contact_permission: body.contact_permission || 'Unknown',
      level: programme.level || 'Needs review',
      created_at: now,
      next_action_at: null
    };
    let lead = existingResult.rows[0]?.data || null;
    const created = !lead;
    if (lead) {
      lead = mergeLeadData(lead, normalized);
    } else {
      const id = Emails.leadIdForEmail({ leads: [] }, email || `${body.first_name}-${body.last_name}-${Date.now()}`);
      lead = { ...normalized, id, person_id: id };
      addLeadSource(lead, lead.source_lead_capture, { provider_id: '', captured_at: lead.created_at });
    }
    await client.query(
      `insert into app_leads (id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::timestamptz, $20::timestamptz, $21::jsonb)
       on conflict (id) do update set
         person_id = excluded.person_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
         employer = excluded.employer, phone = excluded.phone, city = excluded.city, programme_id = excluded.programme_id,
         programme = excluded.programme, level = excluded.level, owner_id = excluded.owner_id, owner = excluded.owner,
         stage = excluded.stage, priority = excluded.priority, source_first_touch = excluded.source_first_touch,
         source_lead_capture = excluded.source_lead_capture, contact_permission = excluded.contact_permission,
         created_at = excluded.created_at, next_action_at = excluded.next_action_at, data = excluded.data`,
      [lead.id, lead.person_id || lead.id, lead.first_name, lead.last_name, lead.email, lead.employer, lead.phone, lead.city, lead.programme_id, lead.programme, lead.level, lead.owner_id, lead.owner, lead.stage, lead.priority, lead.source_first_touch, lead.source_lead_capture, lead.contact_permission, lead.created_at, lead.next_action_at, Applications.jsonValue(lead)]
    );
    let task = null;
    if (created) {
      task = {
        id: `T-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        title: `First contact with ${body.first_name} ${body.last_name}`,
        lead_id: lead.id,
        kind: 'Call',
        status: 'Open',
        created_at: now,
        due_at: new Date(Date.now() + 86400000).toISOString(),
        priority: lead.priority,
        owner_id: lead.owner_id
      };
      await client.query(
        `insert into app_tasks (id, title, lead_id, kind, status, due_at, completed_at, priority, owner_id, data)
         values ($1, $2, $3, $4, $5, $6::timestamptz, null, $7, $8, $9::jsonb)`,
        [task.id, task.title, task.lead_id, task.kind, task.status, task.due_at, task.priority, task.owner_id, Applications.jsonValue(task)]
      );
    }
    const automaticApplication = await Applications.ensureApplicationForLeadFastDb(client, lead, user, {
      auditAction: created ? 'Application auto-created for new lead' : 'Application auto-created for duplicate lead'
    });
    await Audit.appendAuditFast(client, user, created ? 'Lead created' : 'Lead updated from duplicate submission', 'lead', lead.id);
    await client.query('commit');
    State.dbCache = null;
    return { id: lead.id, lead, task, created, application: automaticApplication ? Applications.publicApplication(automaticApplication.application) : null, attribution: automaticApplication?.attribution || null };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function addProgrammeOpportunityFastDb(id, body, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const leadResult = await client.query(`select data from app_leads where id = $1 for update`, [id]);
    const programmeResult = await client.query(`select data from app_programmes where id = $1 limit 1`, [body.programme_id]);
    const lead = leadResult.rows[0]?.data;
    const programme = programmeResult.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    if (!programme) throw Http.statusError(400, 'Choose a programme.');
    lead.programme_history ||= [];
    if (!lead.programme_history.some(item => item.programme_id === lead.programme_id)) {
      lead.programme_history.push({ programme_id: lead.programme_id, programme: lead.programme, level: lead.level, added_at: lead.created_at || new Date().toISOString() });
    }
    if (!lead.programme_history.some(item => item.programme_id === programme.id)) {
      lead.programme_history.push({ programme_id: programme.id, programme: programme.name, level: programme.level, added_at: new Date().toISOString() });
    }
    lead.programme_id = programme.id;
    lead.programme = programme.name;
    lead.level = programme.level;
    lead.stage = 'New lead';
    lead.next_action_at = null;
    await client.query(
      `update app_leads set programme_id = $2, programme = $3, level = $4, stage = $5, next_action_at = null, data = $6::jsonb where id = $1`,
      [lead.id, lead.programme_id, lead.programme, lead.level, lead.stage, Applications.jsonValue(lead)]
    );
    await Audit.appendAuditFast(client, user, 'Programme opportunity linked', 'lead', lead.id, programme.name);
    await client.query('commit');
    State.dbCache = null;
    return { id: lead.id, lead, created: false };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteLeadFastDb(id, user) {
  if (!State.postgresPool) return null;
  await Storage.ensureStorage();
  const client = await State.postgresPool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select data from app_leads where id = $1 for update`, [id]);
    const lead = result.rows[0]?.data;
    if (!lead) throw Http.statusError(404, 'Lead not found.');
    await client.query(`delete from app_tasks where lead_id = $1`, [id]);
    await client.query(`delete from app_emails where lead_id = $1`, [id]);
    await client.query(`delete from app_applications where lead_id = $1`, [id]);
    await client.query(`delete from app_attribution where lead_id = $1`, [id]);
    await client.query(`delete from app_leads where id = $1`, [id]);
    await Audit.appendAuditFast(client, user, 'Lead deleted', 'lead', id, Util.fullName(lead));
    await client.query('commit');
    State.dbCache = null;
    return { ok: true, deleted: { leads: [id], tasks_for_lead: id, emails_for_lead: id, applications_for_lead: id } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function leadFor(db, id) {
  const lead = db.leads.find(item => item.id === id);
  if (!lead) throw Http.statusError(404, 'Lead not found.');
  return lead;
}

function timeline(db, lead) {
  const items = [{ occurred_at: lead.created_at, source: 'Lead capture', summary: `${Util.fullName(lead)} entered the ${lead.programme} pipeline.`, actor: lead.owner, verification: 'System recorded', confidence: 1 }];
  db.tasks.filter(task => task.lead_id === lead.id).forEach(task => items.push({ occurred_at: task.completed_at || task.due_at, source: task.kind, summary: `${task.status} task: ${task.title}`, actor: lead.owner, verification: task.status === 'Done' ? 'Completed' : 'Scheduled', confidence: 0.9 }));
  db.emails.filter(email => email.lead_id === lead.id && !Emails.emailIsTrashed(email)).forEach(email => items.push({ occurred_at: email.received_at, source: 'Email', summary: email.subject, actor: email.owner, verification: email.direction === 'outbound' ? 'Sent by us' : email.response_at ? 'Responded' : 'Awaiting response', confidence: 0.92 }));
  db.applications.filter(app => app.lead_id === lead.id).forEach(app => items.push({ occurred_at: app.created_at || lead.created_at, source: 'Application', summary: `Application status: ${app.learner ? 'Enrolled' : app.status}`, actor: app.manager || lead.owner, verification: 'Human review required', confidence: 0.95 }));
  db.audit.filter(item => item.entity_id === lead.id).forEach(item => items.push({ occurred_at: item.occurred_at, source: 'Workspace', summary: item.action, actor: item.actor, verification: 'Audit trail', confidence: 1 }));
  return items.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

// One page of stored Zoho records, read straight from app_zoho_records so the UI never
// has to hold a whole module in memory.
// Zoho Contacts as a list: only the columns a list renders plus the linked lead id, never the
// raw Zoho payload. Search and paging run in PostgreSQL.
async function loadContactPage(options = {}, trace = null) {
  await Perf.perfPhase(trace, 'contacts_storage', () => Storage.ensureStorage());
  const rawLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 100;
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  const cursor = Util.decodePageCursor(options.cursor, 'contact cursor');
  const includeTotal = !options.cursor && ['1', 'true'].includes(String(options.include_total || '').toLowerCase());
  const search = String(options.search || '').trim().slice(0, 200);
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return { items: [], total: includeTotal ? 0 : null, limit, offset, hasMore: false, nextOffset: offset, next_cursor: '' };
  const params = [];
  const where = [`z.module = 'Contacts'`];
  const bind = value => { params.push(value); return `$${params.length}`; };
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, char => `\\${char}`)}%`);
    where.push(`(z.title ilike ${term} or z.email ilike ${term} or z.phone ilike ${term} or z.company ilike ${term})`);
  }
  if (cursor?.key || cursor?.id) {
    const key = String(cursor.key || cursor.id || '');
    if (cursor.modified_time) {
      const modifiedParam = bind(cursor.modified_time);
      const keyParam = bind(key);
      where.push(`(z.modified_time < ${modifiedParam}::timestamptz or (z.modified_time = ${modifiedParam}::timestamptz and z.key > ${keyParam}) or z.modified_time is null)`);
    } else {
      where.push(`(z.modified_time is null and z.key > ${bind(key)})`);
    }
  }
  const whereSql = where.join(' and ');
  const [count, rows] = await Promise.all([
    includeTotal ? Storage.timedPostgresQuery(trace, 'contacts_count', `select count(*)::int as total from app_zoho_records z where ${whereSql}`, params) : Promise.resolve(null),
    // Page first, then look up the linked lead for those rows only (indexed on the Zoho key).
    Storage.timedPostgresQuery(trace, 'contacts_page',
      `with page as materialized (
         select z.key, z.zoho_id, z.title as name, z.email, z.phone, z.company, z.owner_name, z.status, z.created_time, z.modified_time
         from app_zoho_records z where ${whereSql}
         order by z.modified_time desc nulls last, z.key
         limit $${params.length + 1}
       )
       select page.*, lead.id as lead_id
       from page
       left join lateral (select l.id from app_leads l where l.data->>'zoho_record_id' = page.key and ${activeLeadCondition('l')} limit 1) lead on true
       order by page.modified_time desc nulls last, page.key`,
      [...params, limit + 1]
    )
  ]);
  return Perf.perfPhase(trace, 'mapping', async () => {
    const items = rows.rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.rows.length > limit && last?.key ? Util.encodePageCursor({ modified_time: last.modified_time || null, key: last.key }) : '';
    return {
      items,
      total: count ? Number(count.rows[0]?.total || 0) : null,
      limit,
      offset,
      hasMore: Boolean(nextCursor),
      has_more: Boolean(nextCursor),
      nextOffset: offset + items.length,
      next_offset: offset + items.length,
      nextCursor,
      next_cursor: nextCursor
    };
  });
}

exports.refreshLeadSoftDelete = refreshLeadSoftDelete;
exports.activeLeadCondition = activeLeadCondition;
exports.importLeadRows = importLeadRows;
exports.isExcludedLeadSender = isExcludedLeadSender;
exports.addLeadSource = addLeadSource;
exports.mergeLeadData = mergeLeadData;
exports.ensureLeadRecord = ensureLeadRecord;
exports.dedupeLeadRecords = dedupeLeadRecords;
exports.validLeadIdSet = validLeadIdSet;
exports.leadByContact = leadByContact;
exports.buildLeadPageQuery = buildLeadPageQuery;
exports.explainBootstrapAndLeads = explainBootstrapAndLeads;
exports.loadLeadPage = loadLeadPage;
exports.loadLeadDetailDb = loadLeadDetailDb;
exports.uniqueLeadsByIdentity = uniqueLeadsByIdentity;
exports.updateLeadFastDb = updateLeadFastDb;
exports.addLeadNoteFastDb = addLeadNoteFastDb;
exports.createLeadFastDb = createLeadFastDb;
exports.addProgrammeOpportunityFastDb = addProgrammeOpportunityFastDb;
exports.deleteLeadFastDb = deleteLeadFastDb;
exports.leadFor = leadFor;
exports.timeline = timeline;
exports.loadContactPage = loadContactPage;
