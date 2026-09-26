# Zoom Sync Refactor Report

## 1. Root Cause

The Zoom sync was requesting approximately 60 months of report history from:

```http
GET /v2/report/users/{userId}/meetings
```

Zoom restricts this Reports endpoint to a one-month query range that falls within the recent six-month reporting window. Requests outside that window produce errors such as code `300`.

## 2. Endpoints Involved

- `POST /oauth/token`
  - Purpose: Server-to-Server OAuth account credentials token.
  - Current implementation: token requested per Zoom account, not cached in source.

- `GET /v2/users`
  - Purpose: enumerate active account users when `ZOOM_SYNC_ALL_USERS=true`.
  - Pagination: `next_page_token`.

- `GET /v2/users/{userId}/meetings`
  - Purpose: scheduled/upcoming/previous meetings list.
  - Pagination: `next_page_token`.
  - Current implementation: continues through pages until token ends or configured meeting limit is reached.

- `GET /v2/report/users/{userId}/meetings`
  - Purpose: historical meeting reports.
  - Limit enforced now: maximum 6 months, split into 30-day ranges.
  - Pagination: `next_page_token`.

## 3. History Limits Enforced

- Added `ZOOM_REPORT_HISTORY_MONTHS`.
- Default: `6`.
- The report endpoint clamps requested history to `6` months maximum.
- The UI no longer sends `60` months to the backend.

## 4. Old Data Preservation

- No Zoom events are deleted.
- Existing records in `app_events` remain available even if Zoom no longer returns them.
- Imported meetings are matched by account + meeting UUID/ID where possible, then updated in place.

## 5. Initial Backfill

- Initial report backfill uses only the supported recent report window.
- Report requests are split into safe date ranges rather than one oversized request.
- A failure for one user records a warning and does not stop other users/accounts.

## 6. Incremental Sync

- Persistent sync state is now stored under `db.zoom.sync_state` in the existing workspace state.
- After a successful initial report sync per account/user, later report syncs start from the last successful sync with a small overlap.
- Added `ZOOM_REPORT_SYNC_OVERLAP_DAYS`, default `7`.

## 7. Deduplication

- Existing Zoom event matching uses:
  - `zoom_account_id`
  - `zoom_meeting_uuid`
  - `zoom_meeting_id`
  - spreadsheet-event fallback matching
- Added an additive migration with supporting expression indexes for Zoom IDs.

## 8. Multi-Account Behavior

- Existing multi-account environment variables remain supported:
  - `ZOOM_ACCOUNT_ID`
  - `ZOOM_CLIENT_ID`
  - `ZOOM_CLIENT_SECRET`
  - numbered variants such as `_2`
- Each account receives its own access token.
- A failure for one user/type is returned as a warning while the sync continues.

## 9. Participant Handling

- Participant import is not currently implemented as a separate persistent participant table in the existing code path.
- The migration does not add destructive participant changes.
- Future participant import should use known meeting UUIDs only and should deduplicate participant sessions.

## 10. Database Migrations

Added:

```text
sql/2026-09-26_zoom_sync_state.sql
```

It creates:

- `zoom_sync_state`
- Zoom expression indexes on `app_events`

The current compatibility layer stores live sync state in workspace JSON; the table is prepared for a later direct repository move.

## 11. Indexes

Added non-destructive indexes for:

- `(data->>'zoom_account_id', data->>'zoom_meeting_uuid')`
- `(data->>'zoom_account_id', data->>'zoom_meeting_id')`
- `(data->>'zoom_host_id', start_at)`
- `zoom_sync_state(status, last_attempt_at)`

## 12. Rate-Limit Handling

- Existing Zoom fetch wrapper retries `429`, `502`, `503`, and `504`.
- Network fetch failures are now normalized to retryable `502` errors.
- Permission/date-range failures are not retried indefinitely.

## 13. New Environment Variables

```env
ZOOM_REPORT_HISTORY_MONTHS=6
ZOOM_REPORT_SYNC_OVERLAP_DAYS=7
```

`ZOOM_HISTORY_MONTHS=60` is no longer used for the report history window.

## 14. Hostinger Considerations

- No Zoom backfill runs before the HTTP server listens.
- Existing `startAutoSync()` still starts after server startup.

## 15. Tests Performed

- `node --check server.js`
- `node --check app.js`
- `npm.cmd run build`
- `/api/health` local check

No full automated test suite exists in the repository.

## 16. Rollback

- Revert the code changes.
- The SQL migration is additive and can remain in place.
- If absolutely necessary, drop the newly added `zoom_sync_state` table and indexes after confirming no deployed code depends on them.

## 17. Remaining Zoom API Limitation

Zoom Reports cannot return arbitrary 60-month history from `/report/users/{userId}/meetings`. The CRM should keep older records once imported, but Zoom will only be queried within the supported recent reporting window.
