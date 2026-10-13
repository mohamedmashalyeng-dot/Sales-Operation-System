# Frontend Request Regression Fix

## Scope

Fixed the frontend data lifecycle regression that caused normal page load to request a full workspace snapshot, fall back to every collection, and repeatedly request email pages.

No SQL, sync job, deploy, commit, or backend credential changes were made.

## Root Cause

`WorkspaceProvider` runs the initial backend load on app startup:

- File: `frontend/src/store/WorkspaceProvider.tsx`
- Function/effect: initial `useEffect`
- Line: 673
- Trigger: first render of the workspace provider

That effect called `loadBackendWorkspace()`.

Before this fix, `loadBackendWorkspace()` did all of the following on startup:

- `GET /api/bootstrap`
- `GET /api/workspace/full`
- if `/api/workspace/full` failed, fallback requests for leads, tasks, applications, emails, events, meetings, calls, and notifications
- `loadAllEmailPages()`, which repeatedly called `/api/emails?limit=100...` until the backend reported no more pages

This made `/api/emails` look like an infinite loop even while the user was idle. It was a global hydration loop, not an Inbox route-level loader.

## Callers Found

### `/api/emails`

Current frontend caller after the fix:

- File: `frontend/src/pages/inbox/page.tsx`
- Function: `loadEmailPage`
- Line: 87
- Request line: 109
- Trigger: entering Inbox or changing Inbox page
- Repeat behavior: one request per requested page; no background all-pages loop

Removed caller:

- File: `frontend/src/store/backendSync.ts`
- Function: `loadAllEmailPages`
- Trigger: `loadBackendWorkspace()` fallback after `/api/workspace/full` failed
- Why it repeated: it followed `next_cursor` for up to 100 pages, using `limit=100`
- Status: removed from frontend startup path

### `/api/workspace/full`

Backend route still exists:

- File: `server/routes/bootstrap.js`
- Route: `GET /api/workspace/full`
- Line: 100
- Handler behavior: loads `Storage.loadDb()` and serializes a full workspace snapshot

Frontend automatic caller:

- Status: removed
- Verification: `rg` found no `/api/workspace/full` usage under `frontend/src`

This endpoint no longer runs on normal page load.

### `/api/notifications?limit=100`

Removed from startup fallback:

- Previous caller: `loadBackendWorkspace()` collection fallback
- Current behavior: no startup request from frontend workspace boot
- Failure containment: notifications failure can no longer block workspace startup through the removed global fallback

## Fix Applied

### Startup

`frontend/src/store/backendSync.ts` now keeps `loadBackendWorkspace()` lightweight:

- calls `/api/bootstrap`
- maps users and integration statuses
- initializes collections as empty
- does not call `/api/workspace/full`
- does not call leads/tasks/applications/emails/events/meetings/calls/notifications
- does not call sync endpoints

### Inbox

`frontend/src/pages/inbox/page.tsx` now owns email loading:

- lazy-loads email page data only when Inbox is opened
- uses `/api/emails?limit=50&include_total=true` for page 1
- uses cursor pagination for additional pages
- aborts stale in-flight email requests
- does not load all email pages in the background
- manual Gmail sync still remains explicit and user-triggered only

## Verification

Commands run:

- `npm.cmd run ui:type-check` passed
- `npm.cmd run ui:build` passed
- `node --check server/routes/bootstrap.js` passed
- `node --check server/routes/index.js` passed
- `node scripts/frontend-route-smoke.js` passed
- `rg -n "/api/workspace/full|loadAllEmailPages|/api/notifications\\?limit=100|/api/emails\\?" frontend/src` only found the Inbox lazy email request

## Expected Network Behavior

On normal workspace load:

- `/api/bootstrap` may run
- `/api/integrations/overview` may run after bootstrap
- `/api/workspace/full` should not run
- `/api/emails` should not run unless the user opens Inbox
- `/api/notifications?limit=100` should not run from workspace startup

On Inbox:

- first Inbox view requests one email page
- changing Inbox page can request the next needed page
- there is no automatic all-pages email crawl
