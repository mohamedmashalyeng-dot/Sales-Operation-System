'use strict';
// Database cleanup Step 4: schema audit, duplicate dry run, orphan audit and guarded execution.
// Default mode is REPORT_ONLY/DRY_RUN style reporting. EXECUTE_SAFE refuses to run unless
// CLEANUP_BACKUP_VERIFIED=yes and LEAD_DEDUPE_ALLOW_EXECUTE=yes are both set.
process.env.NEST_COMPAT_MODE = 'true';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { Pool } = require('pg');
const dedupe = require('../lib/lead-dedupe');

const root = path.join(__dirname, '..');

function loadEnvFile(filename) {
  const file = path.join(root, filename);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}
loadEnvFile('.env');
loadEnvFile('.env.hostinger');

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const mode = String(option('mode', process.env.CLEANUP_MODE || 'DRY_RUN')).toUpperCase();
const cleanupRunId = option('cleanup-run-id', process.env.CLEANUP_RUN_ID || `cleanup_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`);
const performedBy = option('performed-by', process.env.CLEANUP_PERFORMED_BY || '');
const batchLimit = Math.max(1, Math.min(Number(option('batch-limit', process.env.CLEANUP_BATCH_LIMIT || 25)) || 25, 100));
const backupVerified = process.env.CLEANUP_BACKUP_VERIFIED === 'yes' || flag('backup-verified');
const url = process.env.CLEANUP_DATABASE_URL || process.env.DEDUPE_DATABASE_URL || process.env.DATABASE_URL || '';

if (!['REPORT_ONLY', 'DRY_RUN', 'EXECUTE_SAFE'].includes(mode)) {
  throw new Error('Use --mode REPORT_ONLY, DRY_RUN or EXECUTE_SAFE.');
}
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.log('Skipped: DATABASE_URL is not a PostgreSQL URL.');
  process.exit(0);
}

const parsedUrl = new URL(url);
const databaseLabel = {
  host: parsedUrl.hostname,
  database: parsedUrl.pathname.replace(/^\//, '') || '',
  ssl: /sslmode=require|neon\.tech/i.test(url)
};
const pool = new Pool({
  connectionString: url,
  ssl: databaseLabel.ssl ? { rejectUnauthorized: false } : undefined,
  max: mode === 'EXECUTE_SAFE' ? 2 : 4
});

const fmt = value => Number(value || 0).toLocaleString('en-GB');
const mdCell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);

async function tableExists(db, table) {
  const result = await db.query(`select to_regclass($1) is not null as exists`, [table]);
  return Boolean(result.rows[0]?.exists);
}

async function optionalCount(db, table, where = 'true') {
  if (!await tableExists(db, table)) return null;
  const result = await db.query(`select count(*)::int as n from ${table} where ${where}`);
  return Number(result.rows[0]?.n || 0);
}

