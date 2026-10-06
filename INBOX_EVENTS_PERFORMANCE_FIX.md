# Inbox and Events performance fix

Generated 2026-10-01.

## Production symptom

Before this pass, Chrome showed:

| Request | Production time |
|---|---:|
| `/api/emails?limit=50&status=Unanswered&label=All...` | ~19.14 s |
| `/api/bootstrap` | ~6.85 s |
| `/api/events?limit=5000` | ~3.51 s |

Leads was already fixed and was not optimized further.

## What changed

- Removed the frontend hot-path request for `/api/zoom/events?limit=5000`; it now requests `/api/zoom/events?limit=100`.
- Reduced the normal Events page request to `/api/events?limit=50`.
- Added cursor pagination to `/api/events` with a hard cap of 100 rows.
- Removed Events count work from the hot path unless `include_total=true`.
- Changed `/api/events` to return list summaries only. Full attendees are fetched only for one event detail dialog via `GET /api/events/:id`.
- Added `Server-Timing` for `/api/events` and `/api/zoom/events`.
- Added `Server-Timing` for filtered Inbox queries, including `email-filter-query` and `emails-page-query`.
- Added `npm run diagnose:inbox-events`.
- Bumped the frontend app cache key to `20261001-inbox-events-hotpath`.

## Leads empty screen check

The data was not deleted. A direct local API check returned:

| Endpoint/function | Result |
|---|---:|
| `loadLeadPage({ limit: 5, include_total: true })` | 5 rows |
| Total active leads reported by API | 42,647 |

The likely cause of the temporary `0 leads` screen is a stale production `app.js`/HTML cache from before the frontend was changed to fetch Leads from `/api/leads` after slim bootstrap. The app script URL and service-worker cache name were bumped.

## Inbox SQL

Current Inbox Unanswered query shape:

```sql
select jsonb_build_object(
  'id', id,
  'lead_id', coalesce(lead_id, ''),
  'first_name', coalesce(first_name, ''),
  'last_name', coalesce(last_name, ''),
  'email', coalesce(email, ''),
  'from', coalesce(email, ''),
  'subject', coalesce(subject, '(No subject)'),
  'owner', coalesce(owner, ''),
  'date', received_at,
  'received_at', received_at,
  'created_at', received_at,
  'direction', coalesce(data->>'direction', 'inbound'),
  'response_at', response_at,
  'response_note', coalesce(response_note, ''),
  'due_at', due_at,
  'gmail_message_id', coalesce(gmail_message_id, ''),
  'gmail_thread_id', coalesce(data->>'gmail_thread_id', ''),
  'gmail_labels', coalesce(data->'gmail_labels', '[]'::jsonb),
  'gmail_label_names', coalesce(data->'gmail_label_names', '[]'::jsonb),
  'dashboard_folder', coalesce(data->>'dashboard_folder', ''),
  'trashed_at', coalesce(data->>'trashed_at', ''),
  'trash_reason', coalesce(data->>'trash_reason', ''),
  'is_read', coalesce(data->'is_read', 'true'::jsonb),
  'snippet', left(coalesce(data->>'snippet', ''), 260)
) as data
from app_emails
where not (trash condition)
  and not outbound
  and not configured internal mailbox/domain
  and response_at is null
order by received_at desc nulls last, id desc
limit 51
```

The hot list query does not select message body, HTML, raw payloads, attachments, or full thread content.

## Inbox index and EXPLAIN

Index used:

```sql
create index concurrently if not exists app_emails_unanswered_page_idx
on app_emails (received_at desc nulls last, id desc)
where not trash and not outbound and response_at is null
```

Latest EXPLAIN after cleanup:

| Metric | Value |
|---|---:|
| PostgreSQL execution | 13.820 ms |
| Planning | 0.196 ms |
| Rows scanned | 6,286 |
| Rows removed by filter | 151 |
| Index used | `app_emails_unanswered_page_idx` |
| Shared reads | 0 |
| Sort | top-N heapsort |

A normalized `needs_response` column was not added in this pass because the measured PostgreSQL execution is already ~14 ms with the partial index. The remaining large observed times are local-to-Neon/client transfer variance, not PostgreSQL execution.

## Events optimization

Before this pass, the frontend had an excessive Zoom Events request:

```js
/api/zoom/events?limit=5000
```

Current hot-path requests:

```js
/api/events?limit=50
/api/zoom/events?limit=100
```

`/api/events` now returns summary fields:

- id, name/title
- start_at, location, campaign
- capacity, registrations, attendance
- attendee_count and computed metrics
- status/description/meeting and Zoom list metadata

It does not return attendee arrays on the list path. `GET /api/events/:id` returns one full event when the user opens a dialog.

## Latest local timing

Run:

```powershell
npm.cmd run diagnose:inbox-events
```

Individual local-to-Neon run:

| Endpoint | Node total | Query | Payload |
|---|---:|---:|---:|
| `/api/bootstrap?debug_timing=true` | 1241.3 ms | `bootstrap-payload-query` 624.4 ms | 9.9 KB |
| `/api/emails?limit=50&status=Unanswered&label=All` | 2305.1 ms | `emails-page-query` 2300.3 ms | 39.1 KB |
| `/api/events?limit=50` | 1061.6 ms | `events-page-query` 1058.7 ms | 41.2 KB |
| `/api/zoom/events?limit=100` | 168.2 ms | `meetings-page-query` 163.2 ms | 25.6 KB |

Concurrent bootstrap + inbox + events run:

| Endpoint | Node total | Query | Payload |
|---|---:|---:|---:|
| `/api/bootstrap?debug_timing=true` | 828.4 ms | `bootstrap-payload-query` 826.1 ms | 9.6 KB |
| `/api/emails?limit=50&status=Unanswered&label=All` | 501.8 ms | `emails-page-query` 499.7 ms | 39.1 KB |
| `/api/events?limit=50` | 615.5 ms | `events-page-query` 614.3 ms | 41.2 KB |

DB pool acquisition stayed ~0.1 ms with no observed queueing.

## Verification

Passed:

```powershell
node --check server.js
node --check app.js
node --check scripts\inbox-events-performance.js
npm.cmd run build
npm.cmd run check
node scripts\frontend-route-smoke.js
```

`frontend-route-smoke` verified rendering for:

- login
- dashboard
- leads
- inbox
- tasks
- applications
- meetings
- monitoring

`scripts/frontend-startup-audit.js` is currently stale and fails against the completed lazy-loader and Monitoring SWR architecture. It is not part of `npm run check`.

## Files changed

- `server.js`
  - Events cursor pagination and no hot-path count.
  - Events list summary SQL and one-event detail endpoint.
  - Inbox filtered query `Server-Timing`.
  - Events/Zoom Events `Server-Timing`.
- `app.js`
  - Removed `limit=5000` Events request.
  - Uses bounded Events requests.
  - Loads full event details only when a single event is opened.
  - Keeps event metrics working from summary rows.
- `index.html`
  - Bumped `app.js` cache key.
- `sw.js`
  - Bumped shell cache and fixed cache matching for query-string assets.
- `package.json`
  - Added `diagnose:inbox-events`.
- `scripts/inbox-events-performance.js`
  - Measures bootstrap, Inbox, Events, Zoom Events and concurrent page-load pressure.

## Production retest needed

After deploying this version and clearing old service-worker assets, retest in Chrome Network:

- `/api/emails?limit=50&status=Unanswered&label=All`
- `/api/events?limit=50`
- `/api/bootstrap`

Record Chrome total, TTFB and `Server-Timing node-total`. If Chrome remains much higher than `node-total`, the remaining gap is still outside the Node.js application path.
