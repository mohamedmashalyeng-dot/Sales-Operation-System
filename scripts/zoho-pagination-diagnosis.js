'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.ZOHO_SYNC_WORKER = 'false';

const Storage = require('../server/storage');
const State = require('../server/state');

function cursorSummary(cursor = {}) {
  return {
    page: cursor.page || null,
    pageTokenPresent: Boolean(cursor.pageToken),
    done: Boolean(cursor.done),
    skipped: Boolean(cursor.skipped),
    modifiedSince: cursor.modifiedSince || null,
    lastPage: cursor.lastPage ? {
      page: cursor.lastPage.page || null,
      pageTokenPresent: Boolean(cursor.lastPage.pageToken),
      count: Number(cursor.lastPage.count || 0),
      firstIdPresent: Boolean(cursor.lastPage.firstId),
      lastIdPresent: Boolean(cursor.lastPage.lastId),
      nextPageTokenPresent: Boolean(cursor.lastPage.nextPageToken)
    } : null,
    seenPageSignatures: Array.isArray(cursor.seenPageSignatures) ? cursor.seenPageSignatures.length : 0,
    seenIdRanges: Array.isArray(cursor.seenIdRanges) ? cursor.seenIdRanges.length : 0
  };
}

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool) throw new Error('PostgreSQL storage is not active.');
  const q = (sql, params = []) => State.postgresPool.query(sql, params);
  const table = await q(`select to_regclass('app_zoho_records') as table_name`);
  const output = { table_exists: Boolean(table.rows[0]?.table_name) };
  if (output.table_exists) {
    const columns = await q(`
      select column_name
      from information_schema.columns
      where table_name = 'app_zoho_records'
    `);
    const hasConnectionId = columns.rows.some(row => row.column_name === 'connection_id');
    const byConnectionSql = hasConnectionId ? `
        select
          connection_id,
          count(*)::int as rows,
          count(distinct concat(module, ':', zoho_id))::int as distinct_module_zoho_ids
        from app_zoho_records
        group by connection_id
        order by rows desc
      ` : `
        select
          'main' as connection_id,
          count(*)::int as rows,
          count(distinct concat(module, ':', zoho_id))::int as distinct_module_zoho_ids
        from app_zoho_records
      `;
    const [totals, byModule, byConnection, duplicateModuleExternalIds, duplicateExternalIds, jobs, workspace] = await Promise.all([
      q(`
        select
          count(*)::int as rows,
          count(distinct key)::int as distinct_keys,
          count(distinct concat(module, ':', zoho_id))::int as distinct_module_zoho_ids,
          count(distinct zoho_id)::int as distinct_zoho_ids
        from app_zoho_records
      `),
      q(`
        select
          module,
          count(*)::int as rows,
          count(distinct zoho_id)::int as distinct_zoho_ids,
          min(synced_at) as first_synced_at,
          max(synced_at) as last_synced_at
        from app_zoho_records
        group by module
        order by rows desc, module
      `),
      q(byConnectionSql),
      q(`
        select module, zoho_id, count(*)::int as rows
        from app_zoho_records
        group by module, zoho_id
        having count(*) > 1
        order by rows desc, module
        limit 20
      `),
      q(`
        select zoho_id, count(*)::int as rows, array_agg(distinct module order by module) as modules
        from app_zoho_records
        group by zoho_id
        having count(*) > 1
        order by rows desc
        limit 20
      `),
      q(`
        select id, status, current_module, current_page, next_page_token,
               records_scanned, records_added, records_updated, records_failed,
               created_at, started_at, completed_at, last_progress_at, last_error, state
        from integration_jobs
        where provider = 'zoho'
        order by updated_at desc
        limit 5
      `),
      q(`select meta->'zoho' as zoho from app_workspace where id = 'main'`)
    ]);
    const zoho = workspace.rows[0]?.zoho || {};
    output.totals = totals.rows[0] || {};
    output.by_module = byModule.rows;
    output.by_connection = byConnection.rows;
    output.duplicate_module_external_ids = {
      count: duplicateModuleExternalIds.rowCount,
      sample: duplicateModuleExternalIds.rows.map(row => ({ module: row.module, rows: row.rows }))
    };
    output.duplicate_external_ids_across_modules = {
      count: duplicateExternalIds.rowCount,
      sample: duplicateExternalIds.rows.map(row => ({ rows: row.rows, modules: row.modules }))
    };
    output.workspace_zoho = {
      last_sync_at: zoho.last_sync_at || null,
      initial_sync_completed_at: zoho.initial_sync_completed_at || null,
      sync_marks: Object.keys(zoho.sync_marks || {}).length,
      imported_record_ids: Array.isArray(zoho.imported_record_ids) ? zoho.imported_record_ids.length : 0
    };
    output.latest_jobs = jobs.rows.map(job => ({
      id: job.id,
      status: job.status,
      current_module: job.current_module || null,
      current_page: job.current_page || null,
      next_page_token_present: Boolean(job.next_page_token),
      records_scanned: Number(job.records_scanned || 0),
      records_added: Number(job.records_added || 0),
      records_updated: Number(job.records_updated || 0),
      records_failed: Number(job.records_failed || 0),
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      last_progress_at: job.last_progress_at,
      last_error: job.last_error ? String(job.last_error).slice(0, 240) : null,
      state: {
        mode: job.state?.mode || null,
        modules: job.state?.modules || [],
        moduleResults: job.state?.moduleResults || {},
        cursors: Object.fromEntries(Object.entries(job.state?.cursors || {}).map(([moduleName, cursor]) => [
          moduleName,
          cursorSummary(cursor)
        ]))
      }
    }));
  }
  console.log(JSON.stringify(output, null, 2));
})()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (State.postgresPool) await State.postgresPool.end().catch(() => {});
  });
