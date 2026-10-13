# Durable Local Data Sync Architecture

Generated: 2026-10-13

## 1. Original Root Cause

The workspace had the correct high-level idea in several places: list APIs generally read local PostgreSQL tables, and provider sync writes local data. The failure was in the lifecycle around sync and startup:

- Zoho auto sync refused to run the initial full import automatically when `sync_marks` were missing. That made manual Sync the practical way to repair visibility/freshness.
- Zoho rate-limit failures were persisted as `failed`, which stopped automatic retry and pushed the user back to manual Sync.
- `Storage.savePostgresTables()` used `deleteMissingIds()` for full snapshot saves. Provider sync paths that called `Storage.saveDb()` could therefore prune local rows if the in-memory workspace snapshot was partial or a provider returned fewer records.
- The frontend could fall back to demo/local empty state when `/api/bootstrap` or `/api/integrations/overview` failed, even though local PostgreSQL data still existed.

The core fix is: sync updates local PostgreSQL; local APIs read PostgreSQL; provider status never controls whether persisted records are visible.

## 2. Provider/Data-Flow Map

| Provider | Fetch/sync function | Sync endpoint/scheduler | Local store | External identity | Checkpoint/cursor | Frontend read path |
|---|---|---|---|---|---|---|
| Gmail | `importGmailMessages` | `/api/integrations/gmail/sync`, Gmail auto sync | `app_emails`, related `app_leads`, `app_tasks`, `app_workspace.gmail` | `gmail_message_id` | `history_id`, page tokens, `last_sync_at` | `/api/emails` from PostgreSQL |
| Zoho CRM | `createOrResumeZohoSyncJob`, `runZohoSyncWorker` | `/api/integrations/zoho/sync`, callback queue, Zoho auto sync | `app_zoho_records`, mapped `app_leads`, `integration_jobs`, `app_workspace.meta.zoho` | `module + zoho_id` | job `state.cursors`, `sync_marks`, `retry_after_at` | `/api/integrations/zoho/records/page`, `/api/leads` |
| Zoom | `importZoomMeetings`, `importZoomCalls` | `/api/integrations/zoom/sync`, `/api/integrations/zoom/calls/sync`, Zoom auto sync | `app_events`, `app_workspace.meta.zoom.calls` | meeting id/uuid, call uuid/id | `last_sync_at`, `last_call_sync_at` | `/api/zoom/events`, `/api/zoom/calls` |
| Eventbrite | `importEventbriteEvents` | `/api/integrations/eventbrite/sync`, Event auto sync | `app_events`, attendees JSON, `app_workspace.eventbrite` | `eventbrite_event_id`, `eventbrite_attendee_id` | `events_incremental_started_at`, imported id lists, `last_sync_at` | `/api/events` |
| Meta Lead Ads | `importMetaLeads` | `/api/integrations/meta/sync` | `app_leads`, `app_tasks`, `app_workspace.meta` | `meta_lead_id` | imported lead ids, `last_sync_at` | `/api/leads` |
| Apollo | `importApolloPeople` | `/api/integrations/apollo/sync` | `app_leads`, `app_tasks`, `app_workspace.meta.apollo` | `apollo_person_id` | imported person ids, `last_sync_at` | `/api/leads` |
| Sheets/Excel | `importSpreadsheetEvents` | `/api/events/import`, Event auto sync if `EVENTS_SHEET_URL` configured | `app_events`, attendees JSON, related leads/tasks | `sheet_event_id` or deterministic event/attendee key | `events_incremental_started_at` | `/api/events` |

## 3. Temporary vs Persisted

Persisted operational data:

- Emails: `app_emails`
- Leads: `app_leads`
- Tasks: `app_tasks`
- Applications: `app_applications`
- Events/meetings: `app_events`
- Zoom calls: `app_workspace.meta.zoom.calls`
- Zoho records: `app_zoho_records`
- Integration connection/checkpoint state: `app_workspace.gmail`, `app_workspace.eventbrite`, `app_workspace.meta`, `integration_jobs`

Temporary/process state remains only for timers and visible health, for example `State.gmailAutoSyncState`, `State.eventAutoSyncState`, and `State.zoomAutoSyncState`. Those states are not used as the source of list data.

## 4. Local Tables And API Ownership

The workspace APIs are local-data APIs:

- `GET /api/emails` reads `app_emails`.
- `GET /api/leads` reads `app_leads`.
- `GET /api/events` reads `app_events`.
- `GET /api/zoom/events` reads `app_events`.
- `GET /api/zoom/calls` reads persisted Zoom call JSON in `app_workspace`.
- `GET /api/applications` reads `app_applications`.
- `GET /api/tasks` reads `app_tasks`.
- `GET /api/integrations/zoho/records/page` reads `app_zoho_records`.

None of those list endpoints should call Gmail, Zoho, Zoom, Eventbrite, Meta, Apollo, or Google Sheets merely to display previously synced records.

