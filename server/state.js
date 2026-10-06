'use strict';

const Config = require('./config');

// Mutable state that more than one server module reads or writes.
module.exports = {
  postgresPool: null,
  postgresUserSchemaReady: false,
  dbCache: null,
  gmailAutoSyncState: { enabled: Config.GMAIL_AUTO_SYNC_ENABLED, mode: Config.GMAIL_AUTO_SYNC_MODE, daily_time: Config.GMAIL_AUTO_SYNC_DAILY_TIME, running: false, last_result: null, last_error: null, next_run_at: null },
  eventAutoSyncRunning: false,
  eventAutoSyncState: { enabled: Config.EVENT_AUTO_SYNC_ENABLED, running: false, last_result: null, last_error: null, next_run_at: null },
  zoomAutoSyncRunning: false,
  zoomAutoSyncState: { enabled: Config.ZOOM_AUTO_SYNC_ENABLED, meetings: Config.ZOOM_AUTO_SYNC_MEETINGS, calls: Config.ZOOM_AUTO_SYNC_CALLS, running: false, last_result: null, last_error: null, next_run_at: null },

  // Leads merged by the de-duplication tool keep their row with deleted_at set. Production should
  // set LEAD_SOFT_DELETE_ENABLED=true after the migration, so normal requests never query
  // information_schema. When schema setup is explicitly enabled, the capability is detected once.
  leadSoftDelete: {
  enabled: false,
  checkedAt: Config.LEAD_SOFT_DELETE_CONFIG === 'false' ? Number.POSITIVE_INFINITY : 0,
  pending: null
}
};
