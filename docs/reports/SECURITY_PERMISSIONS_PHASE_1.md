# Security / Permissions Phase 1

Date: 2026-10-12

## Scope

Phase 1 was limited to backend authorization and record-level permissions. No deploy, commit or push was performed. UI, CSS, service worker, and the earlier performance pass were left untouched.

## Pre-Change State

`git status` and `git diff` were reviewed before security edits. The tree already contained prior performance work in `server/dashboard.js`, `scripts/frontend-startup-audit.js`, plus untracked performance reports. Those changes were preserved.

The runtime path confirmed for this pass is:

`app.js -> /api/* -> server.js -> server/routes/index.js Routes.handleApi -> route modules -> PostgreSQL or workspace storage`.

## Existing Controls Confirmed

- Central authorization policy already existed in `server/authorization.js`.
- Member list routes for leads, tasks, applications and emails already clamp owner filters.
- Detail/write routes for leads, tasks, applications, evidence and emails already call `requireRecord`.
- Sensitive/mass-assignment fields are rejected by `rejectProtectedFields`.
- Team-only routes already protect imports, syncs, monitoring, audit, contacts, Zoom meetings/calls, and review/enrolment actions.
- User management is developer-only through `Auth.requireDeveloperAccess`.
- Static serving is allowlisted in `server/static-files.js` and covered by `scripts/security-static-smoke-test.js`.

## Changes Made

| File | Change |
| --- | --- |
| `server/authorization.js` | Added `attendee` as a centrally authorized record type for PostgreSQL and workspace storage. Members can only write attendee check-ins when the attendee is linked to one of their leads. |
| `server/routes/events.js` | Added `requireRecord(user, 'attendee', id)` before attendee check-in in both direct PostgreSQL and workspace paths. |
| `server/routes/dashboard.js` | Made `/api/dashboard/totals` team-only because it is a workspace-wide aggregate. |
| `scripts/authorization-test.js` | Added `/api/dashboard/totals` to the team-only authorization regression list. |
| `package.json` | Added `npm run test:authorization` for the isolated IDOR/mass-assignment regression suite. |
| `docs/reports/AUTHORIZATION_MATRIX.md` | Added the role and endpoint authorization matrix. |

## Resulting Policy Summary

- Member: own leads and records attached to own leads.
- Monitor: team-wide operational and review access, without developer user-management powers.
- Developer: configured developer account with full workspace/admin access.
- Workspace-wide aggregates and operational telemetry are team-only.
- Record writes use the central helper instead of route-local role checks wherever ownership is involved.

## Tests To Run

Recommended verification for this phase:

```powershell
npm.cmd run test:authorization
npm.cmd run check
node scripts/frontend-route-smoke.js
```

`test:authorization` runs against an isolated temporary server and local JSON workspace by default. It refuses non-local PostgreSQL URLs unless `AUTHZ_TEST_DATABASE_URL` points to `localhost` or `127.0.0.1`.

## Residual Notes

- Event read endpoints remain available to any signed-in user as shared calendar/marketing data.
- Unlinked attendees have no record owner, so Member check-in is denied until the attendee is linked to a lead; Monitor/Developer can still check them in.
- No production database mutations, deploy, commit or push were performed.
