'use strict';

const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Sync persistence test failed: ${message}`);
    process.exit(1);
  }
}

const storage = read('server/storage.js');
const gmail = read('server/integrations/gmail.js');
const events = read('server/events.js');
const eventbrite = read('server/integrations/eventbrite.js');
const zoom = read('server/integrations/zoom.js');
const meta = read('server/integrations/meta.js');
const apollo = read('server/integrations/apollo.js');
const zoho = read('server/integrations/zoho.js');
const backendSync = read('frontend/src/store/backendSync.ts');
const workspaceProvider = read('frontend/src/store/WorkspaceProvider.tsx');

assert(storage.includes('async function saveDb(db, options = {})'), 'saveDb must accept persistence options');
assert(storage.includes('options.pruneMissing === false'), 'saveDb must support disabling deleteMissingIds pruning');
assert(storage.includes('pruneMissingPostgresIds'), 'full-table pruning must be centralized behind an explicit guard');

for (const [name, source] of [
  ['Eventbrite', eventbrite],
  ['Zoom', zoom],
  ['Meta', meta],
  ['Apollo', apollo]
]) {
  assert(source.includes('pruneMissing: false'), `${name} provider sync must save non-destructively`);
}

const gmailSaveStart = gmail.indexOf('async function saveGmailImportTables');
const gmailSaveBlock = gmail.slice(gmailSaveStart, gmail.indexOf('function base64Url', gmailSaveStart));
assert(!gmailSaveBlock.includes('deleteMissingIds'), 'Gmail incremental save must not prune missing emails');

const eventSaveBlock = events.slice(events.indexOf('async function saveEventImportTables'), events.indexOf('function numericHash'));
assert(!eventSaveBlock.includes('deleteMissingIds'), 'Event/Zoom/Eventbrite save must not prune missing events/leads/tasks');
assert(!eventSaveBlock.includes('deleteEventIds') && !eventSaveBlock.includes('delete from app_events'), 'Provider event sync must not hard-delete local events');
assert(eventSaveBlock.includes('where app_events.name is distinct from excluded.name'), 'Event sync upsert must skip unchanged event rows');
assert(storage.includes('where app_leads.person_id is distinct from excluded.person_id'), 'General provider save must skip unchanged lead rows');
assert(storage.includes('where app_events.name is distinct from excluded.name'), 'General provider save must skip unchanged event rows');
assert(!eventbrite.includes('deleted_event_ids'), 'Eventbrite sync must not report hard-delete event ids');
assert(!meta.includes('includes(lead.id)) continue'), 'Meta sync must upsert known lead ids instead of skipping updates forever');
assert(!apollo.includes('includes(id)) continue'), 'Apollo sync must upsert known person ids instead of skipping updates forever');

assert(zoho.includes('isZohoRateLimitError'), 'Zoho rate limits must be retried instead of forcing manual sync');
assert(zoho.includes("status = 'queued'") && zoho.includes('retry_after_at'), 'Zoho transient/rate-limit failures must persist a retry');
assert(zoho.includes('records === 0 && marks.length === 0') && zoho.includes("mode: initialSyncNeeded ? 'full' : 'incremental'"), 'Zoho auto sync must run full sync only for an empty initial dataset');
assert(zoho.includes('zohoDurableSyncMarks') && zoho.includes('A missing sync_marks object is not permission'), 'Zoho must recover checkpoints from durable records instead of repeating a full import');
assert(zoho.includes('repairRebuildRequested') && zoho.includes('allowFullSync'), 'Zoho full sync must require an explicit repair/rebuild request after initial import');
assert(zoho.includes('where app_zoho_records.module is distinct from excluded.module'), 'Zoho record upsert must skip unchanged records');

assert(!backendSync.includes('/api/integrations/gmail/sync'), 'Frontend bootstrap must not auto-trigger Gmail sync');
assert(!backendSync.includes('/api/integrations/zoho/sync'), 'Frontend bootstrap must not auto-trigger Zoho sync');
assert(!workspaceProvider.includes('/api/integrations/gmail/sync'), 'WorkspaceProvider must not auto-trigger Gmail sync');
assert(!workspaceProvider.includes('/api/integrations/zoho/sync'), 'WorkspaceProvider must not auto-trigger Zoho sync');

assert(fs.existsSync('scripts/sync-persistence-diagnosis.js'), 'sync persistence diagnostic script is missing');

console.log('Sync persistence tests passed.');
