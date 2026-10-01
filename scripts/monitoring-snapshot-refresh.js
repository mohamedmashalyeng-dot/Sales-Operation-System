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

const server = require('../server.js').__leadsTest;

(async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const trace = { route: '/api/monitoring:snapshot', started_at: performance.now(), stages: [], counters: {} };
  const started = performance.now();
  const payload = await server.refreshMonitoringSnapshotDb({
    today_start: today.toISOString(),
    tomorrow_start: tomorrow.toISOString()
  }, trace);
  console.log(JSON.stringify({
    ok: true,
    duration_ms: Number((performance.now() - started).toFixed(1)),
    payload_bytes: Buffer.byteLength(JSON.stringify(payload)),
    today_start: today.toISOString(),
    tomorrow_start: tomorrow.toISOString(),
    stages: trace.stages.map(stage => ({
      name: stage.name,
      duration_ms: Number(Number(stage.ms || 0).toFixed(1)),
      rows: stage.rows
    }))
  }, null, 2));
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
