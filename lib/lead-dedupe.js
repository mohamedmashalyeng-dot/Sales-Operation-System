'use strict';
// Lead de-duplication: detection, classification, deterministic master selection, dry-run
// merge plans and the transactional merge. Discovery and counting run in PostgreSQL and only
// one small group of leads is ever held in Node. Nothing here uses loadDb/saveDb.
//
// Identity rules (see DATABASE_CLEANUP_STEP3.md):
//   HIGH    same external id: Zoho key ("Module:id"), Eventbrite attendee, Meta lead, Apollo person
//   STRONG  same normalized email (lower(trim(email))), synthetic "*.local" addresses excluded
//   WEAK    same full name plus the same phone digits, or plus the same email local part
//   NONE    same full name only
// Only HIGH groups without conflicts are AUTO_MERGE_SAFE. STRONG and WEAK groups need review.

// Every place a lead id is stored. There are no foreign keys to app_leads, so this list comes
// from the live schema and from the code (relinkLeadReferences, event and Zoom call links).
const LEAD_REFERENCE_TABLES = [
  { key: 'tasks', table: 'app_tasks', column: 'lead_id', dataKey: 'lead_id' },
  { key: 'emails', table: 'app_emails', column: 'lead_id', dataKey: 'lead_id' },
  { key: 'applications', table: 'app_applications', column: 'lead_id', dataKey: 'lead_id' },
  { key: 'attribution', table: 'app_attribution', column: 'lead_id', dataKey: 'lead_id' },
  { key: 'marketing_recipients', table: 'app_marketing_recipients', column: 'lead_id', dataKey: 'lead_id' },
  { key: 'audit', table: 'app_audit', column: 'entity_id', dataKey: 'entity_id', where: `entity = 'lead'` }
];
// Lead ids inside JSON arrays: event attendees (column and data copy) and cached Zoom calls.
const LEAD_REFERENCE_JSON = [
  { key: 'meetings', table: 'app_events', column: 'attendees', description: 'app_events.attendees[].lead_id (and data.attendees)' },
  { key: 'zoom_calls', table: 'app_workspace', column: 'meta', path: ['zoom', 'calls'], description: "app_workspace.meta.zoom.calls[].lead_id" }
];

const EXTERNAL_RULES = ['zoho', 'eventbrite', 'meta', 'apollo'];
const RULE_CONFIDENCE = { zoho: 'HIGH', eventbrite: 'HIGH', meta: 'HIGH', apollo: 'HIGH', email: 'STRONG', name_phone: 'WEAK', name_email_local: 'WEAK', name_only: 'NONE' };
// External ids whose different values on one person mean two different records. Eventbrite is
// not listed: one person has one attendee id per event registration.
const CONFLICTING_EXTERNAL_FIELDS = ['zoho_record_id', 'meta_lead_id', 'apollo_person_id'];
const EXTERNAL_ID_FIELDS = [
  { field: 'zoho_record_id', provider: 'zoho', moduleField: 'zoho_module' },
  { field: 'eventbrite_attendee_id', provider: 'eventbrite' },
  { field: 'meta_lead_id', provider: 'meta' },
  { field: 'apollo_person_id', provider: 'apollo' }
];

// Profile fields merged into the master (columns on app_leads and keys in data).
const MERGE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'employer', 'city', 'programme_id', 'owner_id', 'stage', 'priority', 'contact_permission'];
// Values that mean "not set" for a field.
const PLACEHOLDERS = { programme_id: ['pr-unknown'], owner_id: ['system', 'local-user'], contact_permission: ['unknown'] };
// Fields copied together with their companion columns.
const COMPANIONS = { programme_id: ['programme', 'level'], owner_id: ['owner'] };
const LEAD_COLUMNS = ['person_id', 'first_name', 'last_name', 'email', 'employer', 'phone', 'city', 'programme_id', 'programme', 'level', 'owner_id', 'owner', 'stage', 'priority', 'source_first_touch', 'source_lead_capture', 'contact_permission', 'created_at', 'next_action_at'];

const NAME_SQL = `case when coalesce(trim(first_name), '') <> '' and coalesce(trim(last_name), '') <> ''
  then lower(regexp_replace(trim(first_name) || ' ' || trim(last_name), '\\s+', ' ', 'g')) end`;
