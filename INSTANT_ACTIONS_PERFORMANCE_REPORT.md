# Instant Actions Performance Report

Date: 2026-09-27

## Bottlenecks Found

Normal CRM actions were using the legacy full workspace state engine:

- `loadDb()`
- `cloneDb()`
- global `recalculate()`
- `saveDb()` / broad PostgreSQL table sync

This made single-record writes wait behind unrelated data loading and full-table persistence.

## Routes Migrated Away From `loadDb` / `saveDb`

- `PATCH /api/leads/:id`
- `POST /api/leads/:id/notes`
- `POST /api/tasks`
- `POST /api/tasks/:id/complete`
- `POST /api/applications`

These now use targeted PostgreSQL transactions when PostgreSQL storage is active.

## Fast Repository Methods Added

Implemented in `server.js` as focused repository-style functions:

- `updateLeadFastDb`
- `addLeadNoteFastDb`
- `createTaskFastDb`
- `completeTaskFastDb`
- `createApplicationFastDb`
- `appendAuditFast`

Each path performs only the required row-level SQL and one audit insert.

## Recalculate Changes

Server-side full `recalculate()` is no longer in the critical path for the migrated routes.

Frontend still uses local `recalculate(data)` after optimistic changes to keep visible counters consistent, but it does not trigger a network bootstrap reload.

## Optimistic UI Actions

- Lead stage changes now update immediately in the UI.
- Task completion was already optimistic and now hits a fast backend path.
- Lead update and task create patch local state from the mutation response instead of refreshing the workspace.

## Bootstrap Refreshes Removed

For the migrated frontend actions:

- No `/api/bootstrap` refresh after lead stage update.
- No full workspace refresh after lead edit.
- No full workspace refresh after task create.
- No full workspace refresh after application create.
- No full workspace refresh after add note.

## External API Calls Removed From Request Path

The migrated routes do not call Gmail, Zoom, Eventbrite, Meta, Apollo, or Google Sheets.

## DB Indexes Added

- `app_leads(stage)`
- `app_leads(owner_id)`
- `app_leads(created_at)`
- `app_tasks(lead_id)`
- `app_tasks(status)`
- `app_tasks(due_at)`
- `app_applications(lead_id)`
- `app_emails(received_at)`

## Before / After Timings

No fake benchmark values are included. The current local session could not perform authenticated mutation benchmarks because the saved environment password was not accepted.

Expected qualitative change:

- Before: one-record mutations entered full workspace load/save.
- After: migrated routes use one small transaction and return minimal payloads.

The server now logs a `[perf]` warning if a normal CRM write still falls through to the legacy `loadDb()` path.

## Remaining Slow Actions

Still legacy or partially legacy:

- Lead creation
- Programme opportunity creation
- Call logging
- Email recording / response actions
- Application review / contract / enrolment
- Evidence upload / review
- Event attendee check-in
- Import and integration actions

## Remaining Legacy Paths

The legacy state engine remains for imports, syncs, compatibility routes, and lower-frequency actions that have not yet been migrated.

## Recommended Next Phase

Continue action-by-action:

1. Application review / contract / enrolment.
2. Evidence actions.
3. Call logging and email recording.
4. Lead creation and programme opportunity creation.
5. Replace full-refresh frontend handlers with local state patches.
