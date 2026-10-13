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
const Applications = require('../server/applications');

async function timed(label, fn) {
  const started = performance.now();
  const payload = await fn();
  return {
    label,
    duration_ms: Number((performance.now() - started).toFixed(1)),
    count: Array.isArray(payload.applications) ? payload.applications.length : Number(payload.total || 0),
    has_more: Boolean(payload.has_more || payload.hasMore),
    aggregate_only: Boolean(payload.performance?.aggregate_only)
  };
}

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool || !Storage.usesPostgresStorage()) {
    console.log(JSON.stringify({ skipped: true, reason: 'PostgreSQL storage is not configured.' }, null, 2));
    return;
  }
  const pipeline = await timed('pipeline_aggregate', () => Applications.loadAdmissionsPipelineDb({}, null));
  const counts = await Applications.loadAdmissionsPipelineDb({}, null);
  const firstStage = (counts.stages || []).find(stage => stage.count > 0)?.stage || 'In review';
  const stagePage = await timed(`stage_page:${firstStage}`, () => Applications.loadAdmissionsStageDb(firstStage, { limit: 25 }, null));
  const sample = await Applications.loadAdmissionsStageDb(firstStage, { limit: 1 }, null);
  const detailId = sample.applications?.[0]?.id || '';
  const detail = detailId ? await timed(`detail:${detailId}`, () => Applications.loadApplicationDetailDb(detailId, null, null)) : { skipped: true, reason: 'No application in sampled stage.' };
  console.log(JSON.stringify({ pipeline, stages: counts.stages, statuses: counts.statuses, stage_page: stagePage, detail }, null, 2));
})().then(async () => {
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(0);
}).catch(async error => {
  console.error(error.stack || error.message);
  try { await State.postgresPool?.end?.(); } catch {}
  process.exit(1);
});
