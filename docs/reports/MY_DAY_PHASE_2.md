# My Day / Command Center Phase 2

Date: 2026-10-12

## Scope

Phase 2 adds a focused My Day page for the current signed-in user. The goal is to answer "what should I do next?" without loading full leads, tasks, emails, applications, events, or meetings tables into the browser.

No deploy, commit, push, external API sync, or Phase 1 authorization weakening was performed.

## Implementation

| Area | Change |
| --- | --- |
| Backend | Added `GET /api/dashboard/my-day` in `server/routes/dashboard.js`. |
| Backend query | Added `loadDashboardMyDayDb` in `server/dashboard.js` using local PostgreSQL tables only. |
| Fallback/test path | Added `loadDashboardMyDayLocal` for isolated fixtures and local storage mode. |
| Frontend | Added `#/my-day` as a compact Command Center page in `app.js`. |
| Styling | Added responsive My Day KPI and action-list styles in `styles.css`. |
| Tests | Added `scripts/my-day-test.js`, extended frontend startup/route smoke tests, and added `npm run test:my-day`. |
| Diagnostics | Added `npm run diagnose:my-day` for direct `EXPLAIN (ANALYZE, BUFFERS)` on the My Day SQL. |

## Data Rules

- The production page uses only `/api/dashboard/my-day`.
- The browser filters only the returned `priority_actions`, capped at 20.
- The endpoint reads from local PostgreSQL tables and synced local records only.
- No Gmail, Zoom, Eventbrite, Zoho, Apollo, or other external API calls are made.
- The scope is `mode: mine`, based on the current session user owner id.
- Summary buckets are bounded operational signals for the queue, not workspace-wide reporting totals.

## Action Signals

The backend combines these buckets:

- overdue tasks
- tasks due today
- unanswered inbound emails
- applications needing action
- meetings today
- due lead follow-ups
- at-risk leads

The SQL bounds source buckets before merging them into the priority queue:

- open due tasks: 100
- unanswered emails: 50
- application reviews: 50
- meetings today: 20
- lead follow-ups: 50
- at-risk leads: 50
- final priority actions returned to the client: 20

## Authorization

Phase 1 authorization remains in place. The route requires a current session user through `Auth.currentSessionUser`. The query is scoped to records owned by that user or attached to leads owned by that user.

Team-only routes such as monitoring, audit, contacts, and dashboard totals remain protected separately.

## Measurement

Command run:

```powershell
npm.cmd run diagnose:my-day
```

Measured against the configured PostgreSQL database using representative user `U-1`:

| Metric | Result |
| --- | ---: |
| PostgreSQL planning time | 8.447 ms |
| PostgreSQL execution time | 998.230 ms |
| EXPLAIN observed round trip | 2718.9 ms |
| Payload query duration | 1267.3 ms |
| Priority actions returned | 20 |
| Bounded summary signals | 250 |

Earlier unbounded versions measured roughly 10.1 seconds SQL execution, then roughly 2.0 seconds after the first cap. The Phase 2 baseline before the targeted SQL pass was still about 998 ms execution and 1267 ms payload duration.

## My Day SQL Performance Pass

Date: 2026-10-12

Objective: reduce only `GET /api/dashboard/my-day` PostgreSQL cost without changing the response contract, authorization, UI, or other dashboard/API endpoints.

### Before

Measured with `npm.cmd run diagnose:my-day` against the configured PostgreSQL data:

| Metric | Before |
| --- | ---: |
| Planning time | 8.447 ms |
| SQL execution time | 998.230 ms |
| EXPLAIN observed round trip | 2718.9 ms |
| Payload query duration | 1267.3 ms |
| Priority actions | 20 |

### Root Cause

`EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` showed repeated work in My Day's lead buckets:

| Component | Before evidence | Root cause |
| --- | --- | --- |
| At-risk leads | `app_leads` seq scans over about 129k rows, temp writes, and external sort in the first split attempt | owner/date predicates were hidden behind the `context` CTE and broad stale-lead ordering. |
| Lead follow-ups | `app_leads` scan/sort before the targeted index | no My Day-specific `(owner_id, next_action_at)` path. |
| Open tasks | tens of thousands of due tasks read before final 100 | existing due index was usable, but the owner predicate was blocked by a join to leads. |
| Unanswered emails | parallel seq scan over `app_emails`, about 35k shared hits | this is now the slowest remaining component, but total SQL time is already below target. |
| Priority ranking | final 250 candidates sorted with top-N/quicksort | not the bottleneck. |

