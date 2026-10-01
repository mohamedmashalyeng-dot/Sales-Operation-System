// End-to-end latency diagnosis for the small startup APIs.
// Starts the local server on a random port, signs in with env credentials, then measures
// first/warm/concurrent GETs. It prints Server-Timing and safe DB metadata only.
process.env.NEST_COMPAT_MODE = 'true';
process.env.API_PERF_TRACE = 'true';
process.env.API_DEBUG_ENDPOINTS = 'true';
if (process.env.DIAGNOSE_SCHEMA_SETUP !== 'true') process.env.SKIP_SCHEMA_SETUP = 'true';
const disableBackgroundJobs = process.env.DIAGNOSE_BACKGROUND_JOBS !== 'true';
if (disableBackgroundJobs) {
  process.env.ZOHO_SYNC_WORKER = 'false';
  process.env.ZOHO_AUTO_SYNC = 'false';
  process.env.GMAIL_AUTO_SYNC = 'false';
  process.env.EVENT_AUTO_SYNC = 'false';
  process.env.ZOOM_AUTO_SYNC = 'false';
}

const http = require('http');
const { performance } = require('perf_hooks');
const { server, __leadsTest, startAutoSync } = require('../server.js');

function request(baseUrl, path, { method = 'GET', cookie = '', body = null, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : '';
    const started = performance.now();
    const req = http.request(url, {
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
          method,
          path,
          status: res.statusCode,
          duration_ms: performance.now() - started,
          bytes: Buffer.byteLength(text),
          server_timing: res.headers['server-timing'] || '',
          set_cookie: res.headers['set-cookie'] || [],
          json,
          text
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${method} ${path} timed out after ${timeoutMs}ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function summarize(result) {
  const nodeTotal = String(result.server_timing || '').match(/(?:^|,\s*)node-total;dur=([0-9.]+)/);
  return {
    path: result.path,
    status: result.status,
    duration_ms: Number(result.duration_ms.toFixed(1)),
    node_total_header_ms: nodeTotal ? Number(nodeTotal[1]) : null,
    bytes: result.bytes,
    server_timing: result.server_timing,
    timings: result.json?.timings || null,
    debug_timings: result.json?._debug?.timings || null,
    counters: result.json?._debug?.counters || null,
    query_breakdown: result.json?._debug?.queries || null,
    event_loop: result.json?.event_loop || null
  };
}

async function measure(label, baseUrl, cookie, path) {
  const result = await request(baseUrl, path, { cookie });
  console.log(`${label}: ${JSON.stringify(summarize(result))}`);
  return result;
}

async function measureSeries(label, baseUrl, cookie, path, count = Number(process.env.DIAGNOSE_SERIES_COUNT || 5)) {
  const results = [];
  for (let index = 1; index <= count; index += 1) {
    results.push(await measure(`${label} #${index}`, baseUrl, cookie, path));
  }
  return results;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const email = process.env.DEV_PANEL_EMAIL || process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password || /change-this|replace-with/i.test(password)) {
    throw new Error('Set DEV_PANEL_EMAIL and DEV_PANEL_PASSWORD (or INITIAL_ADMIN_*) in your local env before running this diagnosis.');
  }

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (!disableBackgroundJobs) startAutoSync();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    console.log(`DB metadata: ${JSON.stringify(__leadsTest.databaseSafeMetadata())}`);
    console.log(`Background jobs disabled: ${disableBackgroundJobs}`);
    const login = await request(baseUrl, '/api/login', { method: 'POST', body: { email, password } });
    if (login.status !== 200) throw new Error(`Login failed (${login.status}): ${login.text}`);
    const cookie = String(login.set_cookie[0] || '').split(';')[0];
    if (!cookie) throw new Error('Login did not return a session cookie.');

    console.log('\n== Baseline health and debug ping ==');
    await measure('health', baseUrl, '', '/api/health');
    await measureSeries('debug ping', baseUrl, '', '/api/debug/ping?reset_event_loop=true');
    await measureSeries('db ping', baseUrl, cookie, '/api/debug/db-ping?reset_event_loop=true');

    console.log('\n== Sequential /api/bootstrap ==');
    await measureSeries('bootstrap', baseUrl, cookie, '/api/bootstrap?debug_timing=true');

    console.log('\n== Sequential /api/leads?limit=100 ==');
    await measureSeries('leads', baseUrl, cookie, '/api/leads?limit=100');
    await measure('leads no total', baseUrl, cookie, '/api/leads?limit=100&include_total=false');

    console.log('\n== Sequential remaining page APIs ==');
    const bounds = (() => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return new URLSearchParams({
        today_start: start.toISOString(),
        tomorrow_start: new Date(start.getTime() + 86400000).toISOString()
      }).toString();
    })();
    await measureSeries('emails all', baseUrl, cookie, '/api/emails?limit=50');
    const unansweredFirst = await measure('emails unanswered first', baseUrl, cookie, '/api/emails?status=Unanswered&limit=50');
    if (unansweredFirst.json?.next_cursor) {
      await measure('emails unanswered second page', baseUrl, cookie, `/api/emails?status=Unanswered&limit=50&cursor=${encodeURIComponent(unansweredFirst.json.next_cursor)}`);
    }
    await measureSeries('emails search', baseUrl, cookie, '/api/emails?status=All&search=apprentice&limit=50');
    await measureSeries('tasks overdue', baseUrl, cookie, `/api/tasks?status=open&bucket=overdue&limit=80&include_counts=true&${bounds}`);
    await measureSeries('applications', baseUrl, cookie, '/api/applications?limit=50');
    await measureSeries('meetings', baseUrl, cookie, '/api/meetings?limit=50');
    await measureSeries('contacts', baseUrl, cookie, '/api/contacts?limit=100');

    const repeatWaitMs = Number(process.env.DIAGNOSE_REPEAT_WAIT_MS || 60000);
    if (repeatWaitMs > 0) {
      console.log(`\n== Sequential ping/db/leads after ${Math.round(repeatWaitMs / 1000)}s idle ==`);
      await wait(repeatWaitMs);
      await measureSeries('debug ping idle', baseUrl, '', '/api/debug/ping?reset_event_loop=true');
      await measureSeries('db ping idle', baseUrl, cookie, '/api/debug/db-ping?reset_event_loop=true');
      await measureSeries('leads idle', baseUrl, cookie, '/api/leads?limit=100');
      await measureSeries('bootstrap idle', baseUrl, cookie, '/api/bootstrap?debug_timing=true');
    }

    const longIdleMs = Number(process.env.DIAGNOSE_LONG_IDLE_MS || 0);
    if (longIdleMs > 0) {
      console.log(`\n== Sequential ping/db/leads after ${Math.round(longIdleMs / 1000)}s idle ==`);
      await wait(longIdleMs);
      await measureSeries('debug ping long idle', baseUrl, '', '/api/debug/ping?reset_event_loop=true');
      await measureSeries('db ping long idle', baseUrl, cookie, '/api/debug/db-ping?reset_event_loop=true');
      await measureSeries('leads long idle', baseUrl, cookie, '/api/leads?limit=100');
      await measureSeries('bootstrap long idle', baseUrl, cookie, '/api/bootstrap?debug_timing=true');
    }

    const authCacheWaitMs = Number(process.env.DIAGNOSE_AUTH_CACHE_WAIT_MS || 0);
    if (authCacheWaitMs > 0) {
      console.log(`\n== Concurrent bootstrap + leads after auth cache wait ${Math.round(authCacheWaitMs / 1000)}s ==`);
      await wait(authCacheWaitMs);
      const [bootstrapExpired, leadsExpired] = await Promise.all([
        request(baseUrl, '/api/bootstrap?debug_timing=true', { cookie }),
        request(baseUrl, '/api/leads?limit=100&debug_timing=true', { cookie })
      ]);
      console.log(`bootstrap auth-expired concurrent: ${JSON.stringify(summarize(bootstrapExpired))}`);
      console.log(`leads auth-expired concurrent: ${JSON.stringify(summarize(leadsExpired))}`);
    }

    console.log('\n== Concurrent bootstrap + leads ==');
    const [bootstrap, leads] = await Promise.all([
      request(baseUrl, '/api/bootstrap?debug_timing=true', { cookie }),
      request(baseUrl, '/api/leads?limit=100&debug_timing=true', { cookie })
    ]);
    console.log(`bootstrap concurrent: ${JSON.stringify(summarize(bootstrap))}`);
    console.log(`leads concurrent: ${JSON.stringify(summarize(leads))}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().then(() => {
  process.exit(0);
}).catch(error => {
  console.error(error.stack || error.message);
  try { server.close(); } catch {}
  process.exit(1);
});
