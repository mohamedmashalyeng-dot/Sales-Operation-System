# Performance Analysis

Date: 2026-10-12

## Summary

The UI rollback helped remove the heavier Readdy styling layer. The current frontend is not the main bottleneck.

Measured frontend assets:

| File | Size |
| --- | ---: |
| `app.js` | 260.6 KB |
| `styles.css` | 189.5 KB |
| `sw.js` | 1.7 KB |
| `index.html` | 1.4 KB |

Frontend smoke result:

- Startup audit passed.
- 11 startup requests recorded.
- Route smoke passed for login, dashboard, leads, inbox, tasks, applications, meetings, Zoho, and admin dashboard.

Main finding:

- Node request handling is fast.
- Database pool acquisition is fast.
- Most slow requests are spending time around PostgreSQL-backed page APIs.
- Some app-level overhead is also visible, especially application backfill checks.

## Commands Run

```bash
npm.cmd run test:frontend
npm.cmd run diagnose:api-latency
npm.cmd run diagnose:query-explain
node --check app.js
node --check sw.js
```

## Hotspots

### 1. Inbox Emails

Endpoint:

```text
/api/emails?status=Unanswered&limit=50
/api/emails?status=All&search=apprentice&limit=50
```

Observed:

- Unanswered inbox: about 1.1-1.3 seconds.
- Search: about 1.2-1.4 seconds.
- Response payload: about 38-43 KB.
- Query label: `emails_page`.

Code area:

- `server/emails.js`
- `emailFilterSql`
- `buildFilteredEmailPageQuery`
- `loadFilteredEmailPageSql`

Likely causes:

- Search uses `strpos(lower(concat_ws(...)))`, which is hard for normal indexes.
- Email filtering includes JSONB-derived labels and response-state logic.
- The unanswered index exists in `sql/2026-09-30_email_unanswered_page_index.sql`, but search still needs a better strategy.

Recommended work:

1. Confirm production has these migrations applied:
   - `sql/2026-09-26_scalability_foundation.sql`
   - `sql/2026-09-30_email_unanswered_page_index.sql`
   - `sql/2026-10-06_dashboard_email_unread_index.sql`
2. Add a search-focused generated column or expression index for email search text.
3. Keep `limit=50`; do not increase it.
4. Add a targeted script for inbox search timing before and after any index change.

Success target:

- Unanswered inbox under 500 ms.
- Email search under 700 ms.

### 2. Applications List

Endpoint:

```text
/api/applications?limit=50
```

Observed:

- About 0.77-0.97 seconds.
- Query label: `applications_page`.
- SQL execution from explain can be much lower than app-observed duration.

Code area:

- `server/applications.js`
- `loadApplicationListDb`
- `runEnrolledLeadApplicationBackfill`

Important note:

`loadApplicationListDb` runs enrolled-lead application backfill when there is no cursor:

```text
if (!options.cursor) await runEnrolledLeadApplicationBackfill();
```

During diagnosis, this logged repeatedly:

```text
Lead application backfill found no leads missing applications.
```

Likely cause:

- The applications list is doing maintenance work during normal page reads.
- Even when no applications are created, the check adds avoidable latency.

Recommended work:

1. Move enrolled lead application backfill out of GET `/api/applications`.
2. Run it on startup, schedule, admin action, or after lead stage changes.
3. Cache the "no missing applications" result briefly if it must remain in the request path.

Success target:

- Applications list under 300-400 ms.

### 3. Tasks Planner

Endpoint:

```text
/api/tasks?status=open&bucket=overdue&limit=80&include_counts=true
```

Observed:

- About 0.47-0.79 seconds.
- Query labels:
  - `tasks_page`
  - `tasks_counts`

Code area:

- `server/tasks.js`
- `loadTaskBucketCounts`
- task page query in `loadTaskPage`

Likely causes:

- The page query and counts query run together.
- `tasks_counts` scans task buckets for all tasks.
- Counts are useful, but they do not always need to block the first render.

Recommended work:

1. Return the task page first and load counts separately.
2. Cache task bucket counts for 30-60 seconds.
3. Confirm `app_tasks_status_due_idx` exists from `sql/2026-09-26_scalability_foundation.sql`.

Success target:

- First task page under 350 ms.
- Counts allowed to refresh async.

### 4. Leads List

Endpoint:

```text
/api/leads?limit=100
```

Observed:

- Warm range about 290-577 ms.
- Concurrent with bootstrap reached about 698 ms.
- Query label: `leads_page`.

Code area:

- `server/leads.js`
- `buildLeadPageQuery`

Likely causes:

- Larger payload around 62 KB.
- Query time varies across runs.
- Remote Neon database round trip is part of the baseline.

Recommended work:

1. Keep leads page bounded.
2. Review selected columns and remove fields not needed for the list view.
3. Consider `limit=50` default if UX allows.
4. Confirm `app_leads_created_id_idx` exists.

Success target:

- Leads page under 300-400 ms.

### 5. Bootstrap

Endpoint:

```text
/api/bootstrap
```

Observed:

- Usually 150-200 ms.
- Occasional spike around 390-450 ms.
- Payload around 9.6 KB.

Code area:

- `server/bootstrap.js`

Current status:

- This is acceptable compared with the other hotspots.
- Keep watching it, but do not start here.

Success target:

- Keep under 250 ms most of the time.

## What To Work On First

Recommended order:

1. Applications backfill removal from GET `/api/applications`.
2. Email inbox/search indexes and query plan.
3. Task counts async/cache.
4. Leads payload and default limit review.
5. Bootstrap monitoring only.

Why this order:

- Applications has a clear app-level fix.
- Emails is the biggest user-visible delay.
- Tasks can improve quickly by decoupling counts.
- Leads is already bounded but can be trimmed.

## Quick Win Plan

### Quick Win 1: Stop Backfill On Every Applications Read

Change:

- Remove or gate `runEnrolledLeadApplicationBackfill()` from the first page GET path.
- Run it after lead stage updates or on a scheduled/admin maintenance path.

Expected impact:

- Faster applications page.
- Less repeated database maintenance on normal browsing.

Validation:

```bash
npm.cmd run diagnose:api-latency
npm.cmd run diagnose:query-explain
```

### Quick Win 2: Cache Task Counts

Change:

- Cache `loadTaskBucketCounts` for a short TTL.
- Return stale counts while refreshing if needed.

Expected impact:

- Faster task planner first paint.

Validation:

```bash
npm.cmd run diagnose:api-latency
```

### Quick Win 3: Email Search Index

Change:

- Add a dedicated normalized search text expression/generated column.
- Index it with trigram or full-text search, depending on the target search behavior.

Expected impact:

- Faster inbox search.

Validation:

```bash
npm.cmd run diagnose:query-explain
npm.cmd run diagnose:email-regression
```

## Current Verdict

The app is not slow because of the restored UI files. The biggest wins are backend/database work:

- Remove read-time maintenance from application listing.
- Optimize email filtering/search.
- Decouple or cache task counts.
- Trim lead list payload if needed.
