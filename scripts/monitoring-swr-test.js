process.env.NEST_COMPAT_MODE = process.env.NEST_COMPAT_MODE || 'true';
const fs = require('fs');
const http = require('http');
const { Pool } = require('pg');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

process.env.ZOHO_SYNC_WORKER = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const server = require('../server.js').__leadsTest;
const base = process.env.MONITORING_TEST_BASE || 'http://127.0.0.1:3107';
const email = process.env.DEV_PANEL_EMAIL || process.env.INITIAL_ADMIN_EMAIL;
const password = process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const body = options.body ? JSON.stringify(options.body) : null;
    const headers = {};
    if (body) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    if (options.cookie) headers.cookie = options.cookie;
    const started = Date.now();
    const req = http.request(url, { method: options.method || 'GET', headers, agent: false }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(text); } catch {}
        resolve({
          status: res.statusCode,
          duration_ms: Date.now() - started,
          headers: res.headers,
          text,
          json
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(options.timeout_ms || 20000, () => {
      req.destroy(new Error(`Request timed out: ${path}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasTiming(response, name) {
  return String(response.headers['server-timing'] || '').includes(name);
}

function usedSnapshotHotPath(response) {
  return hasTiming(response, 'monitoring-snapshot-read-query')
    || hasTiming(response, 'monitoring-snapshot-memory-cache')
    || hasTiming(response, 'monitoring-snapshot-read-join')
    || hasTiming(response, 'snapshot-read');
}

function todayBounds() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  return { todayStart: today.toISOString(), tomorrowStart: tomorrow.toISOString() };
}

function snapshotKey(bounds) {
  return `main:${bounds.todayStart}:${bounds.tomorrowStart}`;
}

async function login() {
  const response = await request('/api/login', { method: 'POST', body: { email, password } });
  const cookie = String((response.headers['set-cookie'] || [])[0] || '').split(';')[0];
  assert(cookie, `Login failed (${response.status}).`);
  return cookie;
}

async function explainSnapshotSelect(pool, key) {
  const result = await pool.query(
    `explain (analyze, buffers, format json)
     select data, generated_at, refreshed_at, expires_at, last_refresh_attempt_at, last_refresh_error, last_successful_refresh_at, refresh_lock_until
     from app_monitoring_snapshot
     where id = $1
     limit 1`,
    [key]
  );
  const plan = result.rows[0]['QUERY PLAN'][0];
  const indexes = new Set();
  function walk(node) {
    if (!node) return;
    if (node['Index Name']) indexes.add(node['Index Name']);
    for (const child of node.Plans || []) walk(child);
  }
  walk(plan.Plan);
  return {
    planning_time_ms: plan['Planning Time'],
    execution_time_ms: plan['Execution Time'],
    indexes_used: [...indexes]
  };
}

(async () => {
  const bounds = todayBounds();
  const key = snapshotKey(bounds);
  const query = `?today_start=${encodeURIComponent(bounds.todayStart)}&tomorrow_start=${encodeURIComponent(bounds.tomorrowStart)}`;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|neon\.tech/i.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000
  });

  try {
    await server.refreshMonitoringSnapshotDb({ today_start: bounds.todayStart, tomorrow_start: bounds.tomorrowStart });
    const cookie = await login();

    const fresh = await request(`/api/dashboard/monitoring${query}`, { cookie });
    assert(fresh.status === 200, 'fresh snapshot request did not return 200');
    assert(usedSnapshotHotPath(fresh), 'fresh request did not use snapshot hot path');
    assert(!hasTiming(fresh, 'monitoring-main-query'), 'fresh request ran monitoring_main');

    await pool.query(
      `update app_monitoring_snapshot
       set refreshed_at = now() - interval '5 minutes',
           expires_at = now() - interval '1 second',
           refresh_lock_until = null
       where id = $1`,
      [key]
    );
    await delay(1300);
    const stale = await request(`/api/dashboard/monitoring${query}`, { cookie });
    assert(stale.status === 200, 'stale snapshot request did not return 200');
    assert(usedSnapshotHotPath(stale), 'stale request did not use snapshot hot path');
    assert(!hasTiming(stale, 'monitoring-main-query'), 'stale request ran monitoring_main in the foreground');
    assert(stale.json?._snapshot?.stale === true, 'stale metadata was not returned');

    await server.refreshMonitoringSnapshotDb({ today_start: bounds.todayStart, tomorrow_start: bounds.tomorrowStart });
    await pool.query(
      `update app_monitoring_snapshot
       set refreshed_at = now() - interval '5 minutes',
           expires_at = now() - interval '1 second',
           refresh_lock_until = null
       where id = $1`,
      [key]
    );
    await delay(1300);
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => request(`/api/dashboard/monitoring${query}`, { cookie }))
    );
    assert(concurrent.every(response => response.status === 200), 'not all concurrent stale requests returned 200');
    assert(concurrent.every(response => usedSnapshotHotPath(response)), 'not all concurrent stale requests used snapshot hot path');
    assert(concurrent.every(response => !hasTiming(response, 'monitoring-main-query')), 'a concurrent stale request ran monitoring_main in the foreground');

    await pool.query(`delete from app_monitoring_snapshot where id = $1`, [key]);
    await delay(1300);
    const missing = await request(`/api/dashboard/monitoring${query}`, { cookie });
    assert(missing.status === 200, 'missing snapshot fallback did not return 200');
    assert(hasTiming(missing, 'monitoring-main-query'), 'missing snapshot did not run monitoring_main fallback');
    assert(hasTiming(missing, 'monitoring-snapshot-write-query'), 'missing snapshot did not write a new snapshot');

    const explain = await explainSnapshotSelect(pool, key);
    console.log(JSON.stringify({
      ok: true,
      fresh: {
        duration_ms: fresh.duration_ms,
        server_timing: fresh.headers['server-timing']
      },
      stale: {
        duration_ms: stale.duration_ms,
        server_timing: stale.headers['server-timing'],
        snapshot: stale.json._snapshot
      },
      concurrent_stale: {
        count: concurrent.length,
        max_duration_ms: Math.max(...concurrent.map(response => response.duration_ms)),
        foreground_monitoring_main_count: concurrent.filter(response => hasTiming(response, 'monitoring-main-query')).length
      },
      missing: {
        duration_ms: missing.duration_ms,
        server_timing: missing.headers['server-timing']
      },
      snapshot_select_explain: explain
    }, null, 2));
  } finally {
    await pool.end();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
