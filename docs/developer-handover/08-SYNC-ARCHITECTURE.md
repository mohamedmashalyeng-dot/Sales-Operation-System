# Sync Architecture

This section is critical: providers do not all use the same sync model.

## Background Job Entry

`server.js` calls `Jobs.startAutoSync()` after the HTTP server starts. `server/jobs.js` exits early unless `BACKGROUND_JOBS_ENABLED=true`.

When enabled:

- Zoho resumes/queues jobs and schedules auto sync.
- Gmail auto sync runs if `GMAIL_AUTO_SYNC_ENABLED`.
- Event auto sync runs if `EVENT_AUTO_SYNC_ENABLED`.
- Zoom auto sync runs if `ZOOM_AUTO_SYNC_ENABLED`.

## Gmail Current Behavior

| Topic | Current behavior |
| --- | --- |
| Initial import | `importGmailMessages` queries Gmail inbox and sent messages. Default non-incremental query starts after `2025/12/31`. |
| Pagination | Gmail `nextPageToken` stored separately for inbox and sent. |
| Batch size | Manual `maxResults`; auto sync uses `GMAIL_AUTO_SYNC_BATCH_SIZE` capped in config. |
| Upsert key | `gmail_message_id` with dedupe in SQL save path. |
| Incremental mechanism | Optional `GMAIL_INCREMENTAL_ONLY=true` uses `incremental_started_at` and one-day overlap; also syncs Gmail history/trash changes by `history_id`. |
| Checkpoint | Page tokens, incremental page tokens, `history_id`, `last_trash_sync_at`, `last_sync_at`. |
| Restart behavior | State persisted in `app_workspace.gmail`; partial progress survives if save occurs. |
| Reconnect behavior | OAuth state is stored in session; callback stores tokens in Gmail state. Expired/revoked tokens surface reconnect state. |
| Remote deletion | Gmail trash/history reconciliation marks trashed/restored where possible. |
| Risk | If `GMAIL_INCREMENTAL_ONLY=false`, manual/full-style imports can continue through old page tokens. Quota exits preserve page tokens and return retry metadata. |

## Zoho Current Behavior

| Topic | Current behavior |
| --- | --- |
| Initial import | If no durable records/marks exist, auto sync can queue an initial full sync. Existing durable data uses incremental mode by default. |
| Pagination | Per-module cursor with page, `next_page_token`, page signatures and guard checks. |
| Batch size | `ZOHO_SYNC_BATCH_SIZE`, capped at 200. |
| Upsert key | `app_zoho_records.key` = module plus Zoho ID. Leads are matched/upserted by Zoho record ID and email. |
| Incremental mechanism | Per-module modified-since cursor using module sync marks and `ZOHO_INCREMENTAL_OVERLAP_MS`. |
| Checkpoint | `integration_jobs.state.cursors`, module results, job fields, and sync marks. |
| Restart behavior | `resumeZohoSyncJobs()` resumes queued/running jobs using durable job state and worker lease fields. |
| Reconnect behavior | Diagnostics detect missing/invalid refresh tokens; reconnect is required for permanent authorization failure. |
| Remote deletion | No confirmed hard-delete reconciliation in the inspected code. Missing records in incremental runs must not delete local history. |
| Rate limits | 429/5xx retry with backoff; job status can be queued/running/retrying/failed/completed. |
| Risk | Pagination/counter/checkpoint correctness is the highest-risk integration area. Use existing Zoho tests before changes. |

## Eventbrite Current Behavior

| Topic | Current behavior |
| --- | --- |
| Initial import | Lists organizations, then events with `status=all`, `page_size=50`, bounded by `maxEvents`. |
| Pagination | Pages through events and attendees, but events scan stops at page 50 and deletion scan can stop earlier at `EVENTBRITE_DELETE_SCAN_PAGES`. |
| Batch size | `EVENT_AUTO_SYNC_MAX_EVENTS`/manual `max_events`; attendee fetches run in batches of 6 events. |
| Upsert key | Existing event by `eventbrite_event_id`; can merge spreadsheet duplicates. Attendee ID `EB-<eventbrite_attendee_id>`. |
| Incremental mechanism | Optional `EVENTS_INCREMENTAL_ONLY=true` skips new local records older than `events_incremental_started_at`; it is not a complete provider delta feed. |
| Checkpoint | Imported event/attendee ID lists and `last_sync_at`. |
| Restart behavior | State persists in `app_workspace.eventbrite` and `app_events`; no durable job cursor table. |
| Reconnect behavior | OAuth/private token state; credentials missing fail clearly. |
| Remote deletion | Return payload reports `deleted_events: 0`; code marks duplicate merges but does not hard-delete absent remote events. |
| Risk | This is still a bounded re-scan/upsert model, not a full durable incremental sync. |

## Zoom Current Behavior

| Topic | Current behavior |
| --- | --- |
| Initial import | Meetings are fetched by configured users/accounts and historical report settings. Calls are fetched from phone/report APIs. |
| Pagination | Uses Zoom `next_page_token` for meetings, participants, registrants, users and calls. |
| Batch size | `ZOOM_AUTO_SYNC_MAX_MEETINGS`, `ZOOM_AUTO_SYNC_MAX_CALLS`, plus participant/user limits. |
| Upsert key | Meetings/events by Zoom meeting ID/UUID where present; calls by provider call ID. |
| Incremental mechanism | Meeting/report paths use last successful sync plus overlap days when sync state exists; calls use configured call history window. |
| Checkpoint | Zoom state in `app_workspace.meta.zoom`, `last_sync_at`, `last_call_sync_at`, and migration support for `zoom_sync_state`. |
| Restart behavior | State persists after save; no generic durable job table for Zoom. |
| Reconnect behavior | Env credentials only; missing/invalid credentials show status/errors. |
| Remote deletion | No confirmed hard-delete path for missing meetings/calls. |
| Rate limits | Retries 429/502/503/504 and applies `ZOOM_REQUEST_DELAY_MS`. |
| Risk | Calls are stored as a large JSON array in workspace meta; list endpoints page within JSON using SQL, but sync storage is still not normalized. |

## Full Re-import / Bounded Scan Areas

- Eventbrite uses bounded provider scans and upserts.
- Zoom uses bounded provider/report scans and upserts.
- Gmail can behave like continuing historical import unless `GMAIL_INCREMENTAL_ONLY=true`.
- Zoho is the most durable incremental architecture and should be the model for future provider sync work.

## Known Sync Rules

- Do not run provider sync from normal list-page rendering.
- Do not start full provider sync automatically on page open.
- Do not delete local historical provider data because an incremental run did not return it.
- Persist checkpoints before reporting success.
- Keep rate-limit state visible in integration overview.
- For local servers sharing production DB, disable workers with `BACKGROUND_JOBS_ENABLED=false` and/or `ZOHO_SYNC_WORKER=false`.
