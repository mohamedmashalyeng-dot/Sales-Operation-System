// Measures and optionally applies the narrow index for the real Inbox Unanswered query.
process.env.NEST_COMPAT_MODE = 'true';
if (process.env.DIAGNOSE_SCHEMA_SETUP !== 'true') process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const { Pool } = require('pg');
const { performance } = require('perf_hooks');
const { __leadsTest, server } = require('../server.js');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

function planWalk(node, rows = []) {
  if (!node) return rows;
  rows.push(node);
  for (const child of node.Plans || []) planWalk(child, rows);
  return rows;
}

function planSummary(planJson) {
  const root = Array.isArray(planJson) ? planJson[0] : planJson;
  const nodes = planWalk(root?.Plan);
  const indexNodes = nodes.filter(node => node['Index Name']);
  const sortNodes = nodes.filter(node => /sort/i.test(String(node['Node Type'] || '')));
  return {
    planning_time_ms: Number(root?.['Planning Time'] || 0),
    execution_time_ms: Number(root?.['Execution Time'] || 0),
    rows_scanned: nodes.reduce((sum, node) => sum + Number(node['Actual Rows'] || 0), 0),
    rows_removed_by_filter: nodes.reduce((sum, node) => sum + Number(node['Rows Removed by Filter'] || 0), 0),
    index_used: indexNodes.map(node => node['Index Name']).filter(Boolean),
    heap_blocks: nodes.reduce((sum, node) => sum + Number(node['Heap Fetches'] || 0), 0),
    shared_hit_blocks: nodes.reduce((sum, node) => sum + Number(node['Shared Hit Blocks'] || 0), 0),
    shared_read_blocks: nodes.reduce((sum, node) => sum + Number(node['Shared Read Blocks'] || 0), 0),
    sort_method: sortNodes.map(node => node['Sort Method']).filter(Boolean),
    root_node: root?.Plan?.['Node Type'] || '',
    root_relation: root?.Plan?.['Relation Name'] || '',
    root_index: root?.Plan?.['Index Name'] || ''
  };
}

async function main() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL or POSTGRES_URL is required.');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    max: 2
  });
  const mode = process.argv[2] || 'all';
  const db = {};
  const filters = { status: 'Unanswered', label: '', search: '', day: '', dateField: 'received', sort: 'newest' };
  const query = __leadsTest.buildFilteredEmailPageQuery(db, filters, 50, null);
  const migrationSql = `
    create index concurrently if not exists app_emails_unanswered_page_idx
    on app_emails (received_at desc nulls last, id desc)
    where
      not ((coalesce(data->>'trashed_at', '') <> '' or coalesce(data->>'dashboard_folder', '') = 'trash' or coalesce(data->'gmail_labels', '[]'::jsonb) ? 'TRASH'))
      and not (coalesce(data->>'direction', '') = 'outbound')
      and response_at is null
  `;
  try {
    if (mode === 'apply-index' || mode === 'all') {
      const started = performance.now();
      await pool.query(migrationSql);
      console.log(JSON.stringify({ step: 'apply-index', duration_ms: Number((performance.now() - started).toFixed(1)), index: 'app_emails_unanswered_page_idx' }));
    }
    if (mode === 'explain' || mode === 'all' || mode === 'after') {
      const started = performance.now();
      const result = await pool.query(`explain (analyze, buffers, format json) ${query.sql}`, query.values);
      const observedMs = performance.now() - started;
      console.log(JSON.stringify({
        step: mode === 'after' ? 'after' : 'explain',
        observed_ms: Number(observedMs.toFixed(1)),
        query: {
          sql: query.sql,
          values: query.values,
          where: __leadsTest.emailFilterSql(db, filters).where,
          order: query.order,
          use_keyset: query.useKeyset
        },
        plan: planSummary(result.rows[0]?.['QUERY PLAN'])
      }, null, 2));
    }
  } finally {
    await pool.end().catch(() => null);
    try { server.close(); } catch {}
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  try { server.close(); } catch {}
  process.exit(1);
});