## 5. Upsert Strategy

Current idempotency:

- Gmail deduplicates by `gmail_message_id`, reusing existing row ids and removing duplicate rows only for the same incoming Gmail message.
- Zoho upserts `app_zoho_records` by key and upserts mapped leads by stable ids.
- Zoom/Eventbrite/Sheets merge into existing events by provider id or deterministic event key.
- Meta/Apollo use provider ids stored on lead data and `Leads.ensureLeadRecord`.

Provider sync saves are now non-destructive where they pass through `Storage.saveDb(..., { pruneMissing: false })`.

## 6. Checkpoint Strategy

- Gmail: `history_id`, page tokens, `last_sync_at`.
- Zoho: `integration_jobs.state.cursors`, `retry_after_at`, `app_workspace.meta.zoho.sync_marks`.
- Zoom: `last_sync_at`, `last_call_sync_at`.
- Eventbrite/Sheets: imported ids and `events_incremental_started_at`.
- Meta/Apollo: imported id lists and `last_sync_at`.

Critical checkpoints are persisted in PostgreSQL, not browser state.

## 7. Initial vs Incremental Sync

Zoho now auto-queues an initial full sync when connected and either no local records or no `sync_marks` exist. After that, normal auto sync uses incremental marks.

Gmail normal auto sync uses bounded batches and stored Gmail checkpoints. Zoom/Eventbrite/Sheets use bounded import limits and stored timestamps/id lists. Meta/Apollo remain bounded manual sync integrations.

## 8. Reconnect Behavior

OAuth reconnect updates auth/connection metadata only. Existing imported ids and local records are preserved. Provider connection status is reported in integration status but is not used to hide local records.

## 9. Remote Deletion Behavior

Remote absence is not treated as local deletion. Partial provider responses never prune local tables. Eventbrite local duplicate merge can remove a merged duplicate event id, but provider "missing from response" is not used as a hard-delete signal.

## 10. Local vs Provider Field Ownership

Provider sync owns provider metadata and source fields. KBC operational fields such as owner, stage, tasks, notes, application status, attribution, and local workflow flags must not be cleared because a provider response omits them. Current upsert paths preserve local data by merging through existing records or using local table upserts.

## 11. Background Scheduling

- Gmail auto sync runs when `BACKGROUND_JOBS_ENABLED=true` and Gmail auto sync is enabled.
- Event auto sync handles Eventbrite/Sheets, and Zoom fallback only when Zoom auto sync is disabled.
- Zoom auto sync runs separately.
- Zoho auto sync starts shortly after backend boot and then repeats on `ZOHO_AUTO_SYNC_INTERVAL_MS`.

Long Zoho sync jobs run asynchronously in `integration_jobs` with DB-backed leases and retry metadata.

## 12. Restart Recovery

Zoho calls `resumeZohoSyncJobs()` on backend boot. Queued/running jobs are resumed using persisted job state. Local records remain in PostgreSQL regardless of provider availability.

## 13. Tests And Diagnostics

Added:

- `npm run diagnose:sync-persistence`
- `npm run test:sync-persistence`

Existing checks also used:

- `npm run test:zoho:async`
- `npm run test:integration-centre`
- `npm run ui:type-check`
- `npm run ui:build`

## 14. Current Local Row Counts

Read-only diagnostic on 2026-10-13:

| Table/feed | Count |
|---|---:|
| Leads | 129,292 |
| Tasks | 41,500 |
| Applications | 1,499 |
| Emails | 7,563 |
| Events | 90 |
| Audit | 6,946 |
| Zoho records | 184,452 |
| Zoom meetings | 35 |
| Zoom calls | 250 |
| Eventbrite events | 62 |
| Eventbrite attendees | 2,317 |
| Sheets/Excel events | 21 |

Duplicate external id counts from the diagnostic:

- Gmail: 0
- Zoho: 0
- Zoom meetings: 0
- Eventbrite events: 0
- Meta: 0
- Apollo: 0
- Sheets/Excel event ids: 4

## 15. Remaining Provider Limitations

- Zoho currently has many locally stored records but no `sync_marks`; the scheduler queues a full sync automatically to rebuild marks. Zoho rate limits are now retried instead of treated as a permanent manual failure.
- Meta and Apollo are bounded manual/import integrations, not durable asynchronous job integrations yet.
- Zoom calls are persisted in `app_workspace.meta.zoom.calls`, not a normalized `app_zoom_calls` table.
- Sheets/Excel duplicate `sheet_event_id` values should be reviewed before any unique constraint is added.

## 16. Acceptance Result

The architecture now follows:

External provider -> background sync -> Neon PostgreSQL -> KBC APIs -> frontend.

Previously synced records remain available from PostgreSQL across browser refresh, login, Node restart, OAuth expiry, provider rate limiting, and failed incremental sync.
