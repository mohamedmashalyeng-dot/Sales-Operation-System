'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

function loadDotEnvIfNeeded() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL || !fs.existsSync('.env')) return;
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

function safeCursor(cursor = {}) {
  return {
    page: Number(cursor.page || 1),
    pageTokenPresent: Boolean(cursor.pageToken),
    done: Boolean(cursor.done),
    skipped: Boolean(cursor.skipped),
    modifiedSincePresent: Boolean(cursor.modifiedSince),
    lastPage: cursor.lastPage ? {
      page: Number(cursor.lastPage.page || 0),
      pageTokenPresent: Boolean(cursor.lastPage.pageToken),
      count: Number(cursor.lastPage.count || 0),
      nextPageTokenPresent: Boolean(cursor.lastPage.nextPageToken)
    } : null,
    seenPageSignatures: Array.isArray(cursor.seenPageSignatures) ? cursor.seenPageSignatures.length : 0
  };
}

async function main() {
  loadDotEnvIfNeeded();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    console.log(JSON.stringify({ storage: 'not-postgres', skipped: true }, null, 2));
    return;
  }
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
  try {
    async function exists(table) {
      const result = await pool.query(`select to_regclass($1) is not null as exists`, [table]);
      return Boolean(result.rows[0]?.exists);
    }
    if (!(await exists('app_zoho_records'))) {
      console.log(JSON.stringify({ storage: 'postgres', zoho_records_table: false }, null, 2));
      return;
    }
    const [totals, modules, duplicateKeys, duplicateExternalIds, jobs] = await Promise.all([
      pool.query(`
        select count(*)::int as local_rows,
               count(distinct key)::int as unique_keys,
               count(distinct module || ':' || zoho_id)::int as unique_external_ids
        from app_zoho_records
      `),
      pool.query(`
        select module, count(*)::int as local_rows, count(distinct zoho_id)::int as unique_external_ids
        from app_zoho_records
        group by module
        order by local_rows desc, module
      `),
      pool.query(`
        select count(*)::int as duplicate_key_groups
        from (select key from app_zoho_records group by key having count(*) > 1) d
      `),
      pool.query(`
        select module, count(*)::int as duplicate_external_id_groups
        from (
          select module, zoho_id
          from app_zoho_records
          where nullif(zoho_id, '') is not null
          group by module, zoho_id
          having count(*) > 1
        ) d
        group by module
        order by module
      `),
      (await exists('integration_jobs')) ? pool.query(`
        select id, connection_id, status, current_module, current_page, next_page_token is not null as next_page_token_present,
               records_scanned, records_added, records_updated, records_failed, modules_completed, modules_total,
               created_at, started_at, last_progress_at, completed_at, retry_after_at, last_error, state
        from integration_jobs
        where provider = 'zoho'
        order by updated_at desc
        limit 3
      `) : Promise.resolve({ rows: [] })
    ]);
    const latestJobs = jobs.rows.map(row => {
      const state = row.state || {};
      return {
        id: row.id,
        connection_id: row.connection_id,
        status: row.status,
        current_module: row.current_module,
        current_page: Number(row.current_page || 1),
        next_page_token_present: row.next_page_token_present,
        records_scanned: Number(row.records_scanned || 0),
        records_inserted: Number(row.records_added || 0),
        records_updated: Number(row.records_updated || 0),
        records_failed: Number(row.records_failed || 0),
        records_unchanged: Object.values(state.moduleResults || {}).reduce((sum, result) => sum + Number(result?.unchanged || 0), 0),
        modules_completed: Number(row.modules_completed || 0),
        modules_total: Number(row.modules_total || 0),
        created_at: row.created_at,
        started_at: row.started_at,
        last_progress_at: row.last_progress_at,
        completed_at: row.completed_at,
        retry_after_at: row.retry_after_at,
        last_error_summary: row.last_error ? String(row.last_error).slice(0, 200) : null,
        state: {
          mode: state.mode || null,
          batchSize: Number(state.batchSize || 0),
          modules: state.modules || [],
          cursors: Object.fromEntries(Object.entries(state.cursors || {}).map(([module, cursor]) => [module, safeCursor(cursor)])),
          moduleResults: state.moduleResults || {}
        }
      };
    });
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      storage: 'postgres',
      zoho_records_table: true,
      totals: totals.rows[0],
      by_module: modules.rows,
      by_connection: latestJobs.map(job => ({
        connection_id: job.connection_id,
        status: job.status,
        current_module: job.current_module,
        records_scanned: job.records_scanned,
        records_inserted: job.records_inserted,
        records_updated: job.records_updated,
        records_unchanged: job.records_unchanged
      })),
      duplicate_keys: duplicateKeys.rows[0],
      duplicate_external_ids: duplicateExternalIds.rows,
      latest_jobs: latestJobs,
      notes: [
        'Read-only diagnostic; no Zoho API calls are made.',
        'No record names, emails, phone numbers, or raw provider IDs are emitted.'
      ]
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