async function schemaAudit(db) {
  const tables = (await db.query(`
    select table_name
    from information_schema.tables
    where table_schema = current_schema() and table_type = 'BASE TABLE'
    order by table_name
  `)).rows.map(row => row.table_name);
  const columns = (await db.query(`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = current_schema()
    order by table_name, ordinal_position
  `)).rows;
  const constraints = (await db.query(`
    select tc.table_name, tc.constraint_name, tc.constraint_type,
      kcu.column_name,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    from information_schema.table_constraints tc
    left join information_schema.key_column_usage kcu
      on tc.constraint_schema = kcu.constraint_schema and tc.constraint_name = kcu.constraint_name
    left join information_schema.constraint_column_usage ccu
      on tc.constraint_schema = ccu.constraint_schema and tc.constraint_name = ccu.constraint_name
    left join information_schema.referential_constraints rc
      on tc.constraint_schema = rc.constraint_schema and tc.constraint_name = rc.constraint_name
    where tc.table_schema = current_schema()
    order by tc.table_name, tc.constraint_name, kcu.ordinal_position
  `)).rows;
  const indexes = (await db.query(`
    select tablename as table_name, indexname as index_name, indexdef
    from pg_indexes
    where schemaname = current_schema()
    order by tablename, indexname
  `)).rows;
  const interesting = new Set([
    'app_leads', 'app_tasks', 'app_emails', 'app_applications', 'app_events', 'app_audit',
    'app_files', 'app_document_templates', 'app_attribution', 'app_zoho_records',
    'app_lead_external_ids', 'app_lead_merge_audit', 'app_marketing_recipients'
  ]);
  for (const row of columns) {
    if (/^(lead_id|contact_id|application_id|entity_id)$/i.test(row.column_name)) interesting.add(row.table_name);
    if (/external|zoho|gmail|zoom|eventbrite|meta|apollo/i.test(row.column_name)) interesting.add(row.table_name);
  }
  const counts = {};
  for (const table of [...interesting].filter(table => tables.includes(table)).sort()) {
    counts[table] = await optionalCount(db, table);
  }
  const columnsByTable = new Map();
  for (const row of columns) {
    if (!interesting.has(row.table_name)) continue;
    const list = columnsByTable.get(row.table_name) || [];
    list.push(row);
    columnsByTable.set(row.table_name, list);
  }
  const relationships = [];
  for (const [table, list] of columnsByTable.entries()) {
    for (const column of list) {
      const name = column.column_name;
      let parent = '';
      if (name === 'lead_id') parent = 'app_leads.id';
      if (name === 'contact_id') parent = 'contact entity';
      if (name === 'application_id') parent = 'app_applications.id';
      if (name === 'entity_id') parent = 'polymorphic entity id';
      if (/external|zoho|gmail|zoom|eventbrite|meta|apollo/i.test(name)) parent ||= 'external source identity';
      if (!parent) continue;
      const fk = constraints.find(item => item.constraint_type === 'FOREIGN KEY' && item.table_name === table && item.column_name === name);
      relationships.push({
        table,
        field: name,
        parent,
        behavior: fk ? `FK update ${fk.update_rule || 'NO ACTION'}, delete ${fk.delete_rule || 'NO ACTION'}` : 'No FK constraint found',
        count: counts[table] ?? ''
      });
    }
  }
  relationships.push({ table: 'app_events', field: 'attendees[].lead_id', parent: 'app_leads.id', behavior: 'JSON reference, no FK constraint', count: counts.app_events ?? '' });
  relationships.push({ table: 'app_workspace', field: 'meta.zoom.calls[].lead_id', parent: 'app_leads.id', behavior: 'JSON cache reference, no FK constraint', count: counts.app_workspace ?? '' });
  return { tables, columns, constraints, indexes, counts, relationships };
}

async function duplicateDryRun(db, softDelete) {
  const active = dedupe.activeLeadSql(softDelete);
  const summary = (await db.query(`
    select count(*)::int as total,
      count(*) filter (where ${active} and coalesce(trim(email), '') <> '')::int as with_email,
      count(*) filter (where ${active} and coalesce(trim(phone), '') <> '')::int as with_phone,
      count(*) filter (where ${active} and coalesce(data->>'zoho_record_id', '') <> '')::int as with_zoho,
      count(*) filter (where not (${active}))::int as inactive
    from app_leads
  `)).rows[0] || {};
  const groups = await dedupe.findDuplicateGroups(db, { softDelete });
  const actionable = groups.filter(group => group.classification !== 'DO_NOT_MERGE');
  const memberIds = [...new Set(actionable.flatMap(group => group.members.map(member => member.id)))];
  const rows = memberIds.length
    ? (await db.query(`select id, person_id, first_name, last_name, email, employer, phone, city, programme_id, programme, level, owner_id, owner, stage, priority, source_first_touch, source_lead_capture, contact_permission, created_at, next_action_at, data from app_leads where id = any($1::text[])`, [memberIds])).rows
    : [];
  const leadsById = new Map(rows.map(row => [row.id, dedupe.leadProfile(row)]));
  const counts = await dedupe.relationCounts(db, memberIds);
  const plans = actionable.map(group => dedupe.planMerge(group.members.map(member => leadsById.get(member.id)).filter(Boolean), counts, group));
  return {
    summary,
    groups,
    plans,
    auto: groups.filter(group => group.classification === 'AUTO_MERGE_SAFE'),
    review: groups.filter(group => group.classification === 'REVIEW_REQUIRED'),
    doNot: groups.filter(group => group.classification === 'DO_NOT_MERGE')
  };
}

