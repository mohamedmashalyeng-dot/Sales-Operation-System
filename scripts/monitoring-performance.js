const fs = require('fs');
const { performance } = require('perf_hooks');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

process.env.NEST_COMPAT_MODE = 'true';
process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const { Pool } = require('pg');
const server = require('../server.js').__leadsTest;

function walkPlan(node, acc = { indexes: new Set(), nodes: [], shared_hit_blocks: 0, shared_read_blocks: 0 }) {
  if (!node) return acc;
  acc.nodes.push({
    node_type: node['Node Type'],
    relation: node['Relation Name'] || '',
    index: node['Index Name'] || '',
    actual_rows: node['Actual Rows'],
    actual_loops: node['Actual Loops']
  });
  if (node['Index Name']) acc.indexes.add(node['Index Name']);
  acc.shared_hit_blocks += Number(node['Shared Hit Blocks'] || 0);
  acc.shared_read_blocks += Number(node['Shared Read Blocks'] || 0);
  for (const child of node.Plans || []) walkPlan(child, acc);
  return acc;
}

(async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const trace = { route: '/api/monitoring', started_at: performance.now(), stages: [], counters: {} };
  const started = performance.now();
  const payload = await server.loadDashboardMonitoringDb({
    today_start: today.toISOString(),
    tomorrow_start: tomorrow.toISOString(),
    force_refresh: true
  }, trace);
  const nodeTotalMs = Number((performance.now() - started).toFixed(1));
  const query = trace.stages.find(stage => stage.name === 'monitoring_main_query');
  if (!query?.sql_full) throw new Error('monitoring_main_query was not captured.');
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|neon\.tech/i.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000
  });
  try {
    const explain = await pool.query(`explain (analyze, buffers, format json) ${query.sql_full}`, query.params || []);
    const plan = explain.rows[0]['QUERY PLAN'][0];
    const summary = walkPlan(plan.Plan);
    console.log(JSON.stringify({
      node_total_ms: nodeTotalMs,
      payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
      query_name: query.query_name,
      query_duration_ms: Number(Number(query.ms || 0).toFixed(1)),
      returned_rows: query.rows,
      explain: {
        planning_time_ms: plan['Planning Time'],
        execution_time_ms: plan['Execution Time'],
        indexes_used: [...summary.indexes],
        shared_hit_blocks: summary.shared_hit_blocks,
        shared_read_blocks: summary.shared_read_blocks,
        top_nodes: summary.nodes.slice(0, 20)
      },
      server_timing_parts: trace.stages.map(stage => ({
        name: stage.name,
        duration_ms: Number(Number(stage.ms || 0).toFixed(1)),
        rows: stage.rows
      }))
    }, null, 2));
  } finally {
    await pool.end();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
