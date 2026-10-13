'use strict';

process.env.NEST_COMPAT_MODE = 'true';
if (process.env.DIAGNOSE_SCHEMA_SETUP !== 'true') process.env.SKIP_SCHEMA_SETUP = 'true';
process.env.ZOHO_SYNC_WORKER = 'false';
process.env.ZOHO_AUTO_SYNC = 'false';
process.env.GMAIL_AUTO_SYNC = 'false';
process.env.EVENT_AUTO_SYNC = 'false';
process.env.ZOOM_AUTO_SYNC = 'false';

const State = require('../server/state');
const Storage = require('../server/storage');
const IntegrationCentre = require('../server/integration-centre');

(async () => {
  await Storage.ensureStorage();
  const started = performance.now();
  const payload = await IntegrationCentre.overview({ headers: {}, socket: {} });
  const duration = Number((performance.now() - started).toFixed(1));
  console.log(JSON.stringify({
    duration_ms: duration,
    integrations: payload.integrations.map(item => ({
      integration: item.id,
      connected: item.connected,
      health: item.health,
      sync_state: item.sync_status,
      last_success_at: item.last_success_at,
      last_failure_at: item.last_error_at,
      pending_job_count: item.sync_status === 'queued' ? 1 : 0,
      running_job_count: item.sync_status === 'running' ? 1 : 0,
      failed_job_count: item.sync_status === 'failed' ? 1 : 0
    })),
    metrics: payload.metrics
  }, null, 2));
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
