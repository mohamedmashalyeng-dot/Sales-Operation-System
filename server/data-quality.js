'use strict';

const State = require('./state');
const Storage = require('./storage');
const Config = require('./config');
const Leads = require('./leads');
const Http = require('./http');
const Emails = require('./emails');

const ISSUE_TYPES = [
  'duplicate_leads',
  'missing_email',
  'invalid_email',
  'missing_phone',
  'invalid_phone',
  'missing_owner',
  'missing_programme',
  'orphan_task',
  'orphan_application',
  'orphan_email_relation',
  'duplicate_external_id',
  'zoho_mismatch',
  'stale_lead',
  'stale_application',
  'incomplete_application'
];

const SNAPSHOT_ID = 'main';
const SNAPSHOT_TTL_MS = Number(process.env.DATA_QUALITY_SNAPSHOT_TTL_MS || 15 * 60 * 1000);
const SNAPSHOT_LOCK_KEY = 'data-quality:snapshot:main';
let refreshPromise = null;

function dataQualitySnapshotTableSql() {
  return `
    create table if not exists app_data_quality_snapshot (
      id text primary key,
      generated_at timestamptz not null default now(),
      status text not null default 'ready',
      stale_days int not null default 90,
      metrics jsonb not null default '{}'::jsonb,
      data jsonb not null default '{}'::jsonb
    )
  `;
}

function parseLimit(value, fallback = 25, max = 50) {
  const n = Number(value || fallback);
  return Math.max(1, Math.min(Number.isFinite(n) ? n : fallback, max));
}

function parseCursor(value) {
  const n = Number(value || 0);
  return Math.max(0, Number.isFinite(n) ? n : 0);
}

function parseStaleDays(value) {
  const n = Number(value || process.env.DATA_QUALITY_STALE_DAYS || 90);
  return Math.max(7, Math.min(Number.isFinite(n) ? n : 90, 365));
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function emailInvalidSql(alias = 'l') {
  return `coalesce(trim(${alias}.email), '') <> '' and lower(trim(${alias}.email)) !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`;
}

function phoneInvalidSql(alias = 'l') {
  return `coalesce(trim(${alias}.phone), '') <> '' and (
    length(regexp_replace(coalesce(${alias}.phone, ''), '[^0-9]', '', 'g')) < 7
    or length(regexp_replace(coalesce(${alias}.phone, ''), '[^0-9]', '', 'g')) > 20
    or regexp_replace(coalesce(${alias}.phone, ''), '[^0-9]', '', 'g') ~ '^(0{7,}|1{7,}|9{7,})$'
    or lower(${alias}.phone) ~ '(test|unknown|none|n/a|no phone)'
  )`;
}

async function relationPresence() {
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return {};
  const result = await State.postgresPool.query(`
    select
      to_regclass('app_zoho_records') is not null as zoho_records,
      to_regclass('app_lead_external_ids') is not null as lead_external_ids,
      to_regclass('app_data_quality_snapshot') is not null as snapshot
  `);
  return result.rows[0] || {};
}

function leadFilterSql(options = {}, startIndex = 1, alias = 'l') {
  const where = [Leads.activeLeadCondition(alias)];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace(/\?/g, `$${startIndex + params.length - 1}`));
  };
  if (options.owner_id) add(`${alias}.owner_id = ?`, options.owner_id);
  if (options.programme_id) add(`${alias}.programme_id = ?`, options.programme_id);
  if (options.source) add(`(${alias}.source_first_touch = ? or ${alias}.source_lead_capture = ?)`, options.source);
  return { sql: where.join(' and '), params };
}

