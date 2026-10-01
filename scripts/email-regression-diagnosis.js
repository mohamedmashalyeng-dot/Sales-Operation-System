'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.API_PERF_TRACE = 'true';
process.env.API_DEBUG_ENDPOINTS = 'true';
if (process.env.DIAGNOSE_SCHEMA_SETUP !== 'true') process.env.SKIP_SCHEMA_SETUP = 'true';
if (process.env.DIAGNOSE_BACKGROUND_JOBS !== 'true') {
  process.env.ZOHO_SYNC_WORKER = 'false';
  process.env.ZOHO_AUTO_SYNC = 'false';
  process.env.GMAIL_AUTO_SYNC = 'false';
  process.env.EVENT_AUTO_SYNC = 'false';
  process.env.ZOOM_AUTO_SYNC = 'false';
}

const http = require('http');
const { performance } = require('perf_hooks');
const { Pool } = require('pg');
const { __leadsTest, server } = require('../server.js');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const EXACT_PATH = process.env.EMAIL_DIAG_EXACT_PATH || '/api/emails?limit=50&status=Unanswered&label=All&date_filter=received&sort=newest';

function request(baseUrl, path, { method = 'GET', cookie = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const started = performance.now();
    const req = http.request(new URL(path, baseUrl), {
      method,
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({
          path,
          status: res.statusCode,
          duration_ms: Number((performance.now() - started).toFixed(1)),
          bytes: Buffer.byteLength(text),
          server_timing: res.headers['server-timing'] || '',
          set_cookie: res.headers['set-cookie'] || [],
          json,
          text
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(65000, () => req.destroy(new Error(`${method} ${path} timed out`)));
    if (payload) req.write(payload);
    req.end();
  });
}

function timingValue(header, key) {
  const match = String(header || '').match(new RegExp(`(?:^|,\\s*)${key};dur=([0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function timingDesc(header, key) {
  const match = String(header || '').match(new RegExp(`(?:^|,\\s*)${key};dur=[0-9.]+;desc="([^"]*)"`));
  return match ? match[1] : '';
}

function summarize(result, label) {
  return {
    label,
    path: result.path,
    status: result.status,
    duration_ms: result.duration_ms,
    node_total_ms: timingValue(result.server_timing, 'node-total'),
    auth_ms: timingValue(result.server_timing, 'auth'),
    db_acquire_ms: timingValue(result.server_timing, 'db-acquire'),
    emails_page_query_ms: timingValue(result.server_timing, 'emails-page-query'),
    email_filter_query_ms: timingValue(result.server_timing, 'email-filter-query'),
    fallback_query_ms: timingValue(result.server_timing, 'fallback-query'),
    secondary_query_ms: timingValue(result.server_timing, 'secondary-query'),
    gmail_state_query_ms: timingValue(result.server_timing, 'gmail-state-query'),
    mapping_ms: timingValue(result.server_timing, 'mapping'),
    serialize_ms: timingValue(result.server_timing, 'serialize'),
    email_path: timingDesc(result.server_timing, 'email-path'),
    count: Array.isArray(result.json?.emails) ? result.json.emails.length : null,
    has_more: result.json?.has_more ?? null,
    bytes: result.bytes,
    server_timing: result.server_timing
  };
}

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
    shared_hit_blocks: nodes.reduce((sum, node) => sum + Number(node['Shared Hit Blocks'] || 0), 0),
    shared_read_blocks: nodes.reduce((sum, node) => sum + Number(node['Shared Read Blocks'] || 0), 0),
    sort_method: sortNodes.map(node => node['Sort Method']).filter(Boolean),
    root_node: root?.Plan?.['Node Type'] || '',
    root_relation: root?.Plan?.['Relation Name'] || '',
    root_index: root?.Plan?.['Index Name'] || ''
  };
}

function pathOptions(path) {
  const url = new URL(path, 'http://localhost');
  return Object.fromEntries(['cursor', 'limit', 'status', 'label', 'search', 'day', 'date_field', 'date_filter', 'dateField', 'sort', 'include_total', 'owner', 'owner_id', 'folder']
    .map(name => [name, url.searchParams.get(name)]));
}

async function explainExactPath() {
  if (!DATABASE_URL) return { skipped: 'DATABASE_URL is not set' };
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    max: 2
  });
  try {
    const options = pathOptions(EXACT_PATH);
    const filters = __leadsTest.normalizeEmailPageOptions(options);
    const sqlCapable = __leadsTest.emailFiltersSqlCapable(filters);
    const activity = await pool.query(`
      select wait_event_type, wait_event, state, count(*)::int as connections
      from pg_stat_activity
      where datname = current_database()
      group by wait_event_type, wait_event, state
      order by connections desc, state nulls last
    `).catch(error => ({ rows: [{ error: error.message }] }));
    if (!sqlCapable) {
      return { sql_capable: false, filters, activity: activity.rows };
    }
    const query = __leadsTest.buildFilteredEmailPageQuery({}, filters, Math.max(1, Math.min(Number(options.limit || 50), 100)), null);
    await pool.query(`set statement_timeout = '${Number(process.env.EMAIL_LIST_STATEMENT_TIMEOUT_MS || 5000)}ms'`);
    const started = performance.now();
    const result = await pool.query(`explain (analyze, buffers, format json) ${query.sql}`, query.values);
    return {
      sql_capable: true,
      observed_ms: Number((performance.now() - started).toFixed(1)),
      filters,
      query: {
        where: query.where,
        order: query.order,
        use_keyset: query.useKeyset,
        page_limit: query.pageLimit,
        sql: query.sql,
        values: query.values
      },
      plan: planSummary(result.rows[0]?.['QUERY PLAN']),
      activity: activity.rows
    };
  } finally {
    await pool.end().catch(() => null);
  }
}

(async () => {
  const email = process.env.DEV_PANEL_EMAIL || process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password || /change-this|replace-with/i.test(password)) throw new Error('Set DEV_PANEL_EMAIL and DEV_PANEL_PASSWORD or INITIAL_ADMIN_* for diagnostics.');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await request(baseUrl, '/api/login', { method: 'POST', body: { email, password } });
    if (login.status !== 200) throw new Error(`Login failed ${login.status}: ${login.text}`);
    const cookie = String(login.set_cookie[0] || '').split(';')[0];
    const paths = [
      ['A no filters', '/api/emails?limit=50'],
      ['B status only', '/api/emails?limit=50&status=Unanswered'],
      ['C status + label', '/api/emails?limit=50&status=Unanswered&label=All'],
      ['D exact', EXACT_PATH]
    ];
    console.log(JSON.stringify({ step: 'matrix_start', exact_path: EXACT_PATH }));
    for (const [label, path] of paths) {
      console.log(JSON.stringify(summarize(await request(baseUrl, path, { cookie }), label)));
    }
    console.log(JSON.stringify({ step: 'explain_exact', explain: await explainExactPath() }, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  try { server.close(); } catch {}
  process.exit(1);
});