// Placeholder names that must never be used as evidence.
const JUNK_NAME_SQL = `(name_norm ~ '^(unknown|test|none|n/?a|null)( |$)' or name_norm ~ '(sender|postmaster|no ?reply|mailer|daemon|admin)' or length(replace(name_norm, ' ', '')) < 4)`;

function activeLeadSql(softDelete, alias = '') {
  return softDelete ? `${alias ? `${alias}.` : ''}deleted_at is null` : 'true';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function numericHash(value, attempt = 0) {
  const input = `${String(value || '').trim().toLowerCase()}#${attempt}`;
  const hex = require('crypto').createHash('sha256').update(input).digest('hex').slice(0, 15);
  return String((BigInt(`0x${hex}`) % 900000000000n) + 100000000000n);
}

function emailLeadId(email, attempt = 0) {
  return numericHash(normalizeEmail(email), attempt);
}

// True once sql/2026-09-30_lead_dedupe.sql has been applied.
async function mergeSchemaReady(db) {
  const result = await db.query(`
    select
      exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'app_leads' and column_name = 'deleted_at') as deleted_at,
      exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'app_leads' and column_name = 'merged_into_id') as merged_into_id,
      to_regclass('app_lead_merge_audit') is not null as audit,
      to_regclass('app_lead_external_ids') is not null as external_ids
  `);
  const row = result.rows[0] || {};
  return Boolean(row.deleted_at && row.merged_into_id && row.audit && row.external_ids);
}

// Duplicate groups for every rule, computed in PostgreSQL. Each group lists its members with
// the identifiers needed to classify it; no profile data is returned.
async function findDuplicateGroups(db, options = {}) {
  const softDelete = options.softDelete ?? await mergeSchemaReady(db);
  const rules = options.rules || Object.keys(RULE_CONFIDENCE);
  const result = await db.query(`
    with base as (
      select id,
        nullif(lower(trim(email)), '') as email_norm,
        nullif(data->>'zoho_record_id', '') as zoho_key,
        nullif(data->>'eventbrite_attendee_id', '') as eventbrite_id,
        nullif(data->>'meta_lead_id', '') as meta_id,
        nullif(data->>'apollo_person_id', '') as apollo_id,
        ${NAME_SQL} as name_norm,
        nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '') as phone_digits
      from app_leads
      where ${activeLeadSql(softDelete)}
    ),
    flags as (
      select *, coalesce(email_norm like '%.local', false) as email_synthetic, coalesce(${JUNK_NAME_SQL}, false) as name_junk
      from base
    ),
    keys as (
      select 'zoho' as rule, zoho_key as match_key, id from flags where zoho_key is not null
      union all select 'eventbrite', eventbrite_id, id from flags where eventbrite_id is not null
      union all select 'meta', meta_id, id from flags where meta_id is not null
      union all select 'apollo', apollo_id, id from flags where apollo_id is not null
      union all select 'email', email_norm, id from flags where email_norm is not null and not email_synthetic
      union all select 'name_phone', name_norm || '|' || phone_digits, id from flags where name_norm is not null and not name_junk and length(phone_digits) >= 7
      union all select 'name_email_local', name_norm || '|' || split_part(email_norm, '@', 1), id from flags where name_norm is not null and not name_junk and email_norm is not null and not email_synthetic
      union all select 'name_only', name_norm, id from flags where name_norm is not null
    )
    select k.rule,
      substr(md5(k.rule || ':' || k.match_key), 1, 12) as group_key,
      count(*)::int as size,
      count(distinct f.email_norm)::int as distinct_emails,
      bool_or(f.name_junk) as name_junk,
      jsonb_agg(jsonb_build_object(
        'id', f.id, 'email', f.email_norm, 'synthetic', f.email_synthetic, 'zoho_record_id', f.zoho_key,
        'eventbrite_attendee_id', f.eventbrite_id, 'meta_lead_id', f.meta_id, 'apollo_person_id', f.apollo_id
      ) order by f.id) as members
    from keys k
    join flags f on f.id = k.id
    where k.rule = any($1::text[])
    group by k.rule, k.match_key
    having count(*) > 1
      and (k.rule not in ('name_phone', 'name_email_local', 'name_only') or count(distinct f.email_norm) > 1)
    order by k.rule, group_key
  `, [rules]);
  return result.rows.map(row => ({ ...row, confidence: RULE_CONFIDENCE[row.rule], ...classifyGroup(row) }));
}

function distinctValues(members, field) {
  return [...new Set(members.map(member => member[field]).filter(Boolean))];
}

// AUTO_MERGE_SAFE only for an external-id match whose members agree on email and carry no
// other conflicting external id. Everything based on email, phone or name is reviewed by a
// person; name-only matches are never merged.
function classifyGroup(group) {
  const members = group.members || [];
  const realEmails = [...new Set(members.filter(member => member.email && !member.synthetic).map(member => member.email))];
  const conflicts = CONFLICTING_EXTERNAL_FIELDS
    .map(field => ({ field, values: distinctValues(members, field) }))
    .filter(item => item.values.length > 1);
  const reasons = [];
  let classification;
  // A placeholder name only disqualifies name-based evidence; ids and emails do not depend on it.
  if (group.rule === 'name_only' || (group.rule.startsWith('name_') && group.name_junk)) {
    classification = 'DO_NOT_MERGE';
    reasons.push(group.name_junk ? 'placeholder name' : 'name match only');
  } else if (EXTERNAL_RULES.includes(group.rule)) {
    if (realEmails.length > 1) reasons.push('members have different email addresses');
    for (const conflict of conflicts) reasons.push(`members carry ${conflict.values.length} different ${conflict.field} values`);
    classification = reasons.length ? 'REVIEW_REQUIRED' : 'AUTO_MERGE_SAFE';
    if (!reasons.length) reasons.push(`same ${group.rule} identifier`);
  } else {
    classification = 'REVIEW_REQUIRED';
    reasons.push(group.rule === 'email' ? 'same email address only' : group.rule === 'name_phone' ? 'same name and phone' : 'same name and email local part');
    for (const conflict of conflicts) reasons.push(`members carry ${conflict.values.length} different ${conflict.field} values`);
  }
  return { classification, reasons, conflicting_external_ids: conflicts };
}

// Related-record counts per lead, one aggregate per table.
async function relationCounts(db, ids) {
  const counts = new Map(ids.map(id => [id, Object.fromEntries([...LEAD_REFERENCE_TABLES, ...LEAD_REFERENCE_JSON].map(ref => [ref.key, 0]))]));
  if (!ids.length) return counts;
  const add = (rows, key) => rows.forEach(row => { if (counts.has(row.id)) counts.get(row.id)[key] = Number(row.n || 0); });
  // A pool runs the counts in parallel; a single client (inside a transaction) runs them in turn.
  const run = typeof db.release !== 'function' && typeof db.totalCount === 'number' ? jobs => Promise.all(jobs.map(job => job())) : async jobs => { for (const job of jobs) await job(); };
  await run([
    ...LEAD_REFERENCE_TABLES.map(ref => async () => {
      const result = await db.query(
        `select ${ref.column} as id, count(*)::int as n from ${ref.table} where ${ref.column} = any($1::text[]) ${ref.where ? `and ${ref.where}` : ''} group by 1`,
        [ids]
      );
      add(result.rows, ref.key);
    }),
    async () => {
      const result = await db.query(
        `select a->>'lead_id' as id, count(*)::int as n
         from app_events e, jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) a
         where a->>'lead_id' = any($1::text[]) group by 1`,
        [ids]
      );
      add(result.rows, 'meetings');
    },
    async () => {
      const result = await db.query(
        `select c->>'lead_id' as id, count(*)::int as n
         from app_workspace w, jsonb_array_elements(case when jsonb_typeof(w.meta->'zoom'->'calls') = 'array' then w.meta->'zoom'->'calls' else '[]'::jsonb end) c
         where c->>'lead_id' = any($1::text[]) group by 1`,
        [ids]
      );
      add(result.rows, 'zoom_calls');
    }
  ]);
  return counts;
}

function isEmptyValue(field, value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (field === 'email' && text.toLowerCase().endsWith('.local')) return true;
  return (PLACEHOLDERS[field] || []).includes(text.toLowerCase());
}

function sameValue(field, a, b) {
  const clean = value => String(value ?? '').trim().toLowerCase();
  if (field === 'phone') return clean(a).replace(/[^0-9]/g, '') === clean(b).replace(/[^0-9]/g, '');
  return clean(a) === clean(b);
}

// Profile view of a lead row: real columns win, data jsonb fills the rest.
function leadProfile(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const lead = { ...data, id: row.id };
  for (const column of LEAD_COLUMNS) if (row[column] !== undefined && row[column] !== null) lead[column] = row[column] instanceof Date ? row[column].toISOString() : row[column];
  return lead;
}

function relationTotal(counts = {}) {
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

// Deterministic master score. Rules are documented in DATABASE_CLEANUP_STEP3.md.
function masterScore(lead, counts = {}) {
  const parts = {};
  const add = (name, points) => { if (points) parts[name] = points; };
  add('zoho_record_id', lead.zoho_record_id ? 100 : 0);
  add('other_external_id', lead.eventbrite_attendee_id || lead.meta_lead_id || lead.apollo_person_id ? 60 : 0);
  add('email', isEmptyValue('email', lead.email) ? 0 : 20);
  add('phone', isEmptyValue('phone', lead.phone) ? 0 : 15);
  add('full_name', !isEmptyValue('first_name', lead.first_name) && !isEmptyValue('last_name', lead.last_name) ? 10 : 0);
  add('programme', isEmptyValue('programme_id', lead.programme_id) ? 0 : 10);
  add('employer', isEmptyValue('employer', lead.employer) ? 0 : 5);
  add('city', isEmptyValue('city', lead.city) ? 0 : 3);
  add('crm_stage', lead.stage && lead.stage !== 'New lead' ? 15 : 0);
  add('applications', Math.min(Number(counts.applications || 0), 3) * 20);
  add('activity', Math.min(relationTotal(counts) - Number(counts.applications || 0), 10));
  add('source_history', Math.min(Array.isArray(lead.source_history) ? lead.source_history.length : 0, 5) * 2);
  return { score: Object.values(parts).reduce((sum, value) => sum + value, 0), parts };
}

// Highest score first; ties go to more related records, then the earliest capture (keeps
// first-touch attribution), then the smallest id. app_leads has no updated_at column.
function rankMembers(leads, countsById) {
  return leads
    .map(lead => ({ lead, counts: countsById.get(lead.id) || {}, ...masterScore(lead, countsById.get(lead.id) || {}) }))
    .sort((a, b) => b.score - a.score
      || relationTotal(b.counts) - relationTotal(a.counts)
      || new Date(a.lead.created_at || 8.64e15) - new Date(b.lead.created_at || 8.64e15)
      || String(a.lead.id).localeCompare(String(b.lead.id)));
}

function sourceHistoryKey(item) {
  return [item?.source || '', item?.provider_id || '', item?.captured_at || ''].join('|');
}

function externalIdsOf(lead) {
  const ids = [];
  for (const def of EXTERNAL_ID_FIELDS) {
    const value = String(lead[def.field] || '').trim();
    if (value) ids.push({ provider: def.provider, module: def.moduleField ? String(lead[def.moduleField] || '') : '', external_id: value, lead_id: lead.id });
  }
  for (const item of Array.isArray(lead.external_ids) ? lead.external_ids : []) {
    if (item?.provider && item?.external_id) ids.push({ provider: item.provider, module: item.module || '', external_id: String(item.external_id), lead_id: lead.id });
  }
  return ids;
}

// Dry-run plan for one group: master, duplicates, fields to fill, conflicts, related records
// to move and the master record after the merge. Pure: reads nothing, writes nothing.
function planMerge(leads, countsById, meta = {}) {
  if (leads.length < 2) throw new Error('A merge needs at least two leads.');
  let ranked = rankMembers(leads, countsById);
  if (meta.preferredMasterId) {
    const preferred = ranked.find(entry => entry.lead.id === meta.preferredMasterId);
    if (!preferred) throw new Error(`Preferred master ${meta.preferredMasterId} is not in this merge group.`);
    ranked = [preferred, ...ranked.filter(entry => entry.lead.id !== meta.preferredMasterId)];
  }
  const master = ranked[0];
  const duplicates = ranked.slice(1);
  const after = JSON.parse(JSON.stringify(master.lead));
  const fieldsFilled = [];
  const conflicts = [];
  for (const dup of duplicates) {
    for (const field of MERGE_FIELDS) {
      const current = after[field];
      const incoming = dup.lead[field];
      if (isEmptyValue(field, incoming)) continue;
      if (isEmptyValue(field, current)) {
        after[field] = incoming;
        for (const companion of COMPANIONS[field] || []) if (dup.lead[companion] !== undefined) after[companion] = dup.lead[companion];
        fieldsFilled.push({ field, value: incoming, from: dup.lead.id });
      } else if (!sameValue(field, current, incoming)) {
        conflicts.push({ field, master_value: current, duplicate_value: incoming, duplicate_id: dup.lead.id, resolution: 'kept master value' });
      }
    }
    for (const def of EXTERNAL_ID_FIELDS) {
      const incoming = String(dup.lead[def.field] || '').trim();
      if (!incoming) continue;
      const current = String(after[def.field] || '').trim();
      if (!current) {
        after[def.field] = incoming;
        if (def.moduleField) after[def.moduleField] = dup.lead[def.moduleField] || after[def.moduleField];
        fieldsFilled.push({ field: def.field, value: incoming, from: dup.lead.id });
      } else if (current !== incoming) {
        conflicts.push({ field: def.field, master_value: current, duplicate_value: incoming, duplicate_id: dup.lead.id, resolution: 'both kept in app_lead_external_ids' });
      }
    }
    // Earliest capture is the first touch (same rule as mergeLeadData).
    if (dup.lead.created_at && (!after.created_at || new Date(dup.lead.created_at) < new Date(after.created_at))) {
      fieldsFilled.push({ field: 'created_at', value: dup.lead.created_at, from: dup.lead.id, previous: after.created_at || null });
      after.created_at = dup.lead.created_at;
      if (dup.lead.source_first_touch) after.source_first_touch = dup.lead.source_first_touch;
    }
  }
  const history = new Map();
  for (const item of [...(master.lead.source_history || []), ...duplicates.flatMap(dup => dup.lead.source_history || [])]) {
    if (item && !history.has(sourceHistoryKey(item))) history.set(sourceHistoryKey(item), item);
  }
  after.source_history = [...history.values()];
  const externalIds = [];
  const seenExternal = new Set();
  for (const item of [master, ...duplicates].flatMap(entry => externalIdsOf(entry.lead))) {
    const key = `${item.provider}|${item.module}|${item.external_id}`;
    if (!seenExternal.has(key)) { seenExternal.add(key); externalIds.push(item); }
  }
  after.external_ids = externalIds.map(({ provider, module, external_id }) => ({ provider, module, external_id }));
  after.merged_lead_ids = [...new Set([...(master.lead.merged_lead_ids || []), ...duplicates.map(dup => dup.lead.id)])];
  after.full_name = [after.first_name, after.last_name].filter(Boolean).join(' ');
  const relationships = {};
  for (const dup of duplicates) for (const [key, value] of Object.entries(dup.counts)) relationships[key] = (relationships[key] || 0) + Number(value || 0);
  return {
    group_key: meta.group_key || null,
    rule: meta.rule || null,
    confidence: meta.confidence || null,
    classification: meta.classification || null,
    master_id: master.lead.id,
    duplicate_ids: duplicates.map(dup => dup.lead.id),
    scores: ranked.map(entry => ({ id: entry.lead.id, score: entry.score, parts: entry.parts, related: relationTotal(entry.counts) })),
    fields_filled: fieldsFilled,
    conflicts,
    relationships_to_move: relationships,
    external_ids: externalIds,
    master_after: after
  };
}

const LEAD_ROW_SQL = `select id, ${LEAD_COLUMNS.join(', ')}, data from app_leads`;

// Builds the dry-run plan for a set of lead ids inside a READ ONLY transaction.
async function dryRunGroup(pool, ids, meta = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin transaction read only');
    const rows = (await client.query(`${LEAD_ROW_SQL} where id = any($1::text[]) order by id`, [ids])).rows;
    if (rows.length !== new Set(ids).size) throw new Error(`Only ${rows.length} of ${ids.length} leads exist.`);
    const counts = await relationCounts(client, ids);
    return planMerge(rows.map(leadProfile), counts, meta);
  } finally {
    await client.query('rollback').catch(() => null);
    client.release();
  }
}

function jsonRelinkSql(arrayExpr) {
  return `(select coalesce(jsonb_agg(case when x.item->>'lead_id' = $2 then jsonb_set(x.item, '{lead_id}', to_jsonb($1::text)) else x.item end order by x.ord), '[]'::jsonb)
           from jsonb_array_elements(${arrayExpr}) with ordinality as x(item, ord))`;
}

// Moves every reference from one duplicate to the master. Returns the ids moved per table.
async function moveReferences(client, masterId, duplicateId) {
  const moved = {};
  for (const ref of LEAD_REFERENCE_TABLES) {
    const result = await client.query(
      `update ${ref.table}
       set ${ref.column} = $1,
           data = case when jsonb_typeof(data) = 'object' and data ? '${ref.dataKey}' then jsonb_set(data, '{${ref.dataKey}}', to_jsonb($1::text)) else data end
       where ${ref.column} = $2 ${ref.where ? `and ${ref.where}` : ''}
       returning id`,
      [masterId, duplicateId]
    );
    moved[ref.key] = result.rows.map(row => row.id);
  }
  const needle = JSON.stringify([{ lead_id: duplicateId }]);
  const events = await client.query(
    `update app_events
     set attendees = case when jsonb_typeof(attendees) = 'array' then ${jsonRelinkSql('attendees')} else attendees end,
         data = case when jsonb_typeof(data->'attendees') = 'array' then jsonb_set(data, '{attendees}', ${jsonRelinkSql(`data->'attendees'`)}) else data end
     where attendees @> $3::jsonb or data->'attendees' @> $3::jsonb
     returning id`,
    [masterId, duplicateId, needle]
  );
  moved.meetings = events.rows.map(row => row.id);
  const calls = await client.query(
    `update app_workspace
     set meta = jsonb_set(meta, '{zoom,calls}', ${jsonRelinkSql(`meta->'zoom'->'calls'`)})
     where jsonb_typeof(meta->'zoom'->'calls') = 'array' and meta->'zoom'->'calls' @> $3::jsonb
     returning id`,
    [masterId, duplicateId, needle]
  );
  moved.zoom_calls = calls.rows.map(row => row.id);
  return moved;
}

async function renameLeadId(client, fromId, toId) {
  if (fromId === toId) return { renamed: false, from_id: fromId, to_id: toId };
  const existing = await client.query(`select id from app_leads where id = $1 limit 1`, [toId]);
  if (existing.rows[0]) throw new Error(`Cannot rename ${fromId} to ${toId}: target lead id already exists.`);
  const moved = await moveReferences(client, toId, fromId);
  await client.query(`update app_lead_external_ids set lead_id = $1 where lead_id = $2`, [toId, fromId]);
  const result = await client.query(
    `update app_leads
     set id = $2,
         person_id = $2,
         data = case when jsonb_typeof(data) = 'object'
           then jsonb_set(jsonb_set(data, '{id}', to_jsonb($2::text)), '{person_id}', to_jsonb($2::text))
           else data
         end
     where id = $1
     returning id`,
    [fromId, toId]
  );
  if (!result.rows[0]) throw new Error(`Cannot rename ${fromId}: lead not found.`);
  return { renamed: true, from_id: fromId, to_id: toId, moved };
}

function columnValue(column, value) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

// Merges one group in a single transaction: lock every member row, re-plan from the locked
// rows, fill the master, move all references, keep external ids, write the audit row with a
// full snapshot of each duplicate, then soft-delete the duplicates. Any error rolls back.
// dryRun (the default) returns the plan and changes nothing.
async function mergeLeadGroup(pool, ids, options = {}) {
  const dryRun = options.dryRun !== false;
  const meta = { group_key: options.groupKey, rule: options.rule, confidence: options.confidence, classification: options.classification };
  if (options.preferredMasterId) meta.preferredMasterId = options.preferredMasterId;
  if (dryRun) return { dryRun: true, plan: await dryRunGroup(pool, ids, meta) };
  if (!options.performedBy) throw new Error('performedBy is required for a real merge.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (!await mergeSchemaReady(client)) throw new Error('Run sql/2026-09-30_lead_dedupe.sql before merging.');
    // Lock in id order so two merges touching the same leads cannot deadlock.
    const rows = (await client.query(`${LEAD_ROW_SQL.replace('data from app_leads', 'data, deleted_at, merged_into_id from app_leads')} where id = any($1::text[]) order by id for update`, [ids])).rows;
    if (rows.length !== new Set(ids).size) throw new Error(`Only ${rows.length} of ${ids.length} leads exist.`);
    const inactive = rows.filter(row => row.deleted_at || row.merged_into_id);
    if (inactive.length) throw new Error(`Already merged or deleted: ${inactive.map(row => row.id).join(', ')}.`);
    const counts = await relationCounts(client, ids);
    const plan = planMerge(rows.map(leadProfile), counts, meta);
    if (options.expectedMasterId && options.expectedMasterId !== plan.master_id) {
      throw new Error(`Master changed since review: expected ${options.expectedMasterId}, now ${plan.master_id}.`);
    }
    const after = plan.master_after;
    // External ids: never re-point an identifier that already belongs to another lead.
    for (const item of plan.external_ids) {
      const existing = await client.query(
        `select lead_id from app_lead_external_ids where provider = $1 and module = $2 and external_id = $3`,
        [item.provider, item.module, item.external_id]
      );
      const owner = existing.rows[0]?.lead_id;
      if (owner && owner !== plan.master_id && !plan.duplicate_ids.includes(owner)) {
        throw new Error(`External id ${item.provider}:${item.external_id} already belongs to lead ${owner}.`);
      }
      await client.query(
        `insert into app_lead_external_ids (lead_id, provider, module, external_id, source)
         values ($1, $2, $3, $4, 'merge')
         on conflict (provider, module, external_id) do update set lead_id = excluded.lead_id`,
        [plan.master_id, item.provider, item.module, item.external_id]
      );
    }
    const setColumns = LEAD_COLUMNS.filter(column => column !== 'person_id');
    await client.query(
      `update app_leads set ${setColumns.map((column, index) => `${column} = $${index + 2}`).join(', ')}, data = $${setColumns.length + 2}::jsonb where id = $1`,
      [plan.master_id, ...setColumns.map(column => columnValue(column, after[column])), JSON.stringify(after)]
    );
    const moved = {};
    for (const duplicateId of plan.duplicate_ids) {
      const dupMoved = await moveReferences(client, plan.master_id, duplicateId);
      moved[duplicateId] = dupMoved;
      const snapshot = rows.find(row => row.id === duplicateId);
      await client.query(
        `insert into app_lead_merge_audit (cleanup_run_id, entity_type, master_id, duplicate_id, merge_reason, confidence, rule, fields_merged, conflicts, relationships_moved, external_ids, duplicate_snapshot, performed_by)
         values ($12, 'lead', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
        [
          plan.master_id, duplicateId, options.reason || (plan.rule ? `duplicate by ${plan.rule}` : 'manual merge'), plan.confidence || 'MANUAL', plan.rule || null,
          JSON.stringify(plan.fields_filled.filter(item => item.from === duplicateId)),
          JSON.stringify(plan.conflicts.filter(item => item.duplicate_id === duplicateId)),
          JSON.stringify(dupMoved), JSON.stringify(plan.external_ids.filter(item => item.lead_id === duplicateId)),
          JSON.stringify(snapshot), options.performedBy, options.cleanupRunId || null
        ]
      );
      await client.query(
        `update app_leads set deleted_at = now(), merged_into_id = $1,
           data = data || jsonb_build_object('merged_into_id', $1::text, 'deleted_at', now())
         where id = $2`,
        [plan.master_id, duplicateId]
      );
    }
    await client.query('commit');
    return { dryRun: false, plan, moved };
  } catch (error) {
    await client.query('rollback').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  LEAD_REFERENCE_TABLES,
  LEAD_REFERENCE_JSON,
  RULE_CONFIDENCE,
  MERGE_FIELDS,
  activeLeadSql,
  normalizeEmail,
  emailLeadId,
  mergeSchemaReady,
  findDuplicateGroups,
  classifyGroup,
  relationCounts,
  leadProfile,
  masterScore,
  rankMembers,
  planMerge,
  dryRunGroup,
  moveReferences,
  renameLeadId,
  mergeLeadGroup
};
