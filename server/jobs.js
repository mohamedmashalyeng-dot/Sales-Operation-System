'use strict';

const Config = require('./config');
const State = require('./state');
const Events = require('./events');
const Gmail = require('./integrations/gmail');
const Zoom = require('./integrations/zoom');
const Zoho = require('./integrations/zoho');

function autoSyncUser(db) {
  return db.users.find(item => ['admin', 'director', 'manager'].includes(item.role)) || db.users[0] || { id: 'system', name: 'System', role: 'admin' };
}

function startAutoSync() {
  if (!Config.BACKGROUND_JOBS_ENABLED) {
    State.gmailAutoSyncState = { ...State.gmailAutoSyncState, enabled: false, mode: Config.GMAIL_AUTO_SYNC_MODE, daily_time: Config.GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
    State.eventAutoSyncState = { ...State.eventAutoSyncState, enabled: false, running: false, next_run_at: null };
    State.zoomAutoSyncState = { ...State.zoomAutoSyncState, enabled: false, running: false, next_run_at: null };
    console.log('Background auto sync disabled. Set BACKGROUND_JOBS_ENABLED=true to resume scheduled sync jobs.');
    return;
  }
  Zoho.resumeZohoSyncJobs().catch(error => console.error(`Zoho sync resume failed: ${Zoho.zohoSafeJobError(error)}`));
  Zoho.scheduleZohoAutoSync(5 * 1000);
  if (!Config.GMAIL_AUTO_SYNC_ENABLED && !Config.EVENT_AUTO_SYNC_ENABLED && !Config.ZOOM_AUTO_SYNC_ENABLED) {
    State.gmailAutoSyncState = { ...State.gmailAutoSyncState, enabled: false, mode: Config.GMAIL_AUTO_SYNC_MODE, daily_time: Config.GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
    State.eventAutoSyncState = { ...State.eventAutoSyncState, enabled: false, running: false, next_run_at: null };
    State.zoomAutoSyncState = { ...State.zoomAutoSyncState, enabled: false, running: false, next_run_at: null };
    return;
  }
  if (Config.GMAIL_AUTO_SYNC_ENABLED) {
    State.gmailAutoSyncState = { ...State.gmailAutoSyncState, enabled: true, mode: Config.GMAIL_AUTO_SYNC_MODE, daily_time: Config.GMAIL_AUTO_SYNC_DAILY_TIME };
    Gmail.scheduleGmailAutoSync(Config.GMAIL_AUTO_SYNC_MODE === 'daily' ? null : 20000);
  } else {
    State.gmailAutoSyncState = { ...State.gmailAutoSyncState, enabled: false, mode: Config.GMAIL_AUTO_SYNC_MODE, daily_time: Config.GMAIL_AUTO_SYNC_DAILY_TIME, running: false, next_run_at: null };
  }
  if (Config.EVENT_AUTO_SYNC_ENABLED) {
    const delay = 15000;
    State.eventAutoSyncState.next_run_at = new Date(Date.now() + delay).toISOString();
    console.log(`Event auto sync scheduled in ${Math.round(delay / 1000)}s.`);
    setTimeout(Events.runEventAutoSync, delay);
  } else {
    State.eventAutoSyncState = { ...State.eventAutoSyncState, enabled: false, running: false, next_run_at: null };
  }
  if (Config.ZOOM_AUTO_SYNC_ENABLED) {
    const delay = 90000;
    State.zoomAutoSyncState = { ...State.zoomAutoSyncState, enabled: true, meetings: Config.ZOOM_AUTO_SYNC_MEETINGS, calls: Config.ZOOM_AUTO_SYNC_CALLS };
    console.log(`Zoom auto sync scheduled in ${Math.round(delay / 1000)}s.`);
    Zoom.scheduleZoomAutoSync(delay);
  } else {
    State.zoomAutoSyncState = { ...State.zoomAutoSyncState, enabled: false, running: false, next_run_at: null };
  }
}

exports.autoSyncUser = autoSyncUser;
exports.startAutoSync = startAutoSync;
