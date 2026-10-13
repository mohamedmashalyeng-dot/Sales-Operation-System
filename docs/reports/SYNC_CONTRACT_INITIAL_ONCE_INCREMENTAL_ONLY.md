# Sync Contract: Initial Once, Incremental Only

## Scope

Implemented the KBC sync contract guardrails for normal UI/backend sync paths:

- initial historical import is allowed only for an empty provider dataset
- normal Sync Now requests incremental changes
- reconnect does not clear local data
- app/page load does not start provider sync
- full sync after initial import requires an explicit repair/rebuild flag
- provider upserts skip unchanged record rewrites where the shared PostgreSQL save path is used
- normal Eventbrite sync no longer hard-deletes merged/missing local events

No provider sync, SQL migration, deploy, commit, or destructive data operation was run while making this change.

## Changes Made

### Zoho CRM

- `server/integrations/zoho.js`
  - Auto sync now treats `records > 0` as a durable imported dataset, even if `sync_marks` are missing.
  - Missing `sync_marks` are recovered from `app_zoho_records.modified_time/synced_at` or `zoho.last_sync_at`.
  - Normal/manual sync is incremental after a durable dataset exists.
  - Full sync after initial import requires `repair_rebuild=true`.
  - `app_zoho_records` upsert now updates only when fields/data are actually different.

- `server/integration-centre.js`
  - Integration Centre sync now defaults to incremental, not full.

- `app.js`
  - Legacy UI no longer sends `full_sync:true` from normal Zoho buttons.
  - Buttons now say `Sync changes`.

### Gmail

- `server/routes/gmail.js`
  - Sync Now checks whether an initial Gmail import is truly needed.
  - If Gmail data already exists, `max_results=all`/`full` is ignored unless `repair_rebuild=true`.
  - Normal Gmail sync uses incremental/latest mode.

- `server/integrations/gmail.js`
  - Successful sync persists Gmail state/checkpoints even when no new records were inserted.
  - Historical completion state can be marked after a non-incremental initial import finishes.

- `frontend/src/pages/inbox/page.tsx`
  - Sync Gmail button now requests latest incremental changes only.

### Eventbrite, Zoom, Meta, Apollo, Shared Saves

- `server/integrations/eventbrite.js`
  - Existing Eventbrite events are compared before update; unchanged events are counted as unchanged and keep their existing `updated_at`.
  - Duplicate local event matches are marked as merged duplicates instead of being hard-deleted by normal sync.
  - Successful sync stores `last_success_at` and `initial_sync_completed_at`.

- `server/integrations/zoom.js`
  - Meeting and call upserts now count unchanged records separately and avoid refreshing `updated_at` when nothing changed.
  - Successful meeting/call sync stores durable completion/success timestamps.

- `server/integrations/meta.js` and `server/integrations/apollo.js`
  - Known provider IDs are now upserted on every sync instead of being skipped forever.
  - Returned sync stats include inserted, updated, unchanged, and deleted counts.

- `server/leads.js`
  - Provider-owned lead fields are refreshed when the incoming record matches the same stable provider ID.
  - KBC-owned workflow fields such as stage and owner remain preserved.

- `server/events.js` and `server/storage.js`
  - PostgreSQL upserts include `where ... is distinct from ...` guards for the main saved tables so unchanged rows are not rewritten during provider saves.

## Provider Contract Matrix

| Provider | Initial import mechanism | Incremental mechanism | Stable external ID | Local table/state | Unique/upsert key | Checkpoint type | Full import completed state | Reconnect behavior | Remote deletion behavior |
|---|---|---|---|---|---|---|---|---|---|
| Gmail | First empty mailbox import through Gmail messages API | Latest/history/label changes; bounded latest sync | `gmail_message_id` | `app_emails`, `app_workspace.gmail` | email row id plus `gmail_message_id` tracking | `history_id`, page tokens, `last_sync_at` | `initial_sync_completed_at` when historical import completes; existing rows also prevent full rerun | Keeps Gmail state/records; reconnect only refreshes credentials | Label/delete history may mark dashboard trash; no hard delete of operational history |
| Zoho CRM | First empty CRM dataset job only | `If-Modified-Since` per module using durable marks | `module:id` | `app_zoho_records`, `app_leads`, `app_workspace.meta.zoho` | `app_zoho_records.key` | `sync_marks`, fallback max `modified_time/synced_at`, `last_sync_at` | Existing records or sync marks mean initial import is done | Reuses connection id `main`, records, and recovered checkpoints | No deletion from absent incremental responses |
| Zoom | First scheduled/manual import into events/calls | Existing sync state and last successful sync windows where supported | meeting id/uuid, call id | `app_events`, zoom meta/calls | event/call ids | `sync_state`, `last_sync_at`, `last_call_sync_at` | `initial_sync_completed_at`, `initial_call_sync_completed_at`, or existing rows | Reconnect keeps local rows | No prune; saves with `pruneMissing:false`; no delete from missing responses |
| Eventbrite | First import of events/attendees | Incremental-only start/checkpoint when configured; safe reconciliation otherwise | event id, attendee id | `app_events`, `app_workspace.eventbrite` | event/attendee ids | `events_incremental_started_at`, imported ids, `last_sync_at` | `initial_sync_completed_at` or existing imported ids/last sync | Reconnect keeps local rows | No remote absence hard-delete; duplicate local matches are marked merged, not hard-deleted |
| Meta Lead Ads | First import from configured forms | Reconciliation/upsert by lead id, including previously seen ids | Meta lead id | `app_leads`, `app_workspace.meta` | `meta_lead_id` | imported lead/form ids, `last_sync_at` | `initial_sync_completed_at` or existing imported ids/last sync | Keeps local leads | No delete on missing provider response |
| Apollo | First people import | Reconciliation/upsert by person id, including previously seen ids | Apollo person id | `app_leads`, `app_workspace.meta.apollo` | `apollo_person_id` | imported person ids, `last_sync_at` | `initial_sync_completed_at` or existing imported ids/last sync | Keeps local leads | No delete on missing provider response |

## Test Report

No live provider sync was executed during this fix, so no real external records were inserted/updated/deleted by this work.

Static/runtime verification:

| Check | Result |
|---|---|
| `node --check server/integrations/zoho.js` | passed |
| `node --check server/integrations/gmail.js` | passed |
| `node --check server/routes/gmail.js` | passed |
| `node --check server/integration-centre.js` | passed |
| `npm.cmd run ui:type-check` | passed |
| `npm.cmd run ui:build` | passed |
| `node scripts/sync-persistence-test.js` | passed |
| `node scripts/zoho-async-sync-audit.js` | passed |
| `node --check server/integrations/eventbrite.js` | passed |
| `node --check server/integrations/meta.js` | passed |
| `node --check server/integrations/apollo.js` | passed |
| `node --check server/integrations/zoom.js` | passed |
| `node --check server/events.js` | passed |
| `node --check server/storage.js` | passed |
| `node scripts/frontend-route-smoke.js` | passed |

Expected records during normal sync after this change:

| Scenario | Before | Inserted | Updated | Unchanged | Deleted | After |
|---|---:|---:|---:|---:|---:|---:|
| New records only | N | new provider records | changed provider records only | unchanged local rows untouched | 0 hard deletes | N + inserted |
| No changes | N | 0 | 0 meaningful updates | N | 0 | N |
| Repeated same response | N | 0 after first run | 0 if fields unchanged | N | 0 | N |
| Reconnect same account | N | only new remote rows | only changed remote rows | existing rows preserved | 0 | N +/- new rows |

Any normal sync that performs thousands of delete plus insert operations remains a failure.
