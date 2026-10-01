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

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { server } = require('../server.js');

const EXACT_PATH = process.env.EMAIL_DIAG_EXACT_PATH || '/api/emails?limit=50&status=Unanswered&label=All&date_filter=received&sort=newest';
const APP_BUILD_ID = '20261001-inbox-local-rootcause';

function request(baseUrl, route, { method = 'GET', cookie = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const started = performance.now();
    const req = http.request(new URL(route, baseUrl), {
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
        resolve({
          status: res.statusCode,
          duration_ms: Number((performance.now() - started).toFixed(1)),
          set_cookie: res.headers['set-cookie'] || [],
          server_timing: res.headers['server-timing'] || '',
          text
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(65000, () => req.destroy(new Error(`${method} ${route} timed out`)));
    if (payload) req.write(payload);
    req.end();
  });
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find(item => fs.existsSync(item));
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function createTarget(port) {
  const targetUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`;
  let response = await fetch(targetUrl, { method: 'PUT' }).catch(() => null);
  if (!response || !response.ok) response = await fetch(targetUrl).catch(() => null);
  if (!response || !response.ok) throw new Error('Unable to create Chrome target.');
  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.buffer = Buffer.alloc(0);
  }
  async open() {
    const parsed = new URL(this.wsUrl);
    this.socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port || 80) });
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    const key = crypto.randomBytes(16).toString('base64');
    this.socket.write([
      `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
      `Host: ${parsed.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '\r\n'
    ].join('\r\n'));
    await new Promise((resolve, reject) => {
      const chunks = [];
      const onData = chunk => {
        chunks.push(chunk);
        const combined = Buffer.concat(chunks);
        const end = combined.indexOf('\r\n\r\n');
        if (end < 0) return;
        this.socket.off('data', onData);
        const head = combined.slice(0, end).toString('utf8');
        if (!/^HTTP\/1\.1 101\b/.test(head)) return reject(new Error(`Chrome WebSocket handshake failed: ${head.split('\r\n')[0]}`));
        const rest = combined.slice(end + 4);
        if (rest.length) this.handleData(rest);
        resolve();
      };
      this.socket.on('data', onData);
      this.socket.once('error', reject);
    });
    this.socket.on('data', chunk => this.handleData(chunk));
    this.socket.on('error', error => {
      for (const { reject, method } of this.pending.values()) reject(new Error(`${method} failed: ${error.message || error}`));
      this.pending.clear();
    });
    return this;
  }
  handleMessage(raw) {
    const message = JSON.parse(raw);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || 'CDP error'));
        else resolve(message.result || {});
        return;
      }
      if (message.method && this.listeners.has(message.method)) {
        for (const listener of this.listeners.get(message.method)) listener(message.params || {});
      }
  }
  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        length = high * 2 ** 32 + low;
        offset += 8;
      }
      const masked = Boolean(second & 0x80);
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.slice(offset, offset + length);
      if (masked) {
        const mask = this.buffer.slice(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.buffer = this.buffer.slice(offset + length);
      if (opcode === 1) this.handleMessage(payload.toString('utf8'));
      if (opcode === 8) this.close();
      if (opcode === 9) this.writeFrame(payload, 10);
    }
  }
  writeFrame(payload, opcode = 1) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
    const lengthBytes = body.length < 126 ? 0 : body.length <= 65535 ? 2 : 8;
    const header = Buffer.alloc(2 + lengthBytes + 4);
    header[0] = 0x80 | opcode;
    if (body.length < 126) {
      header[1] = 0x80 | body.length;
    } else if (body.length <= 65535) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(body.length, 6);
    }
    const maskOffset = 2 + lengthBytes;
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    mask.copy(header, maskOffset);
    const masked = Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]));
    this.socket.write(Buffer.concat([header, masked]));
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.writeFrame(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 10000);
      this.pending.set(id, {
        method,
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  close() {
    try { this.socket.end(); } catch {}
  }
}

function timingValue(header, key) {
  const match = String(header || '').match(new RegExp(`(?:^|,\\s*)${key};dur=([0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function timingDesc(header, key) {
  const match = String(header || '').match(new RegExp(`(?:^|,\\s*)${key};dur=[0-9.]+;desc="([^"]*)"`));
  return match ? match[1] : '';
}

function summarizeNetwork(record) {
  const serverTiming = record?.headers?.['Server-Timing'] || record?.headers?.['server-timing'] || '';
  return {
    url: record?.url || '',
    status: record?.status || 0,
    chrome_total_ms: record?.finished_at && record?.started_at ? Number(((record.finished_at - record.started_at) * 1000).toFixed(1)) : null,
    chrome_ttfb_ms: record?.response_at && record?.started_at ? Number(((record.response_at - record.started_at) * 1000).toFixed(1)) : null,
    encoded_bytes: record?.encodedDataLength || 0,
    node_total_ms: timingValue(serverTiming, 'node-total'),
    auth_ms: timingValue(serverTiming, 'auth'),
    db_acquire_ms: timingValue(serverTiming, 'db-acquire'),
    emails_page_query_ms: timingValue(serverTiming, 'emails-page-query'),
    email_filter_query_ms: timingValue(serverTiming, 'email-filter-query'),
    fallback_query_ms: timingValue(serverTiming, 'fallback-query'),
    mapping_ms: timingValue(serverTiming, 'mapping'),
    serialize_ms: timingValue(serverTiming, 'serialize'),
    response_end_ms: timingValue(serverTiming, 'response-end'),
    email_path: timingDesc(serverTiming, 'email-path'),
    server_timing: serverTiming
  };
}

async function runChromeCase(baseUrl, sid, { bypassServiceWorker = false, directApi = false } = {}) {
  const chrome = chromePath();
  if (!chrome) throw new Error('Chrome executable was not found.');
  const port = Number(process.env.CHROME_DEBUG_PORT || 9300 + Math.floor(Math.random() * 200));
  const userDataDir = path.join(os.tmpdir(), `kbc-chrome-inbox-${process.pid}-${bypassServiceWorker ? 'bypass' : 'normal'}-${directApi ? 'api' : 'page'}`);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1000',
    'about:blank'
  ];
  const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(chunk.toString()));
  let client = null;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 15000);
    const target = await createTarget(port);
    if (process.env.CHROME_DIAG_DEBUG === 'true') console.error(JSON.stringify({ chrome_target: target }, null, 2));
    client = await new CdpClient(target.webSocketDebuggerUrl).open();
    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.setBypassServiceWorker', { bypass: bypassServiceWorker });
    await client.send('Network.setCookie', {
      name: 'sid',
      value: sid,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax'
    });

    const emailRecords = new Map();
    const diagnostics = [];
    client.on('Runtime.consoleAPICalled', params => {
      const values = (params.args || []).map(arg => arg.value || arg.description || '').filter(Boolean);
      if (values[0] === '[KBC_DIAG]') diagnostics.push(values[1] || values.join(' '));
    });
    client.on('Network.requestWillBeSent', params => {
      if (!String(params.request?.url || '').includes('/api/emails?')) return;
      emailRecords.set(params.requestId, {
        url: params.request.url,
        started_at: params.timestamp,
        request_headers: params.request.headers || {}
      });
    });
    client.on('Network.responseReceived', params => {
      const record = emailRecords.get(params.requestId);
      if (!record) return;
      record.response_at = params.timestamp;
      record.status = params.response.status;
      record.headers = params.response.headers || {};
    });
    client.on('Network.loadingFinished', params => {
      const record = emailRecords.get(params.requestId);
      if (!record) return;
      record.finished_at = params.timestamp;
      record.encodedDataLength = params.encodedDataLength;
    });

    const targetUrl = directApi ? `${baseUrl}${EXACT_PATH}` : `${baseUrl}/?debug_frontend=true#/inbox`;
    await client.send('Page.navigate', { url: targetUrl });
    const started = Date.now();
    while (Date.now() - started < 65000) {
      const finished = [...emailRecords.values()].filter(record => record.finished_at);
      if (finished.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const build = await client.send('Runtime.evaluate', { expression: 'window.KBC_APP_BUILD || ""', returnByValue: true }).catch(() => ({ result: { value: '' } }));
        return {
          bypass_service_worker: bypassServiceWorker,
          direct_api: directApi,
          app_build: build.result?.value || '',
          requests: finished.map(summarizeNetwork),
          diagnostics
        };
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Chrome did not finish an /api/emails request within 65 seconds. stderr=${stderr.join('').slice(-500)}`);
  } finally {
    if (client) client.close();
    child.kill('SIGKILL');
    fs.rmSync(userDataDir, { recursive: true, force: true });
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
    const sid = String(login.set_cookie[0] || '').match(/sid=([^;]+)/)?.[1] || '';
    if (!sid) throw new Error('Login did not return a sid cookie.');

    const cases = [
      await runChromeCase(baseUrl, sid, { bypassServiceWorker: false, directApi: false }),
      await runChromeCase(baseUrl, sid, { bypassServiceWorker: true, directApi: false }),
      await runChromeCase(baseUrl, sid, { bypassServiceWorker: true, directApi: true })
    ];
    console.log(JSON.stringify({ app_build_expected: APP_BUILD_ID, exact_path: EXACT_PATH, cases }, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  try { server.close(); } catch {}
  process.exit(1);
});
