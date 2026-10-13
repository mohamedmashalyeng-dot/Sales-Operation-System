'use strict';

process.env.NEST_COMPAT_MODE = 'true';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.ZOHO_SYNC_WORKER = 'false';

const State = require('../server/state');
const Storage = require('../server/storage');

(async () => {
  await Storage.ensureStorage();
  if (!State.postgresPool) throw new Error('PostgreSQL storage is not active.');

  const zoomEvents = await State.postgresPool.query(`
    select
      count(*)::int as total,
      max(data->>'updated_at') as max_updated,
      max(start_at) as max_start
    from app_events
    where coalesce(data->>'zoom_meeting_id', '') <> ''
       or coalesce(data->>'zoom_meeting_uuid', '') <> ''
       or lower(coalesce(location, data->>'location', '')) = 'zoom'
       or lower(coalesce(campaign, data->>'campaign', '')) like 'zoom%'
  `);

  const workspace = await State.postgresPool.query(
    `select meta->'zoom' as zoom from app_workspace where id = $1`,
    ['main'],
  );
  const zoom = workspace.rows[0]?.zoom || {};
  const syncStates = Object.values(zoom.sync_state || {});

  console.log(JSON.stringify({
    zoom_events: zoomEvents.rows[0],
    zoom_meta: {
      last_sync_at: zoom.last_sync_at || null,
      last_call_sync_at: zoom.last_call_sync_at || null,
      accounts: zoom.accounts || null,
      user_id: zoom.user_id || null,
      imported_meeting_ids: Array.isArray(zoom.imported_meeting_ids) ? zoom.imported_meeting_ids.length : 0,
      calls: Array.isArray(zoom.calls) ? zoom.calls.length : 0,
      sync_state_count: syncStates.length,
      sync_state_sample: syncStates.slice(0, 5).map((state) => ({
        status: state.status || null,
        last_attempt_at: state.last_attempt_at || null,
        last_successful_sync_at: state.last_successful_sync_at || null,
        last_error: state.last_error || null,
        report_history_unavailable: Boolean(state.report_history_unavailable),
        zoom_user_label: state.zoom_user_label || null,
        zoom_account_label: state.zoom_account_label || null,
      })),
    },
  }, null, 2));
})()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (State.postgresPool) await State.postgresPool.end().catch(() => {});
  });
