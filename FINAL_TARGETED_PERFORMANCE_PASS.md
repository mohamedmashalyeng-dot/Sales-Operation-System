# Final Targeted Performance Pass

Date: 2026-10-12

## 1. Why admin-overview was slow

`/api/dashboard/admin-overview` was doing 8 PostgreSQL reads:

- 4 separate reads over `app_leads`
- 2 separate reads over `app_applications`
- 1 read over `app_emails`
- 1 read over `app_events`

The endpoint did not call external integrations. The delay came from repeated PostgreSQL aggregate scans, especially leads and emails.

## 2. SQL timing before

Local diagnostic before the change:

- Query count: 8
- Payload: 3.1 KB
- Warm total: about 3.4-3.6s in this local Neon-backed diagnostic

Representative observed query timings:

| Area | Observed |
| --- | ---: |
| applications count | 219 ms |
| events aggregate | 219 ms |
| enrolled programme | 260 ms |
| lead count | 2.30s |
| lead stages | 2.50s |
| lead sources | 2.58s |
| data quality | 2.80s |
| email aggregate | 3.40s |

EXPLAIN showed PostgreSQL execution was concentrated in repeated lead scans and the email aggregate. No external calls were present.

## 3. Node timing before

Warm local Node timing before:

- Run 1: 3.41s
- Run 2: 3.40s
- Run 3: 3.57s

Production baseline supplied in the task was better at about 1.22s, so local absolute timings were treated as comparative diagnostics only.

## 4. Exact change made

Changed only `server/dashboard.js` for admin overview:

- Combined 4 lead queries into 1 `WITH filtered AS MATERIALIZED` aggregate query.
- Combined 2 application queries into 1 aggregate query.
- Kept email and event aggregates separate.
- Reduced admin overview PostgreSQL query count from 8 to 4.
- Avoided materializing full lead/application JSON where only derived fields were needed.

Changed only `scripts/frontend-startup-audit.js` for route lazy-loading verification:

- The startup audit now begins on `#/today`.
- It asserts Dashboard startup requests only Dashboard widgets.
- It asserts route-specific list APIs do not fire on Dashboard startup.
- It then verifies Leads, Inbox, Events, Applications, Planner, Zoom/Meetings, and Admin load on demand.

## 5. admin-overview timing after

Function-level local diagnostic after:

- Query count: 4
- Payload: 3.1 KB
- Run 1: 1.98s
- Run 2: 2.02s
- Run 3: 2.02s

HTTP endpoint local diagnostic after:

- Run 1: 2.39s
- Run 2: 2.06s
- Run 3: 2.25s

This is an improvement in the same local diagnostic environment. No database index or schema change was applied.

## 6. Dashboard requests before

Local code trace before this pass already showed Dashboard startup using:

- `/api/bootstrap`
- `/api/dashboard/summary`
- `/api/dashboard/my-work`
- `/api/dashboard/priority-leads`

No route-specific list API was reproduced locally on Dashboard startup. The previous automated audit started on the Leads route, so it did not guard Dashboard startup directly.

## 7. Dashboard requests after

The updated frontend startup audit begins on Dashboard and passed.

Dashboard startup now verifies:

- `/api/bootstrap`
- `/api/dashboard/summary`
- `/api/dashboard/my-work`
- `/api/dashboard/priority-leads`

It verifies these do not fire on Dashboard startup:

- `/api/leads`
- `/api/tasks`
- `/api/events`
- `/api/emails`
- `/api/applications`
- `/api/meetings`
- `/api/zoom/calls`
- `/api/integrations/zoho/records`
- `/api/integrations/zoho/status`

## 8. Route-lazy APIs

The app code was already route-aware for these page datasets. This pass added test coverage that enforces the behavior:

- Leads: `/api/leads`
- Tasks: `/api/tasks`
- Events: `/api/events`
- Inbox: `/api/emails`
- Applications: `/api/applications`
- Meetings: `/api/meetings`
- Calls: `/api/zoom/calls`
- Zoho records: `/api/integrations/zoho/records`
- Zoho status: `/api/integrations/zoho/status`

## 9. Duplicate requests

No duplicate route-specific request was found in the local frontend audit.

The audit verifies:

- Admin dashboard uses one `/api/dashboard/admin-overview` request.
- Inbox uses one bounded `/api/emails` request.
- Events uses one bounded `/api/events` request.
- Applications uses one bounded `/api/applications` request.
- Planner uses at most one bounded `/api/tasks` request.
- Zoom/Meetings uses one bounded `/api/meetings` request.

## 10. Files changed

- `server/dashboard.js`
- `scripts/frontend-startup-audit.js`
- `FINAL_TARGETED_PERFORMANCE_PASS.md`

## 11. Tests passed

Commands passed:

```bash
node --check server/dashboard.js
node --check app.js
node --check scripts/frontend-startup-audit.js
node scripts/frontend-route-smoke.js
npm.cmd run check
```

`npm.cmd run check` passed all included frontend, security, Zoho, dashboard, leads, bootstrap, dedupe, and build checks.

## 12. Scope confirmation

Not changed:

- UI
- CSS
- Readdy styling
- Service Worker
- `sw.js`
- database schema
- database provider
- Neon configuration
- indexes
- bootstrap architecture
- summary endpoint
- my-work endpoint
- priority-leads endpoint
- leads pagination
- email indexes
- events pagination
- monitoring SWR/snapshot
- authentication/session cache
- Zoho sync architecture
- Gmail integration
- Zoom integration
- permissions/security logic
- API response contracts

No commit, push, deploy, or merge was performed.