async function orphanAudit(db) {
  const exists = async table => tableExists(db, table);
  const result = {};
  result.tasks = await optionalCount(db, 'app_tasks', `coalesce(lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = app_tasks.lead_id)`);
  result.emails = await optionalCount(db, 'app_emails', `coalesce(lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = app_emails.lead_id)`);
  result.applications = await optionalCount(db, 'app_applications', `coalesce(lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = app_applications.lead_id)`);
  result.attribution = await optionalCount(db, 'app_attribution', `coalesce(lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = app_attribution.lead_id)`);
  result.audit = await optionalCount(db, 'app_audit', `entity = 'lead' and coalesce(entity_id, '') <> '' and not exists (select 1 from app_leads l where l.id = app_audit.entity_id)`);
  result.marketing_recipients = await exists('app_marketing_recipients')
    ? await optionalCount(db, 'app_marketing_recipients', `coalesce(lead_id, '') <> '' and not exists (select 1 from app_leads l where l.id = app_marketing_recipients.lead_id)`)
    : null;
  result.meetings = await exists('app_events')
    ? Number((await db.query(`
      select count(*)::int as n
      from app_events e, jsonb_array_elements(case when jsonb_typeof(e.attendees) = 'array' then e.attendees else '[]'::jsonb end) x
      where coalesce(x->>'lead_id', '') <> '' and not exists (select 1 from app_leads l where l.id = x->>'lead_id')
    `)).rows[0]?.n || 0)
    : null;
  result.zoom_calls = await exists('app_workspace')
    ? Number((await db.query(`
      select count(*)::int as n
      from app_workspace w, jsonb_array_elements(case when jsonb_typeof(w.meta->'zoom'->'calls') = 'array' then w.meta->'zoom'->'calls' else '[]'::jsonb end) x
      where coalesce(x->>'lead_id', '') <> '' and not exists (select 1 from app_leads l where l.id = x->>'lead_id')
    `)).rows[0]?.n || 0)
    : null;
  return result;
}

async function normalizationAudit(db, softDelete) {
  const active = dedupe.activeLeadSql(softDelete);
  const stages = (await db.query(`
    select stage as value, trim(stage) as trimmed, initcap(lower(trim(stage))) as proposed, count(*)::int as count
    from app_leads
    where ${active} and coalesce(stage, '') <> ''
    group by stage
    order by count desc, value
  `)).rows;
  const fields = (await db.query(`
    select
      count(*) filter (where email is not null and trim(email) = '')::int as blank_email,
      count(*) filter (where phone is not null and trim(phone) = '')::int as blank_phone,
      count(*) filter (where first_name is not null and trim(first_name) = '')::int as blank_first_name,
      count(*) filter (where last_name is not null and trim(last_name) = '')::int as blank_last_name,
      count(*) filter (where owner_id is not null and trim(owner_id) = '')::int as blank_owner_id,
      count(*) filter (where programme_id is not null and trim(programme_id) = '')::int as blank_programme_id
    from app_leads
    where ${active}
  `)).rows[0] || {};
  const externalDuplicates = (await db.query(`
    select 'zoho_record_id' as field, data->>'zoho_record_id' as value, count(*)::int as count
    from app_leads where ${active} and coalesce(data->>'zoho_record_id', '') <> ''
    group by 1, 2 having count(*) > 1
    union all
    select 'eventbrite_attendee_id', data->>'eventbrite_attendee_id', count(*)::int
    from app_leads where ${active} and coalesce(data->>'eventbrite_attendee_id', '') <> ''
    group by 1, 2 having count(*) > 1
    union all
    select 'meta_lead_id', data->>'meta_lead_id', count(*)::int
    from app_leads where ${active} and coalesce(data->>'meta_lead_id', '') <> ''
    group by 1, 2 having count(*) > 1
    union all
    select 'apollo_person_id', data->>'apollo_person_id', count(*)::int
    from app_leads where ${active} and coalesce(data->>'apollo_person_id', '') <> ''
    group by 1, 2 having count(*) > 1
    order by field, count desc
  `)).rows;
  return { stages, fields, externalDuplicates };
}