No separate permission queries were added; the route still uses the authenticated user id and SQL ownership predicates.

### Optimization

- Removed the large reusable `scoped_leads` CTE from the production SQL.
- Replaced My Day bucket predicates that joined through `context` with direct `$1/$2/$3` parameters so PostgreSQL can use indexes.
- Trimmed bucket projections from `l.*`, `t.*`, and `e.*` to only fields needed by the response, avoiding JSON/body payloads inside CTE sorts.
- Split at-risk leads into high-priority and stale branches while preserving the same priority ordering and final limit.
- Added narrowly scoped My Day lead indexes in `sql/2026-10-12_my_day_lead_indexes.sql`:

```sql
create index concurrently if not exists app_leads_my_day_followups_idx
  on app_leads (owner_id, next_action_at, id)
  where next_action_at is not null;

create index concurrently if not exists app_leads_my_day_priority_idx
  on app_leads (
    owner_id,
    (coalesce(priority, data->>'priority', '')),
    (coalesce(next_action_at, created_at)),
    id
  );

create index concurrently if not exists app_leads_my_day_action_order_idx
  on app_leads (
    owner_id,
    (coalesce(next_action_at, created_at)),
    id
  );
```

### After

Final `npm.cmd run diagnose:my-day`:

| Metric | After |
| --- | ---: |
| Planning time | 4.455 ms |
| SQL execution time | 187.129 ms |
| EXPLAIN observed round trip | 795.4 ms |
| Payload query duration | 346.2 ms |
| Priority actions | 20 |
| Shared reads | 0 |

Component evidence from the final verbose plan:

| Component | Execution evidence | Buffers / notes |
| --- | --- | --- |
| Lead follow-ups | `app_leads_my_day_followups_idx`, about 0.09 ms for 50 rows | 37 shared hits. |
| At-risk leads | `app_leads_my_day_priority_idx` / `app_leads_my_day_action_order_idx`, about 0.26 ms for 50 rows | 20 shared hits. |
| Open tasks | `app_tasks_due_at_idx`, about 19 ms for 100 rows | 4611 due-task rows scanned, then bounded. |
| Applications needing action | about 4.3 ms, 0 rows for this snapshot | JSON requirements check remains bounded by the applications table size. |
| Meetings today | about 0.1 ms, 0 rows for this snapshot | 90 event rows scanned. |
| Unanswered emails | parallel seq scan, about 189 ms in one verbose run | slowest remaining branch; no extra email index was added because final total SQL is below target. |
| Final priority ranking | 250 candidates, in-memory quicksort/top-N | not a hotspot. |

### Result Equivalence

- Response shape is unchanged: same summary keys, priority action fields, routes, priorities, ordering contract, `limit 20`, and empty-state behavior.
- The measured snapshot kept the same bounded summary values before and after the pass: 50 at-risk leads, 100 overdue tasks, 50 follow-ups, 50 unanswered emails, 0 meetings today, 0 tasks due today, and 0 applications needing action.
- `scripts/my-day-test.js` continues to assert owner scope, summary values, no duplicate action IDs, deterministic ordering, route targets, and the 20-action cap.

### Files Changed For This Pass

- `server/dashboard.js`
- `sql/2026-10-12_my_day_lead_indexes.sql`
- `docs/reports/MY_DAY_PHASE_2.md`

## Verification

Commands run:

```powershell
node --check server/dashboard.js
node --check server/routes/dashboard.js
node --check server/routes/index.js
node --check app.js
node --check scripts/my-day-explain.js
npm.cmd run test:my-day
npm.cmd run test:frontend
npm.cmd run test:authorization
npm.cmd run diagnose:my-day
```

Results:

- `test:my-day` passed.
- `test:frontend` passed with My Day asserting a single `/api/dashboard/my-day` request and no page-list dataset requests.
- `test:authorization` passed with 135 checks.
- `diagnose:my-day` completed and captured EXPLAIN metrics.

`npm.cmd run check` should also be run before release because it executes the broader frontend, backend, dedupe, bootstrap, security, Zoho, and TypeScript checks.

## Residual Notes

- The My Day page is available from navigation but the existing default landing route remains Dashboard.
- The endpoint is intentionally a command queue, not a reporting endpoint. Use Dashboard or Monitoring for full totals.
- The remaining latency is database-side and should be improved with My Day-specific indexes after validating against production data size.
