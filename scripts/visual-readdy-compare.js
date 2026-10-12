'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'reports', 'readdy-visual');
const CDP_PORT = Number(process.env.CDP_PORT || 9226);
const VIEWPORTS = [
  [1440, 900],
  [1366, 768],
  [1920, 1080]
];

function readEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

async function httpJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result || {});
        return;
      }
      if (msg.method && this.events.has(msg.method)) {
        for (const fn of this.events.get(msg.method)) fn(msg.params || {});
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method) {
    return new Promise(resolve => {
      const fn = params => {
        const list = this.events.get(method) || [];
        this.events.set(method, list.filter(item => item !== fn));
        resolve(params);
      };
      const list = this.events.get(method) || [];
      list.push(fn);
      this.events.set(method, list);
    });
  }

  close() {
    this.ws.close();
  }
}

async function navigate(cdp, url) {
  console.log(`navigate ${url}`);
  const loaded = Promise.race([
    cdp.once('Page.loadEventFired'),
    new Promise(resolve => setTimeout(resolve, 8000))
  ]);
  await cdp.send('Page.navigate', { url });
  await loaded;
}

async function waitFor(cdp, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.result && result.result.value) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(cdp, name, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(resolve => setTimeout(resolve, 400));
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(OUT_DIR, `${name}-${width}x${height}.png`);
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
  return file;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = readEnv();
  const email = env.DEV_PANEL_EMAIL || env.INITIAL_ADMIN_EMAIL;
  const password = env.DEV_PANEL_PASSWORD || env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Missing DEV_PANEL or INITIAL_ADMIN credentials in .env');

  const target = await httpJson(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
  console.log('created target');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  console.log('connected cdp');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const outputs = [];
  await navigate(cdp, 'http://127.0.0.1:3000/');
  console.log('logging into kbc');
  const login = await cdp.send('Runtime.evaluate', {
    expression: `(async()=>{const r=await fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(password)}})});return {ok:r.ok,status:r.status,text:await r.text()};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (!login.result.value.ok) throw new Error(`KBC login failed with ${login.result.value.status}`);
  console.log('kbc login ok');

  for (const [width, height] of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate(cdp, `http://127.0.0.1:3000/?visual=exact2-${width}#/monitoring`);
    console.log(`waiting kbc ${width}x${height}`);
    await waitFor(cdp, "document.querySelector('.uploaded-admin-dashboard') && !document.querySelector('.dashboard-skeleton')");
    outputs.push(await screenshot(cdp, 'kbc-admin', width, height));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate(cdp, 'http://127.0.0.1:3002/');
    console.log(`waiting readdy ${width}x${height}`);
    await waitFor(cdp, "document.querySelector('aside') && document.body.innerText.includes('Planner')");
    outputs.push(await screenshot(cdp, 'readdy-reference', width, height));
  }

  cdp.close();
  console.log(outputs.map(file => path.relative(ROOT, file)).join('\n'));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