async function computeSummaryDb(options = {}) {
  const staleDays = parseStaleDays(options.stale_days);
  const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
  const flags = await relationPresence();
  const active = Leads.activeLeadCondition('l');
  const duplicateExternalSql = `(select count(*)::int from (
    select key from (
      select data->>'zoho_record_id' as key from app_leads l where ${active} and coalesce(data->>'zoho_record_id', '') <> ''
      union all select data->>'meta_lead_id' from app_leads l where ${active} and coalesce(data->>'meta_lead_id', '') <> ''
      union all select data->>'apollo_person_id' from app_leads l where ${active} and coalesce(data->>'apollo_person_id', '') <> ''
    ) ids group by key having count(*) > 1
  ) x)`;
  const zohoSql = flags.zoho_records
    ? `(select count(*)::int from app_leads l where ${active} and coalesce(l.data->>'zoho_record_id', '') <> '' and not exists (select 1 from app_zoho_records z where z.key = l.data->>'zoho_record_id'))
       + (select count(*)::int from app_leads l join app_zoho_records z on z.key = l.data->>'zoho_record_id' where ${active} and coalesce(l.email, '') <> '' and coalesce(z.email, '') <> '' and lower(trim(l.email)) <> lower(trim(z.email)))`
    : '0';
  const [leadStats, duplicateStats, orphanStats, appStats, externalStats] = await Promise.all([
    State.postgresPool.query(`
      select
        count(*) filter (where coalesce(trim(l.email), '') = '')::int as missing_email,
        count(*) filter (where ${emailInvalidSql('l')})::int as invalid_email,
        count(*) filter (where coalesce(trim(l.phone), '') = '')::int as missing_phone,
        count(*) filter (where ${phoneInvalidSql('l')})::int as invalid_phone,
        count(*) filter (where coalesce(l.owner_id, '') = '' or u.id is null)::int as missing_owner,
        count(*) filter (where coalesce(l.programme_id, '') = '' or p.id is null)::int as missing_programme,
        count(*) filter (where coalesce(l.stage, '') not in ('Enrolled','Not Eligible','Duplicate') and coalesce(l.created_at, now()) < now() - ($1::int || ' days')::interval and (l.next_action_at is null or l.next_action_at < now() - ($1::int || ' days')::interval))::int as stale_lead
      from app_leads l
      left join ${usersTable} u on u.id = l.owner_id
      left join app_programmes p on p.id = l.programme_id
      where ${active}
    `, [staleDays]),
    State.postgresPool.query(`
      with duplicate_keys as (
        select 'email' as rule, lower(trim(email)) as key from app_leads l where ${active} and coalesce(trim(email), '') <> '' and lower(trim(email)) not like '%.local'
        union all select 'phone', regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') from app_leads l where ${active} and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
        union all select 'zoho', data->>'zoho_record_id' from app_leads l where ${active} and coalesce(data->>'zoho_record_id', '') <> ''
        union all select 'meta', data->>'meta_lead_id' from app_leads l where ${active} and coalesce(data->>'meta_lead_id', '') <> ''
        union all select 'apollo', data->>'apollo_person_id' from app_leads l where ${active} and coalesce(data->>'apollo_person_id', '') <> ''
      )
      select count(*)::int as duplicate_leads from (select rule, key from duplicate_keys where coalesce(key, '') <> '' group by 1,2 having count(*) > 1) g
    `),
    State.postgresPool.query(`
      select
        (select count(*)::int from app_tasks t where coalesce(t.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = t.lead_id and ${Leads.activeLeadCondition('l')})) as orphan_task,
        (select count(*)::int from app_applications a where coalesce(a.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = a.lead_id and ${Leads.activeLeadCondition('l')})) as orphan_application,
        (select count(*)::int from app_emails e where coalesce(e.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = e.lead_id and ${Leads.activeLeadCondition('l')})) as orphan_email_relation
    `),
    State.postgresPool.query(`
      select
        count(*) filter (where coalesce(a.status, '') not in ('Enrolled','Not Eligible') and a.learner is null and coalesce(a.created_at, now()) < now() - ($1::int || ' days')::interval)::int as stale_application,
        count(*) filter (where coalesce(a.lead_id, '') = '' or coalesce(a.programme, '') = '' or coalesce(a.status, '') = '')::int as incomplete_application
      from app_applications a
    `, [staleDays]),
    State.postgresPool.query(`select ${duplicateExternalSql} as duplicate_external_id, ${zohoSql} as zoho_mismatch`)
  ]);
  return {
    metrics: { ...leadStats.rows[0], ...duplicateStats.rows[0], ...orphanStats.rows[0], ...appStats.rows[0], ...externalStats.rows[0] },
    generated_at: new Date().toISOString(),
    stale_days: staleDays
  };
}
async function storeSnapshot(summary) {
  await State.postgresPool.query(`
    insert into app_data_quality_snapshot (id, generated_at, status, stale_days, metrics, data)
    values ($1, now(), 'ready', $2, $3::jsonb, $4::jsonb)
    on conflict (id) do update set generated_at = excluded.generated_at, status = excluded.status, stale_days = excluded.stale_days, metrics = excluded.metrics, data = excluded.data
  `, [SNAPSHOT_ID, summary.stale_days, JSON.stringify(summary.metrics), JSON.stringify({ generated_at: summary.generated_at })]);
  return true;
}

