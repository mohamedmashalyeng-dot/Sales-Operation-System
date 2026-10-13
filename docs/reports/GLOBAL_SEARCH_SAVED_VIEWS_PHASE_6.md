# Global Search + Saved Views - Phase 6

Date: 2026-10-12

## Scope

- Added permission-aware global search at `GET /api/search?q=&limit=`.
- Kept legacy `/api/dashboard/search` working through the same implementation.
- Added personal saved views at `GET/POST/PATCH/DELETE /api/saved-views`.
- Added frontend Ctrl/Cmd+K search UX and saved-view controls for Leads, Inbox, Planner tasks, and Applications.
- No deployment, commit, or push was performed.

## Global Search

- Search is server-side and requires a signed-in user.
- Minimum query length is 2 characters.
- Results are bounded to a maximum of 5 per entity.
- Search groups covered:
  - Leads
  - Applications
  - Tasks
  - Emails
  - Meetings
  - Calls
- Results are normalized as `type`, `id`, `title`, `subtitle`, `meta`, and `route`.
- Member users are scoped in SQL by lead ownership; team/review/admin/developer users can search across the team.
- Email search intentionally excludes message body text to avoid expensive scans and oversharing.
- Frontend uses debounce, `AbortController`, Ctrl/Cmd+K, Arrow Up/Down, Enter, and Escape.
- Startup makes no search request.

## Saved Views

- Saved views are user-owned filter presets.
- They store filters only; records are not copied or duplicated.
- Supported entities:
  - `leads`
  - `inbox`
  - `tasks`
  - `applications`
  - `events`
  - `zoom`
- Filter keys and values are validated server-side.
- Users can save, apply, rename, set default, and delete their own views.
- Saved views are not shared between users.
- Storage added:
  - `app_saved_views`
  - `app_saved_views_user_entity_idx`

## Performance Notes

`npm run diagnose:global-search` was run against PostgreSQL.

Sample query: `Anca`

- Returned groups: leads 5, tasks 5, emails 5.
- Query timings:
  - Applications: 164.2 ms
  - Leads: 663.4 ms
  - Emails: 720.1 ms
  - Calls: 148.9 ms
  - Meetings: 149.9 ms
  - Tasks: 554.4 ms
- Lead EXPLAIN sample:
  - Node type: Limit
  - Actual total: 381.552 ms
  - Actual rows: 5

The endpoint is bounded and permission-scoped. If more speed is needed, the next focused pass should target search indexes or a dedicated search projection.

## Verification

Passed:

- `npm run test:authorization`
- `npm run test:my-day`
- `npm run test:frontend`
- `npm run test:automations`
- `npm run test:admissions`
- `npm run test:global-search`
- `npm run test:saved-views`
- `npm run check`
- `npm run diagnose:lead-360`
- `npm run diagnose:global-search`

Notes:

- Automation DB checks were skipped unless `AUTOMATION_TEST_DATABASE_URL` is set, matching the existing script behavior.
- Lead dedupe DB tests were skipped unless `DEDUPE_TEST_DATABASE_URL` is set, matching the existing script behavior.
