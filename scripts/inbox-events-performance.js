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
const { server } = require('../server.js');

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
    req.setTimeout(30000, () => req.destroy(new Error(`${method} ${path} timed out`)));
    if (payload) req.write(payload);
    req.end();
  });
}

function timingValue(header, key) {
  const match = String(header || '').match(new RegExp(`(?:^|,\\s*)${key};dur=([0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function summarize(result) {
  return {
    path: result.path,
    status: result.status,
    duration_ms: result.duration_ms,
    node_total_ms: timingValue(result.server_timing, 'node-total'),
    auth_ms: timingValue(result.server_timing, 'auth'),
    db_acquire_ms: timingValue(result.server_timing, 'db-acquire'),
    emails_page_query_ms: timingValue(result.server_timing, 'emails-page-query'),
    email_filter_query_ms: timingValue(result.server_timing, 'email-filter-query'),
    events_page_query_ms: timingValue(result.server_timing, 'events-page-query'),
    bootstrap_query_ms: timingValue(result.server_timing, 'bootstrap-payload-query'),
    mapping_ms: timingValue(result.server_timing, 'mapping'),
    serialize_ms: timingValue(result.server_timing, 'serialize'),
    bytes: result.bytes,
    has_more: result.json?.has_more ?? result.json?.hasMore ?? null,
    item_count: Array.isArray(result.json?.items) ? result.json.items.length : Array.isArray(result.json?.emails) ? result.json.emails.length : Array.isArray(result.json?.events) ? result.json.events.length : null,
    server_timing: result.server_timing
  };
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
      '/api/bootstrap?debug_timing=true',
      '/api/emails?limit=50&status=Unanswered&label=All',
      '/api/events?limit=50',
      '/api/zoom/events?limit=100'
    ];
    console.log('individual');
    for (const path of paths) console.log(JSON.stringify(summarize(await request(baseUrl, path, { cookie }))));
    console.log('concurrent');
    const concurrent = await Promise.all(paths.slice(0, 3).map(path => request(baseUrl, path, { cookie })));
    concurrent.forEach(result => console.log(JSON.stringify(summarize(result))));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error.message);
  try { server.close(); } catch {}
  process.exit(1);
});