function planSummary(plan) {
  return {
    master_id: plan.master_id,
    duplicate_ids: plan.duplicate_ids,
    confidence: plan.confidence,
    reason: plan.rule,
    fields_copied: plan.fields_filled.map(item => item.field),
    conflicting_fields: plan.conflicts.map(item => item.field),
    relationships_to_move: plan.relationships_to_move,
    external_ids_preserved: plan.external_ids.length
  };
}

async function executeSafe(pool, dryRun) {
  if (!backupVerified) throw new Error('EXECUTE_SAFE refused: backup/restore/branch strategy is not verified.');
  if (process.env.LEAD_DEDUPE_ALLOW_EXECUTE !== 'yes') throw new Error('EXECUTE_SAFE refused: set LEAD_DEDUPE_ALLOW_EXECUTE=yes.');
  if (!performedBy) throw new Error('EXECUTE_SAFE refused: pass --performed-by <email>.');
  const autoGroups = dryRun.groups.filter(group => group.classification === 'AUTO_MERGE_SAFE').slice(0, batchLimit);
  const results = [];
  for (const group of autoGroups) {
    const result = await dedupe.mergeLeadGroup(pool, group.members.map(member => member.id), {
      dryRun: false,
      groupKey: group.group_key,
      rule: group.rule,
      confidence: group.confidence,
      classification: group.classification,
      cleanupRunId,
      performedBy,
      expectedMasterId: dryRun.plans.find(plan => plan.group_key === group.group_key)?.master_id,
      reason: group.reasons.join('; ')
    });
    results.push({ group_key: group.group_key, master_id: result.plan.master_id, duplicate_ids: result.plan.duplicate_ids, moved: result.moved });
  }
  return results;
}

function writeRelationshipMap(schema) {
  const lines = [];
  lines.push('# Database Relationship Map');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} by \`npm run cleanup:step4 -- --mode ${mode}\`.`);
  lines.push('');
  lines.push('| Table | Reference field | Parent entity | Delete/update behavior | Record count |');
  lines.push('|---|---|---|---|---:|');
  for (const row of schema.relationships.sort((a, b) => a.table.localeCompare(b.table) || a.field.localeCompare(b.field))) {
    lines.push(`| ${mdCell(row.table)} | ${mdCell(row.field)} | ${mdCell(row.parent)} | ${mdCell(row.behavior)} | ${mdCell(row.count)} |`);
  }
  lines.push('');
  lines.push('## Foreign Keys');
  lines.push('');
  const fks = schema.constraints.filter(row => row.constraint_type === 'FOREIGN KEY');
  if (!fks.length) lines.push('No foreign keys were found for the inspected relationship columns.');
  else {
    lines.push('| Table | Column | References | ON UPDATE | ON DELETE |');
    lines.push('|---|---|---|---|---|');
    for (const fk of fks) lines.push(`| ${mdCell(fk.table_name)} | ${mdCell(fk.column_name)} | ${mdCell(`${fk.foreign_table_name}.${fk.foreign_column_name}`)} | ${mdCell(fk.update_rule)} | ${mdCell(fk.delete_rule)} |`);
  }
  lines.push('');
  lines.push('## Indexes');
  lines.push('');
  lines.push('| Table | Index | Definition |');
  lines.push('|---|---|---|');
  for (const index of schema.indexes.filter(row => schema.counts[row.table_name] !== undefined)) {
    lines.push(`| ${mdCell(index.table_name)} | ${mdCell(index.index_name)} | ${mdCell(index.indexdef)} |`);
  }
  fs.writeFileSync(path.join(root, 'DATABASE_RELATIONSHIP_MAP.md'), `${lines.join('\n')}\n`);
}

