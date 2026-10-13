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
const Automations = require('../server/automations');

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    console.log(JSON.stringify({ skipped: true, reason: 'PostgreSQL storage is required for automations.' }, null, 2));
    return;
  }
  try {
    const status = await Automations.status();
    const latency = status.oldest_pending_job ? Math.max(0, Date.now() - new Date(status.oldest_pending_job).getTime()) : 0;
    console.log(JSON.stringify({
      ...status,
      processing_latency_ms: latency
    }, null, 2));
  } catch (error) {
    if (/app_automation_/.test(String(error.message || ''))) {
      console.log(JSON.stringify({ skipped: true, reason: 'Automation migration has not been applied.', migration: 'sql/2026-10-12_automation_engine.sql' }, null, 2));
      return;
    }
    throw error;
  }
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
