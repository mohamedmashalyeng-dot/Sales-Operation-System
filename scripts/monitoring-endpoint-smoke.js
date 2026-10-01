process.env.NEST_COMPAT_MODE = process.env.NEST_COMPAT_MODE || 'true';
const fs = require('fs');
const http = require('http');

if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const base = process.env.MONITORING_TEST_BASE || 'http://127.0.0.1:3107';
const email = process.env.DEV_PANEL_EMAIL || process.env.INITIAL_ADMIN_EMAIL;
const password = process.env.DEV_PANEL_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;

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
    const req = http.request(url, { method: options.method || 'GET', headers }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const login = await request('/api/login', { method: 'POST', body: { email, password } });
  const cookie = String((login.headers['set-cookie'] || [])[0] || '').split(';')[0];
  if (!cookie) throw new Error(`Login failed (${login.status}).`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const query = `?today_start=${encodeURIComponent(today.toISOString())}&tomorrow_start=${encodeURIComponent(tomorrow.toISOString())}`;
  for (const endpoint of ['/api/monitoring', '/api/dashboard/monitoring']) {
    const started = Date.now();
    const response = await request(`${endpoint}${query}`, { cookie });
    let parsed = {};
    try { parsed = JSON.parse(response.text); } catch {}
    console.log(JSON.stringify({
      endpoint,
      status: response.status,
      duration_ms: Date.now() - started,
      bytes: response.text.length,
      server_timing: response.headers['server-timing'] || '',
      error: parsed.error || '',
      keys: Object.keys(parsed).slice(0, 8)
    }, null, 2));
  }
  const invalid = await request('/api/monitoring?today_start=bad-date', { cookie });
  console.log(JSON.stringify({
    endpoint: '/api/monitoring?today_start=bad-date',
    status: invalid.status,
    body: invalid.text.slice(0, 160)
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
