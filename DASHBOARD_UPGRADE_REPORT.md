# Dashboard Upgrade Report

Date: 2026-09-27

## Summary

The existing Dashboard was upgraded into a Sales + Operations Cockpit without rebuilding the application or changing the frontend framework. The dashboard now renders a shell immediately, then loads independent PostgreSQL-backed widgets in parallel. Dashboard filters update widgets only and do not call `/api/bootstrap`.

## Before / After Architecture

Before:

- Dashboard used the bootstrap workspace payload and in-memory arrays for several visible counts.
- Dashboard content was rendered as one large page block.
- Analytics were coupled to loaded CRM slices and could undercount when bootstrap pagination was active.

After:

- Dashboard uses focused endpoints:
  - `GET /api/dashboard/summary`
  - `GET /api/dashboard/pipeline`
  - `GET /api/dashboard/my-work`
  - `GET /api/dashboard/priority-leads`
  - `GET /api/dashboard/source-performance`
  - `GET /api/dashboard/integrations`
  - `GET /api/dashboard/activity?limit=15`
  - `GET /api/dashboard/search?q=...`
- Each widget has its own loading and error state.
- Filters are sent as query params and handled by reusable backend filter parsing.
- Stale dashboard requests are cancelled with `AbortController`.
- One failed widget does not block the rest of the cockpit.

## UI Changes

- Replaced the decorative dashboard hero with an operational cockpit.
- Added global dashboard filters:
  - Date Range
  - College
  - Programme
  - Intake
  - Owner
  - Lead Source
- Added exactly 6 KPI cards:
  - New Leads Today
  - Leads Requiring Follow-up
  - Open Tasks
  - Overdue Tasks
  - Unread Emails
  - New Applications
- Added operational widgets:
  - Needs Your Attention
  - My Work Today
  - Priority Leads
  - Sales Pipeline
  - Source Performance
  - Integration Health
  - Recent Activity
- Added global search in the top bar for leads, emails, applications and tasks.

The implementation reuses existing panels, stats, badges, buttons, inputs, table styles, shadows, borders and responsive breakpoints.

## SQL Aggregates Used

- KPI counts use PostgreSQL `COUNT()` with filtered aggregates.
- Sales pipeline uses `GROUP BY stage`, filtered counts, conversion, lost counts and stuck counts.
- Source performance uses `GROUP BY source` and distinct counts for leads, qualified leads, applications and enrolments.
- Priority leads use deterministic SQL signals:
  - recent inbound email
  - overdue tasks
  - recent applications
  - recent event activity
  - P0/P1 priority
- Recent activity reads only the latest audit rows with a limit.
- Search is capped at 10 results per entity type.

No dashboard endpoint loads all leads, tasks or emails for analytics.

## Filters Implemented

All dashboard analytics endpoints accept:

- `from`
- `to`
- `college_id`
- `programme_id`
- `intake_id`
- `owner_id`
- `lead_source`

The backend validates date format as `YYYY-MM-DD`, trims string filters and applies owner scoping server-side for non-manager/non-admin users.

## Role Differences

- Sales users are scoped to their own owner id on the backend.
- Managers/admin-style review users can view team-level dashboard data and use owner filtering.
- Developer/admin users can see integration retry actions.
- Integration retry buttons are not exposed unless the server says `retry_allowed: true`.

## Indexes Added

Added targeted indexes for the new query patterns:

- `app_tasks(owner_id, status, due_at)`
- `app_applications(status)`
- `app_applications(created_at)`
- `app_leads(programme_id)`
- `app_leads(source_lead_capture)`
- `app_audit(occurred_at)`

Existing indexes already covered stage, owner, created date, task due date and email received date.

## Response Sizes Observed

Live local production server on port `3001`:

| Endpoint | Size |
|---|---:|
| `/api/dashboard/summary` | 1173 bytes |
| `/api/dashboard/pipeline` | 1196 bytes |
| `/api/dashboard/my-work` | 5509 bytes |
| `/api/dashboard/priority-leads` | 3490 bytes |
| `/api/dashboard/source-performance` | 235 bytes |
| `/api/dashboard/integrations` | 925 bytes |
| `/api/dashboard/activity?limit=15` | 3827 bytes |
| `/api/dashboard/search?q=mohamed` | 4101 bytes |

## Performance Observations

- Dashboard widgets load independently and in parallel.
- Filter changes do not call `/api/bootstrap`.
- Filter requests are debounced and previous in-flight requests are aborted.
- Dashboard load does not call Gmail, Zoom, Eventbrite, Meta or Apollo APIs.
- Integration health reads safe local sync state only.

## Mobile Behavior

Mobile layout becomes a single column with this priority:

1. Needs Your Attention
2. My Work Today
3. KPI Summary
4. Priority Leads
5. Sales Pipeline
6. Integration Health
7. Source Performance
8. Recent Activity

Horizontal scrolling is avoided except inside existing table wrappers where appropriate.

## Security Verification

- Integration health payloads were checked for `access_token`, `refresh_token`, `client_secret`, API key and password terms; none were present.
- Live static checks returned `404` for:
  - `/.env`
  - `/.env.hostinger`
  - `/server.js`
  - `/package.json`
  - `/data/pathway-db.json`
  - `/src/main.ts`
  - `/hostinger.zip`

## Test Results

- `node --check server.js` passed.
- `node --check app.js` passed.
- `npm run test:security` passed.
- `npm run test:rocket` passed.
- `npm run build` passed.
- `npm run check` passed.
- Live endpoint smoke tests passed for all new dashboard endpoints.

## Remaining Recommendations

1. Move dashboard backend into a real NestJS `src/dashboard` module once the legacy compatibility bridge is retired.
2. Add dedicated stage transition timestamps to calculate true average time in stage instead of the current best available created/next-action age proxy.
3. Store evidence files outside application JSONB before adding document-heavy dashboard analytics.
4. Add browser-level automated visual regression tests for the cockpit once Playwright is available in the project.
