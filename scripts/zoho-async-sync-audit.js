const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`Zoho async sync audit failed: ${message}`);
    process.exit(1);
  }
}

const syncRouteIndex = server.indexOf("route === '/api/integrations/zoho/sync' && method === 'POST'");
const loadDbIndex = server.indexOf('const loadDbStart = performance.now()');
const syncRouteBlock = server.slice(syncRouteIndex, server.indexOf("if (route === '/api/integrations/zoho/sync-status'", syncRouteIndex));

assert(syncRouteIndex !== -1, 'missing Zoho sync endpoint');
assert(loadDbIndex !== -1, 'missing legacy loadDb marker');
assert(syncRouteIndex < loadDbIndex, 'Zoho sync endpoint must run before legacy loadDb');
assert(syncRouteBlock.includes('createOrResumeZohoSyncJob'), 'sync endpoint must create/resume a job');
assert(syncRouteBlock.includes('sendJson(res, { success: true') && syncRouteBlock.includes(', 202'), 'sync endpoint must return 202 immediately');
assert(!syncRouteBlock.includes('importZohoCrmRecords'), 'sync endpoint must not run the full import inline');

assert(server.includes('create table if not exists integration_jobs'), 'missing persistent integration_jobs table');
assert(server.includes('integration_jobs_active_zoho_idx'), 'missing DB-backed duplicate-job protection');
assert(server.includes('locked_until < now()') && server.includes('where id = $1 and locked_by = $2'), 'missing row lease that keeps one worker per Zoho job');
assert(!server.slice(syncRouteIndex, loadDbIndex).includes('pg_try_advisory_lock'), 'Zoho sync must not use session advisory locks through the Neon pooler');
assert(server.includes('fetchZohoRecordPage'), 'missing one-page Zoho fetcher');
assert(server.includes('resumeZohoSyncJobs'), 'missing restart resume scheduler');
assert(server.includes("route === '/api/integrations/zoho/sync-status'"), 'missing latest sync-status endpoint');
assert(server.includes('/api\\/integrations\\/zoho\\/sync-status\\/'), 'missing job sync-status endpoint');
assert(server.includes('ZOHO_SYNC_BATCH_SIZE'), 'missing configurable batch size');
assert(server.includes('ZOHO_SYNC_POLL_INTERVAL_MS'), 'missing polling interval configuration');

assert(app.includes("api('/api/integrations/zoho/sync',{full_sync:true},'POST'"), 'frontend must start a full background sync without waiting for full import');
assert(app.includes('/api/integrations/zoho/sync-status/'), 'frontend must poll job progress');
assert(app.includes('scheduleZohoSyncPoll'), 'frontend missing Zoho polling scheduler');
assert(app.includes('moduleResults'), 'frontend must render per-module Zoho sync progress');
assert(app.includes("res.headers.get('content-type')"), 'API helper must inspect response Content-Type');
assert(app.includes('Server gateway timed out while processing the request.'), 'API helper must hide raw 504 HTML');
assert(server.includes('fullSyncRequested'), 'server must recognise full Zoho sync requests');
assert(server.includes('moduleResults: state.moduleResults'), 'sync status payload must expose per-module results');
assert(server.includes('ZOHO_SYNC_MODULE_CONCURRENCY') && server.includes('syncZohoModule'), 'Zoho modules must sync in parallel');
assert(server.includes('if (more) pending = request(next);'), 'next Zoho page must be fetched while the current page is saved');
assert(server.includes("headers['If-Modified-Since']") && server.includes('sync_marks'), 'incremental Zoho sync must request only changed records');
assert(server.includes('page_token'), 'Zoho pages beyond 2000 records need page_token');
assert(app.includes("data-act=\"zoho-full-sync\""), 'frontend must offer a full resync');

console.log('Zoho async sync audit passed.');