async function withSnapshotRefreshLock(fn) {
  const client = await State.postgresPool.connect();
  let locked = false;
  try {
    const lock = await client.query(`select pg_try_advisory_lock(hashtext($1)) as locked`, [SNAPSHOT_LOCK_KEY]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) {
      try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [SNAPSHOT_LOCK_KEY]); } catch {}
    }
    client.release();
  }
}

async function refreshSnapshot(options = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = withSnapshotRefreshLock(async () => {
    const summary = await computeSummaryDb(options);
    await storeSnapshot(summary);
    return summary;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function readSnapshotRow() {
  const snap = await State.postgresPool.query(`select generated_at, stale_days, metrics from app_data_quality_snapshot where id = $1 limit 1`, [SNAPSHOT_ID]);
  return snap.rows[0] || null;
}

async function waitForSnapshot(options = {}) {
  const timeoutMs = Number(options.wait_ms || 8000);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await readSnapshotRow();
    if (row) return row;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

async function freshSnapshotMetric(name) {
  try {
    const row = await readSnapshotRow();
    if (!row) return null;
    const ageMs = Math.max(0, Date.now() - new Date(row.generated_at).getTime());
    if (ageMs > SNAPSHOT_TTL_MS) return null;
    return Number(row.metrics?.[name]);
  } catch {
    return null;
  }
}

async function loadSummaryDb(options = {}) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return computeSummaryLocal(await Storage.loadDb(), options);
  let row = null;
  try {
    row = await readSnapshotRow();
  } catch (error) {
    if (error?.code !== '42P01') throw error;
    const live = await computeSummaryDb(options);
    return { ...live, snapshot: { used: false, reason: 'snapshot table missing; run sql/2026-10-12_data_quality_snapshot.sql' } };
  }
  if (!row) {
    const summary = await refreshSnapshot(options);
    if (summary) return { ...summary, snapshot: { used: true, stale: false, refreshed: true } };
    row = await waitForSnapshot(options);
    if (row) {
      const ageMs = Math.max(0, Date.now() - new Date(row.generated_at).getTime());
      return { metrics: row.metrics || {}, generated_at: row.generated_at, stale_days: Number(row.stale_days || parseStaleDays(options.stale_days)), snapshot: { used: true, stale: ageMs > SNAPSHOT_TTL_MS, age_ms: ageMs, refreshed_by_peer: true } };
    }
    throw Http.statusError(503, 'Data Quality snapshot refresh is already running. Please retry shortly.');
  }
  const ageMs = Math.max(0, Date.now() - new Date(row.generated_at).getTime());
  const payload = { metrics: row.metrics || {}, generated_at: row.generated_at, stale_days: Number(row.stale_days || parseStaleDays(options.stale_days)), snapshot: { used: true, stale: ageMs > SNAPSHOT_TTL_MS, age_ms: ageMs } };
  if (payload.snapshot.stale && !options.suppress_background_refresh) refreshSnapshot(options).catch(error => console.error(`[data-quality] snapshot refresh failed: ${error.stack || error.message}`));
  return payload;
}

function issueRow(row) {
  return {
    issue_id: row.issue_id,
    type: row.type,
    severity: row.severity || 'review',
    confidence: row.confidence || '',
    title: row.title || row.issue_id,
    why: row.why || '',
    suggested_review: row.suggested_review || 'Review the record before making changes.',
    affected_count: Number(row.affected_count || 1),
    records: row.records || []
  };
}

async function duplicateLeadIssues(options = {}) {
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const pageCap = cursor + limit + 1;
  const rules = [
    { rule: 'email', key: `lower(trim(l.email))`, where: `coalesce(trim(l.email), '') <> '' and lower(trim(l.email)) not like '%.local'` },
    { rule: 'phone', key: `regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')`, where: `length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 7` },
    { rule: 'zoho_record_id', key: `(l.data->>'zoho_record_id')`, where: `coalesce(l.data->>'zoho_record_id', '') <> ''` },
    { rule: 'meta_lead_id', key: `(l.data->>'meta_lead_id')`, where: `coalesce(l.data->>'meta_lead_id', '') <> ''` },
    { rule: 'apollo_person_id', key: `(l.data->>'apollo_person_id')`, where: `coalesce(l.data->>'apollo_person_id', '') <> ''` }
  ];
  const grouped = [];
  for (const cfg of rules) {
    if (grouped.length >= pageCap) break;
    const filter = leadFilterSql(options, 2, 'l');
    const result = await State.postgresPool.query(`
      select $${filter.params.length + 2}::text as rule, 'HIGH' as confidence, ${cfg.key} as key,
        count(*)::int as affected_count,
        substr(md5($${filter.params.length + 2}::text || ':' || ${cfg.key}), 1, 12) as issue_id
      from app_leads l
      where ${filter.sql} and ${cfg.where}
      group by 1,2,3 having count(*) > 1
      order by issue_id
      limit $1
    `, [pageCap - grouped.length, ...filter.params, cfg.rule]);
    grouped.push(...result.rows);
  }
  const page = grouped.slice(cursor, cursor + limit);
  if (!page.length) return { issues: [], next_cursor: '' };
  const recordsByGroup = new Map();
  for (const rule of [...new Set(page.map(group => group.rule))]) {
    const keys = page.filter(group => group.rule === rule).map(group => group.key);
    const recordFilter = leadFilterSql(options, 3, 'l');
    let condition = '';
    let keyExpr = '';
    if (rule === 'email') {
      keyExpr = `lower(trim(l.email))`;
      condition = `${keyExpr} = any($1::text[]) and coalesce(trim(l.email), '') <> '' and lower(trim(l.email)) not like '%.local'`;
    } else if (rule === 'phone') {
      keyExpr = `regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')`;
      condition = `${keyExpr} = any($1::text[]) and length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 7`;
    } else if (rule === 'zoho_record_id') {
      keyExpr = `(l.data->>'zoho_record_id')`;
      condition = `${keyExpr} = any($1::text[])`;
    } else if (rule === 'meta_lead_id') {
      keyExpr = `(l.data->>'meta_lead_id')`;
      condition = `${keyExpr} = any($1::text[])`;
    } else if (rule === 'apollo_person_id') {
      keyExpr = `(l.data->>'apollo_person_id')`;
      condition = `${keyExpr} = any($1::text[])`;
    }
    const records = await State.postgresPool.query(`
      select $2::text as rule, ${keyExpr} as match_key,
        l.id, trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) as name,
        l.email, l.phone, l.owner, l.owner_id, l.programme, l.programme_id, l.stage, l.source_first_touch as source, l.created_at,
        'leads/' || l.id as route
      from app_leads l
      where ${recordFilter.sql} and ${condition}
      order by l.created_at nulls last, l.id
    `, [keys, rule, ...recordFilter.params]);
    for (const record of records.rows) {
      const mapKey = `${record.rule}:${record.match_key}`;
      if (!recordsByGroup.has(mapKey)) recordsByGroup.set(mapKey, []);
      recordsByGroup.get(mapKey).push(record);
    }
  }
  const issues = page.map(group => issueRow({
      type: 'duplicate_leads',
      severity: 'review',
      confidence: group.confidence,
      issue_id: `duplicate_leads:${group.issue_id}`,
      title: `Duplicate lead candidates matched by ${group.rule}`,
      why: `Matched by exact normalized ${group.rule}. Name-only matching is intentionally not used.`,
      suggested_review: 'Review the group and use a future merge preview before any cleanup.',
      affected_count: group.affected_count,
      records: recordsByGroup.get(`${group.rule}:${group.key}`) || []
    }));
  return { issues, next_cursor: grouped.length > cursor + limit ? String(cursor + limit) : '' };
}

function leadIssueWhere(type) {
  if (type === 'missing_email') return { title: 'Missing email address', why: 'Lead has no email address.', sql: `coalesce(trim(l.email), '') = ''` };
  if (type === 'invalid_email') return { title: 'Invalid email format', why: 'Email does not match a basic local@domain format.', sql: emailInvalidSql('l') };
  if (type === 'missing_phone') return { title: 'Missing phone number', why: 'Lead has no phone number.', sql: `coalesce(trim(l.phone), '') = ''` };
  if (type === 'invalid_phone') return { title: 'Suspicious phone value', why: 'Phone is too short, too long, repeated digits, or an obvious placeholder.', sql: phoneInvalidSql('l') };
  if (type === 'missing_owner') {
    const usersTable = Storage.sqlIdentifier(Config.POSTGRES_USERS_TABLE, 'app_users');
    return { title: 'Missing or invalid owner', why: 'Owner is blank or no longer resolves to a workspace user.', join: `left join ${usersTable} u on u.id = l.owner_id`, sql: `coalesce(l.owner_id, '') = '' or u.id is null` };
  }
  if (type === 'missing_programme') return { title: 'Missing or invalid programme', why: 'Programme is blank or no longer resolves to the programme table.', join: `left join app_programmes p on p.id = l.programme_id`, sql: `coalesce(l.programme_id, '') = '' or p.id is null` };
  if (type === 'stale_lead') return { title: 'Stale lead', why: 'Open lead has had no current follow-up signal inside the configured stale window.', sql: `coalesce(l.stage, '') not in ('Enrolled','Not Eligible','Duplicate') and coalesce(l.created_at, now()) < now() - ($3::int || ' days')::interval and not exists (select 1 from app_tasks t where t.lead_id = l.id and t.status = 'Open' and t.due_at >= now() - ($3::int || ' days')::interval)`, extraParam: true };
  return null;
}

async function leadIssues(type, options = {}) {
  const cfg = leadIssueWhere(type);
  if (!cfg) throw Http.statusError(400, 'Unsupported data-quality issue type.');
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const filterStart = cfg.extraParam ? 4 : 3;
  const filter = leadFilterSql(options, filterStart, 'l');
  const params = cfg.extraParam ? [limit, cursor, parseStaleDays(options.stale_days), ...filter.params] : [limit, cursor, ...filter.params];
  const result = await State.postgresPool.query(`
    select '${type}' as type, 'review' as severity, '${type}:' || l.id as issue_id,
      $${params.length + 1}::text as title,
      $${params.length + 2}::text as why,
      'Open the lead and correct the data after review.' as suggested_review,
      1 as affected_count,
      jsonb_build_array(jsonb_build_object('id', l.id, 'name', trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), 'email', l.email, 'phone', l.phone, 'owner', l.owner, 'owner_id', l.owner_id, 'programme', l.programme, 'programme_id', l.programme_id, 'stage', l.stage, 'created_at', l.created_at, 'route', 'leads/' || l.id)) as records
    from app_leads l
    ${cfg.join || ''}
    where ${Leads.activeLeadCondition('l')} and (${cfg.sql}) and ${filter.sql}
    order by l.created_at desc nulls last, l.id desc
    limit $1 offset $2
  `, [...params, cfg.title, cfg.why]);
  return { issues: result.rows.map(issueRow), next_cursor: result.rows.length === limit ? String(cursor + limit) : '' };
}

async function orphanIssues(type, options = {}) {
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const map = {
    orphan_task: { table: 'app_tasks', alias: 't', title: 'Orphan task', columns: `t.id, t.title, t.owner_id, t.lead_id`, route: 'planner', label: 'Task references a lead that no longer resolves.' },
    orphan_application: { table: 'app_applications', alias: 'a', title: 'Orphan application', columns: `a.id, trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) as title, a.manager as owner_id, a.lead_id`, route: 'applications', label: 'Application references a lead that no longer resolves.' },
    orphan_email_relation: { table: 'app_emails', alias: 'e', title: 'Orphan email relation', columns: `e.id, e.subject as title, e.owner as owner_id, e.lead_id`, route: 'inbox', label: 'Email has a lead_id, but that lead no longer resolves. Standalone emails without lead_id are not flagged.' }
  };
  const cfg = map[type];
  if (!cfg) throw Http.statusError(400, 'Unsupported orphan issue type.');
  const result = await State.postgresPool.query(`
    select '${type}' as type, 'review' as severity, '${type}:' || x.id as issue_id,
      $3::text as title,
      $4::text as why,
      'Review the relationship before deleting or relinking anything.' as suggested_review,
      1 as affected_count,
      jsonb_build_array(jsonb_build_object('id', x.id, 'title', x.title, 'owner_id', x.owner_id, 'missing_lead_id', x.lead_id, 'route', $5::text)) as records
    from (select ${cfg.columns} from ${cfg.table} ${cfg.alias}) x
    where coalesce(x.lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = x.lead_id and ${Leads.activeLeadCondition('l')})
    order by x.id desc
    limit $1 offset $2
  `, [limit, cursor, cfg.title, cfg.label, cfg.route]);
  return { issues: result.rows.map(issueRow), next_cursor: result.rows.length === limit ? String(cursor + limit) : '' };
}

async function applicationIssues(type, options = {}) {
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const staleDays = parseStaleDays(options.stale_days);
  const condition = type === 'stale_application'
    ? `coalesce(a.status, '') not in ('Enrolled','Not Eligible') and a.learner is null and coalesce(a.created_at, now()) < now() - ($3::int || ' days')::interval`
    : `coalesce(a.lead_id, '') = '' or coalesce(a.programme, '') = '' or coalesce(a.status, '') = ''`;
  const result = await State.postgresPool.query(`
    select '${type}' as type, 'review' as severity, '${type}:' || a.id as issue_id,
      case when '${type}' = 'stale_application' then 'Stale application' else 'Incomplete application' end as title,
      case when '${type}' = 'stale_application' then 'Application has remained open beyond the configured stale window.' else 'Application is missing a core relationship or status field.' end as why,
      'Review the application before changing status or relationships.' as suggested_review,
      1 as affected_count,
      jsonb_build_array(jsonb_build_object('id', a.id, 'name', trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), 'lead_id', a.lead_id, 'programme', a.programme, 'status', a.status, 'created_at', a.created_at, 'route', 'applications/' || a.id)) as records
    from app_applications a
    where ${condition}
    order by a.created_at desc nulls last, a.id desc
    limit $1 offset $2
  `, [limit, cursor, staleDays]);
  return { issues: result.rows.map(issueRow), next_cursor: result.rows.length === limit ? String(cursor + limit) : '' };
}

async function externalIssues(type, options = {}) {
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  const flags = await relationPresence();
  if (type === 'zoho_mismatch' && !flags.zoho_records) return { issues: [], next_cursor: '' };
  if (type === 'zoho_mismatch') {
    const freshZero = await freshSnapshotMetric('zoho_mismatch');
    if (freshZero === 0) return { issues: [], next_cursor: '' };
    const result = await State.postgresPool.query(`
      select 'zoho_mismatch' as type, 'review' as severity, 'zoho_mismatch:' || l.id as issue_id,
        'Zoho/local mismatch' as title,
        case when z.key is null then 'Local lead stores a Zoho id that is missing from synced Zoho records.' else 'Local email differs from the synced Zoho record email.' end as why,
        'Review local and Zoho records. Do not overwrite either side automatically.' as suggested_review,
        1 as affected_count,
        jsonb_build_array(jsonb_build_object('id', l.id, 'name', trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), 'email', l.email, 'zoho_record_id', l.data->>'zoho_record_id', 'zoho_email', z.email, 'route', 'leads/' || l.id)) as records
      from app_leads l
      left join app_zoho_records z on z.key = l.data->>'zoho_record_id'
      where ${Leads.activeLeadCondition('l')} and coalesce(l.data->>'zoho_record_id', '') <> ''
        and (z.key is null or (coalesce(l.email, '') <> '' and coalesce(z.email, '') <> '' and lower(trim(l.email)) <> lower(trim(z.email))))
      order by l.created_at desc nulls last, l.id desc
      limit $1 offset $2
    `, [limit, cursor]);
    return { issues: result.rows.map(issueRow), next_cursor: result.rows.length === limit ? String(cursor + limit) : '' };
  }
  const result = await State.postgresPool.query(`
    with ids as (
      select 'zoho_record_id' as field, data->>'zoho_record_id' as external_id, id from app_leads l where ${Leads.activeLeadCondition('l')} and coalesce(data->>'zoho_record_id', '') <> ''
      union all select 'meta_lead_id', data->>'meta_lead_id', id from app_leads l where ${Leads.activeLeadCondition('l')} and coalesce(data->>'meta_lead_id', '') <> ''
      union all select 'apollo_person_id', data->>'apollo_person_id', id from app_leads l where ${Leads.activeLeadCondition('l')} and coalesce(data->>'apollo_person_id', '') <> ''
    ),
    grouped as (
      select field, external_id, count(*)::int as affected_count from ids group by 1,2 having count(*) > 1 order by field, external_id limit $1 offset $2
    )
    select 'duplicate_external_id' as type, 'review' as severity, 'duplicate_external_id:' || md5(g.field || ':' || g.external_id) as issue_id,
      'Duplicate external id' as title,
      'External id ' || g.field || ' appears on multiple active leads.' as why,
      'Review source identity before changing any records.' as suggested_review,
      g.affected_count,
      jsonb_agg(jsonb_build_object('id', l.id, 'name', trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), 'external_id', g.external_id, 'field', g.field, 'route', 'leads/' || l.id) order by l.id) as records
    from grouped g join ids on ids.field = g.field and ids.external_id = g.external_id join app_leads l on l.id = ids.id
    group by g.field, g.external_id, g.affected_count
  `, [limit, cursor]);
  return { issues: result.rows.map(issueRow), next_cursor: result.rows.length === limit ? String(cursor + limit) : '' };
}

async function listIssuesDb(options = {}) {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) return listIssuesLocal(await Storage.loadDb(), options);
  const type = ISSUE_TYPES.includes(options.type) ? options.type : 'duplicate_leads';
  if (type === 'duplicate_leads') return duplicateLeadIssues(options);
  if (['missing_email', 'invalid_email', 'missing_phone', 'invalid_phone', 'missing_owner', 'missing_programme', 'stale_lead'].includes(type)) return leadIssues(type, options);
  if (['orphan_task', 'orphan_application', 'orphan_email_relation'].includes(type)) return orphanIssues(type, options);
  if (['stale_application', 'incomplete_application'].includes(type)) return applicationIssues(type, options);
  if (['duplicate_external_id', 'zoho_mismatch'].includes(type)) return externalIssues(type, options);
  throw Http.statusError(400, 'Unsupported data-quality issue type.');
}

function leadRecord(lead) {
  return { id: lead.id, name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(), email: lead.email || '', phone: lead.phone || '', owner_id: lead.owner_id || '', programme_id: lead.programme_id || '', programme: lead.programme || '', stage: lead.stage || '', route: `leads/${lead.id}` };
}

function issue(type, title, why, record, extras = {}) {
  return { issue_id: `${type}:${extras.key || record.id}`, type, severity: 'review', confidence: extras.confidence || '', title, why, suggested_review: extras.suggested_review || 'Review the record before making changes.', affected_count: extras.records?.length || 1, records: extras.records || [record] };
}

function localDuplicateGroups(leads) {
  const groups = [];
  for (const [rule, getter] of [['email', l => Emails.normalizeEmail(l.email)], ['phone', l => normalizePhone(l.phone)], ['zoho_record_id', l => l.zoho_record_id || l.data?.zoho_record_id], ['meta_lead_id', l => l.meta_lead_id || l.data?.meta_lead_id], ['apollo_person_id', l => l.apollo_person_id || l.data?.apollo_person_id]]) {
    const map = new Map();
    leads.forEach(lead => {
      const key = String(getter(lead) || '').trim().toLowerCase();
      if (!key || (rule === 'phone' && key.length < 7) || key.endsWith('.local')) return;
      (map.get(key) || map.set(key, []).get(key)).push(lead);
    });
    for (const [key, list] of map.entries()) if (list.length > 1) groups.push(issue('duplicate_leads', `Duplicate lead candidates matched by ${rule}`, `Matched by exact normalized ${rule}. Name-only matching is intentionally not used.`, leadRecord(list[0]), { key: `${rule}:${key}`, confidence: 'HIGH', records: list.map(leadRecord), suggested_review: 'Review the group and use a future merge preview before any cleanup.' }));
  }
  return groups;
}

function computeSummaryLocal(db, options = {}) {
  const leads = db.leads || [];
  const users = new Set((db.users || db.owners || []).map(u => u.id));
  const programmes = new Set((db.programmes || []).map(p => p.id));
  const invalidEmail = lead => lead.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(lead.email).trim());
  const invalidPhone = lead => {
    const digits = normalizePhone(lead.phone);
    return Boolean(lead.phone) && (digits.length < 7 || digits.length > 20 || /^(0{7,}|1{7,}|9{7,})$/.test(digits) || /(test|unknown|none|n\/a|no phone)/i.test(lead.phone));
  };
  const leadIds = new Set(leads.map(l => l.id));
  return {
    metrics: {
      duplicate_leads: localDuplicateGroups(leads).length,
      missing_email: leads.filter(l => !String(l.email || '').trim()).length,
      invalid_email: leads.filter(invalidEmail).length,
      missing_phone: leads.filter(l => !String(l.phone || '').trim()).length,
      invalid_phone: leads.filter(invalidPhone).length,
      missing_owner: leads.filter(l => !l.owner_id || !users.has(l.owner_id)).length,
      missing_programme: leads.filter(l => !l.programme_id || !programmes.has(l.programme_id)).length,
      orphan_task: (db.tasks || []).filter(t => t.lead_id && !leadIds.has(t.lead_id)).length,
      orphan_application: (db.applications || []).filter(a => a.lead_id && !leadIds.has(a.lead_id)).length,
      orphan_email_relation: (db.emails || []).filter(e => e.lead_id && !leadIds.has(e.lead_id)).length,
      duplicate_external_id: localDuplicateGroups(leads).filter(g => /external|zoho|meta|apollo/.test(g.why)).length,
      zoho_mismatch: 0,
      stale_lead: 0,
      stale_application: 0,
      incomplete_application: (db.applications || []).filter(a => !a.lead_id || !a.programme || !a.status).length
    },
    generated_at: new Date().toISOString(),
    stale_days: parseStaleDays(options.stale_days),
    snapshot: { used: false, reason: 'local storage' }
  };
}

function listIssuesLocal(db, options = {}) {
  const type = ISSUE_TYPES.includes(options.type) ? options.type : 'duplicate_leads';
  const leads = db.leads || [];
  const leadIds = new Set(leads.map(l => l.id));
  let issues = [];
  if (type === 'duplicate_leads') issues = localDuplicateGroups(leads);
  else if (type === 'missing_email') issues = leads.filter(l => !String(l.email || '').trim()).map(l => issue(type, 'Missing email address', 'Lead has no email address.', leadRecord(l)));
  else if (type === 'invalid_email') issues = leads.filter(l => l.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(l.email).trim())).map(l => issue(type, 'Invalid email format', 'Email does not match a basic local@domain format.', leadRecord(l)));
  else if (type === 'missing_owner') issues = leads.filter(l => !l.owner_id).map(l => issue(type, 'Missing owner', 'Lead has no owner assigned.', leadRecord(l)));
  else if (type === 'orphan_task') issues = (db.tasks || []).filter(t => t.lead_id && !leadIds.has(t.lead_id)).map(t => issue(type, 'Orphan task', 'Task references a lead that no longer resolves.', { id: t.id, title: t.title, missing_lead_id: t.lead_id, route: 'planner' }));
  else if (type === 'duplicate_external_id') issues = localDuplicateGroups(leads).filter(g => /zoho|meta|apollo/.test(g.title + g.why));
  else if (type === 'orphan_application') issues = (db.applications || []).filter(a => a.lead_id && !leadIds.has(a.lead_id)).map(a => issue(type, 'Orphan application', 'Application references a lead that no longer resolves.', { id: a.id, lead_id: a.lead_id, missing_lead_id: a.lead_id, route: `applications/${a.id}` }));
  else if (type === 'orphan_email_relation') issues = (db.emails || []).filter(e => e.lead_id && !leadIds.has(e.lead_id)).map(e => issue(type, 'Orphan email relation', 'Email has a lead_id, but that lead no longer resolves.', { id: e.id, title: e.subject, missing_lead_id: e.lead_id, route: 'inbox' }));
  else if (type === 'incomplete_application') issues = (db.applications || []).filter(a => !a.lead_id || !a.programme || !a.status).map(a => issue(type, 'Incomplete application', 'Application is missing a core relationship or status field.', { id: a.id, lead_id: a.lead_id, programme: a.programme, status: a.status, route: `applications/${a.id}` }));
  const limit = parseLimit(options.limit);
  const cursor = parseCursor(options.cursor);
  return { issues: issues.slice(cursor, cursor + limit), next_cursor: issues.length > cursor + limit ? String(cursor + limit) : '' };
}

exports.ISSUE_TYPES = ISSUE_TYPES;
exports.dataQualitySnapshotTableSql = dataQualitySnapshotTableSql;
exports.loadSummaryDb = loadSummaryDb;
exports.computeSummaryDb = computeSummaryDb;
exports.listIssuesDb = listIssuesDb;
exports.computeSummaryLocal = computeSummaryLocal;
exports.listIssuesLocal = listIssuesLocal;
exports.parseStaleDays = parseStaleDays;