function writeDryRunReport(payload) {
  const { fingerprint, schemaReady, dryRun, orphans, normalization, executionResults } = payload;
  const reportPlans = dryRun.plans.map(planSummary);
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'database-cleanup-step4-dry-run.json'), JSON.stringify({ cleanup_run_id: cleanupRunId, mode, plans: reportPlans }, null, 2));

  const lines = [];
  lines.push('# Database Cleanup Step 4 Dry Run');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}.`);
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push(`- cleanup_run_id: \`${cleanupRunId}\``);
  lines.push(`- mode: \`${mode}\``);
  lines.push(`- database host: \`${fingerprint.host}\``);
  lines.push(`- database name: \`${fingerprint.database}\``);
  lines.push(`- database fingerprint: \`${fingerprint.fingerprint}\``);
  lines.push(`- production connection confirmed: ${/neon\.tech$/i.test(fingerprint.host) ? 'Neon host detected' : 'not proven by hostname'}`);
  lines.push(`- backup/restore verified: ${backupVerified ? 'yes, operator supplied CLEANUP_BACKUP_VERIFIED=yes' : 'no; EXECUTE_SAFE is blocked'}`);
  lines.push(`- merge schema applied: ${schemaReady ? 'yes' : 'no; execution is blocked until sql/2026-09-30_lead_dedupe.sql is applied'}`);
  lines.push('');
  lines.push('Restore method is not claimed as available unless a Neon branch/snapshot/restore point is verified outside this script. For production execution, create or confirm a Neon branch/snapshot first, record it beside this run id, then set `CLEANUP_BACKUP_VERIFIED=yes` only for the approved execution command.');
  lines.push('');
  lines.push('## Duplicate Classification');
  lines.push('');
  lines.push('| Class | Groups | Leads |');
  lines.push('|---|---:|---:|');
  for (const [label, groups] of [['AUTO_MERGE_SAFE', dryRun.auto], ['REVIEW_REQUIRED', dryRun.review], ['DO_NOT_MERGE', dryRun.doNot]]) {
    lines.push(`| ${label} | ${fmt(groups.length)} | ${fmt(new Set(groups.flatMap(group => group.members.map(member => member.id))).size)} |`);
  }
  lines.push('');
  lines.push('## Dry Run Plans');
  lines.push('');
  lines.push('| Group | Class | Rule | Master | Duplicates | Fields copied | Conflicts | Relationships moved |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const group of [...dryRun.auto, ...dryRun.review]) {
    const plan = dryRun.plans.find(item => item.group_key === group.group_key);
    const moves = Object.entries(plan.relationships_to_move).filter(([, n]) => n).map(([key, n]) => `${key}:${n}`).join(', ') || 'none';
    lines.push(`| ${group.group_key} | ${group.classification} | ${group.rule} | \`${plan.master_id}\` | ${plan.duplicate_ids.map(id => `\`${id}\``).join(' ')} | ${plan.fields_filled.map(item => item.field).join(', ') || 'none'} | ${plan.conflicts.map(item => item.field).join(', ') || 'none'} | ${moves} |`);
  }
  lines.push('');
  lines.push('## Orphan Audit');
  lines.push('');
  lines.push('| Relationship | Orphan count | Classification |');
  lines.push('|---|---:|---|');
  for (const [key, value] of Object.entries(orphans)) {
    lines.push(`| ${key} | ${value === null ? 'n/a' : fmt(value)} | ${Number(value || 0) ? 'REVIEW_REQUIRED' : 'none found'} |`);
  }
  lines.push('');
  lines.push('## Stage Normalization Candidates');
  lines.push('');
  lines.push('| Value | Count | Proposed normalized value |');
  lines.push('|---|---:|---|');
  for (const row of normalization.stages.slice(0, 50)) {
    const proposed = row.value === row.trimmed ? '' : row.trimmed;
    lines.push(`| ${mdCell(row.value)} | ${fmt(row.count)} | ${mdCell(proposed)} |`);
  }
  lines.push('');
  lines.push('## Blank String Audit');
  lines.push('');
  lines.push('| Field | Whitespace-only count |');
  lines.push('|---|---:|');
  for (const [key, value] of Object.entries(normalization.fields)) lines.push(`| ${key} | ${fmt(value)} |`);
  lines.push('');
  lines.push('## Duplicate External IDs');
  lines.push('');
  if (!normalization.externalDuplicates.length) lines.push('No duplicate active external IDs were found.');
  else {
    lines.push('| Field | Value hash | Count |');
    lines.push('|---|---|---:|');
    for (const row of normalization.externalDuplicates) lines.push(`| ${row.field} | ${hash(row.value)} | ${fmt(row.count)} |`);
  }
  lines.push('');
  lines.push('## Execution');
  lines.push('');
  if (mode !== 'EXECUTE_SAFE') lines.push('No records were changed. Run stayed in read-only reporting/dry-run mode.');
  else lines.push(`EXECUTE_SAFE merged ${executionResults.length} AUTO_MERGE_SAFE groups in this batch.`);
  fs.writeFileSync(path.join(root, 'DATABASE_CLEANUP_STEP4_DRY_RUN.md'), `${lines.join('\n')}\n`);
}

(async () => {
  const started = performance.now();
  const client = await pool.connect();
  try {
    await client.query(mode === 'EXECUTE_SAFE' ? 'begin transaction read only' : 'begin transaction read only');
    const dbInfo = (await client.query(`select current_database() as database, current_schema() as schema, current_user as user_name`)).rows[0] || {};
    const fingerprint = {
      ...databaseLabel,
      database: dbInfo.database || databaseLabel.database,
      schema: dbInfo.schema || 'public',
      fingerprint: hash(`${databaseLabel.host}|${dbInfo.database}|${dbInfo.schema}|${dbInfo.user_name}`)
    };
    const schema = await schemaAudit(client);
    const schemaReady = await dedupe.mergeSchemaReady(client);
    const dryRun = await duplicateDryRun(client, schemaReady);
    const orphans = await orphanAudit(client);
    const normalization = await normalizationAudit(client, schemaReady);
    await client.query('rollback');
    client.release();
    writeRelationshipMap(schema);

    let executionResults = [];
    if (mode === 'EXECUTE_SAFE') {
      executionResults = await executeSafe(pool, dryRun);
    }
    writeDryRunReport({ fingerprint, schemaReady, dryRun, orphans, normalization, executionResults });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(JSON.stringify({
      cleanup_run_id: cleanupRunId,
      mode,
      database: { host: fingerprint.host, database: fingerprint.database, fingerprint: fingerprint.fingerprint },
      backup_verified: backupVerified,
      merge_schema_ready: schemaReady,
      auto_merge_safe_groups: dryRun.auto.length,
      review_required_groups: dryRun.review.length,
      do_not_merge_groups: dryRun.doNot.length,
      executed_groups: executionResults.length,
      reports: ['DATABASE_RELATIONSHIP_MAP.md', 'DATABASE_CLEANUP_STEP4_DRY_RUN.md', 'reports/database-cleanup-step4-dry-run.json'],
      seconds: Number(seconds)
    }, null, 2));
  } catch (error) {
    await client.query('rollback').catch(() => null);
    client.release();
    throw error;
  } finally {
    await pool.end().catch(() => null);
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
