# API latency diagnosis

Generated 2026-09-30 after measuring the real HTTP request path with
`npm run diagnose:api-latency`. The script starts the local server, signs in with env
credentials, then calls `/api/debug/ping`, `/api/debug/db-ping`, `/api/bootstrap`, and
`/api/leads?limit=100` sequentially and together. It prints safe DB metadata only; no
connection string or credential is logged.

Chrome DevTools Timing for the deployed page showed `GET /api/leads?limit=100` at about
2.97 s total, with about 2.96 s in TTFB, about 54 microseconds sending the request, and about
1.15 ms content download. That proves the remaining problem is server-side before first byte.

Latest localhost Chrome evidence then showed no proxy/frontend gap for bootstrap:

- `/api/bootstrap` Chrome total: about 4.97 s.
- `Server-Timing`: `auth` about 2,211 ms, `build` about 2,752 ms, nested bootstrap DB about
  2,329 ms.
- `/api/leads?limit=100` Chrome total: about 3.31 s; Leads `Server-Timing` was missing before
  this pass and is now emitted on success and error paths.

## Latest precise diagnosis

The newest instrumentation starts at the first `http.createServer` callback and carries the
same trace through `handleApi()`, auth, DB, serialization, and response headers. `Server-Timing`
now includes `node-total`, `pre-handler`, `middleware`, `auth`, `db`, `query`, `serialize`, plus
the lower-level query names.

This pass added:

- Session lookup single-flight for concurrent bootstrap + Leads requests, with a 60-second
  default session-user cache TTL and invalidation on logout, password reset/change, user delete,
  and role change.
- Request-time schema/metadata checks removed from normal API paths. Production now sets
  `SKIP_SCHEMA_SETUP=true` and `LEAD_SOFT_DELETE_ENABLED=true`; `information_schema` is not
  queried after idle.
- Leads `Server-Timing` now includes `leads-query` and `leads-page-query`.
- Exact `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` diagnostics for the real bootstrap and Leads
  SQL via `npm run diagnose:query-explain`.

## Production Isolation

Current production Chrome + `Server-Timing` evidence:

| Endpoint | Chrome total | `node-total` | External gap |
|---|---:|---:|---:|
| `/api/bootstrap` | ~2,730 ms | 317.7 ms | ~2,412 ms |
| `/api/leads?limit=100` | ~2,820 ms | 413.8 ms | ~2,406 ms |

The near-identical ~2.4 s gap on two different endpoints means the remaining latency is outside
the measured Node.js application path.

Observed production `Server-Timing` details:

| Endpoint | Auth | DB/query | Main query | DB acquire |
|---|---:|---:|---:|---:|
| `/api/bootstrap` | 98.1 ms | 311.6 ms | `bootstrap-payload-query` 101.0 ms | 0.6 ms |
| `/api/leads?limit=100` | 96.1 ms | 200.4 ms | `leads-query` 200.6 ms | 0.5 ms |

The final isolation endpoints are `GET /api/health` and `GET /api/debug/ping`.
`/api/debug/ping` is enabled only while `API_DEBUG_ENDPOINTS=true`; `/api/health` is always
available. Both perform no DB query, no auth/session lookup, no integration call, no schema
check, no filesystem work, and return only:

```json
{"ok":true}
```

They still emit `Server-Timing` with `node-total`. Production test matrix to fill from Chrome:

| Run | Chrome total | Chrome TTFB | `node-total` | External gap |
|---|---:|---:|---:|---:|
| health/ping #1 | pending | pending | pending | pending |
| health/ping #2 | pending | pending | pending | pending |
| health/ping #3 | pending | pending | pending | pending |
| health/ping #4 | pending | pending | pending | pending |
| health/ping #5 | pending | pending | pending | pending |
| health/ping idle 60s #1 | pending | pending | pending | pending |
| health/ping idle 60s #2 | pending | pending | pending | pending |
| health/ping idle 60s #3 | pending | pending | pending | pending |
| health/ping idle 60s #4 | pending | pending | pending | pending |
| health/ping idle 60s #5 | pending | pending | pending | pending |

Interpretation: if Chrome is about 2,400 ms while `node-total` is about 1-5 ms, the remaining
latency is Hostinger reverse proxy/runtime/network behavior outside the app. If only the first
idle ping is slow, investigate Hostinger process wake. If every ping has the same gap, investigate
Hostinger reverse proxy/runtime/network path.

Latest full local run, with background jobs disabled and a 60-second idle repeat:

| Endpoint | Local Node duration | DB/query time | Pre-handler/middleware | Interpretation |
|---|---:|---:|---:|---|
| `/api/debug/ping` | `node-total` 0.2-0.9 ms | none | 0.0-0.1 ms | Node/router path is not adding seconds. |
| `/api/debug/db-ping` warm | 320 ms first authenticated call | auth 148 ms + `SELECT 1` 170 ms | 0.1-0.4 ms | No schema metadata query remains. |
| `/api/bootstrap` warm | 206 ms | bootstrap SQL 201 ms | 0.0-0.1 ms | Bootstrap is one DB round trip plus small mapping. |
| `/api/leads?limit=100` warm | 158-595 ms | leads SQL 155-590 ms | 0.0-0.1 ms | Leads `Server-Timing` now identifies the query directly. |
| `/api/leads?limit=100` after 60s idle | 1,801 ms in this run | leads SQL 1,800 ms | 0.0-0.1 ms | Variance is inside remote DB round trip/query, not schema checks or serialization. |
| `/api/bootstrap` after 60s idle | 366 ms | bootstrap SQL 364 ms | 0.0 ms | Pool stayed warm; no post-idle schema/setup work. |
| Concurrent bootstrap + leads | bootstrap 375 ms, leads 755 ms | concurrent DB queries 373 ms + 753 ms | 0.0-0.1 ms | Session cache hit; one app query per endpoint. |

Event-loop monitor during these local requests showed no multi-second blocking. The histogram
typically reported p95/p99 around one 20-32 ms sampling interval and low utilization during DB
waits. That points away from synchronous CPU work as the active cause of the 2.96 s Chrome TTFB.

Important deployment check: after redeploying this instrumentation, compare Chrome Network
TTFB to the response `Server-Timing` `node-total`. If Chrome still shows about 2,960 ms while
`node-total` is around 200-600 ms for a sequential warm Leads request, or around 1.2 s under
concurrent load, the remaining missing time is outside application code (Hostinger/reverse
proxy/network before the response reaches Chrome). If `node-total` also shows about 2,960 ms,
the time is inside Node and the detailed `db/query/auth/pre-handler` fields identify which
stage owns it.

## Safe DB metadata

- Storage: PostgreSQL.
- Neon pooled endpoint: yes.
- SSL configured: yes.
- Pool max: 10.
- Warm connections: 2.
- Idle timeout: 600,000 ms.
- Connection timeout: pg default, 0 ms.
- Region hint: `us-east-2`.

## Root cause

The missing 5-6 seconds were not JSON size, serialization, response writing, or browser parsing.
They were shared server-side latency from cold PostgreSQL connection acquisition plus too many
round trips in the startup path.

The first measured run before the fix showed:

- `/api/bootstrap`: 5,599 ms total.
- Auth session lookup: 3,249 ms, including 2,860 ms waiting for a PostgreSQL connection.
- Bootstrap DB work: 2,024 ms because four tiny lookup queries opened extra cold connections.
- Mapping/permissions/serialization/write: under 6 ms combined.
- `/api/leads?limit=100`: warm individual requests were often under 1.4 s, but concurrent page
  load could reach about 3.1 s; the same pattern was connection acquisition and DB round trips,
  not payload bytes.

## Code changed

- Added high-resolution request tracing for `/api/bootstrap`, `/api/leads`, and
  `/api/debug/db-ping`.
- Added temporary safe `GET /api/debug/ping` for measuring Node/request overhead without auth,
  DB, external APIs, or legacy state loading. In production it is available only when
  `API_DEBUG_ENDPOINTS=true`.
- Added `Server-Timing` for those endpoints and opt-in console traces with `API_PERF_TRACE=true`.
- `Server-Timing` now separates `node-total`, `pre-handler`, `middleware`, `auth`,
  `db-acquire`, `db-query`, aggregate `query`, the named Leads query, mapping, permissions, and
  serialization. Response write/end is logged server-side because it happens after response
  headers are sent.
- Added event-loop delay/utilization diagnostics with `perf_hooks.monitorEventLoopDelay()`.
- Added `npm run diagnose:api-latency`.
- Added `npm run diagnose:query-explain` for exact bootstrap and Leads `EXPLAIN ANALYZE`.
- Added safe DB metadata reporting via `databaseSafeMetadata()`.
- Added developer-only `GET /api/debug/db-ping`, which authenticates and then runs only
  `SELECT 1`.
- Replaced bootstrap's four parallel lookup queries with one SQL round trip.
- Added in-process session-user reuse (`SESSION_AUTH_CACHE_MS`, default 60 seconds), with
  request coalescing/single-flight for concurrent cache misses and explicit invalidation on
  logout/session clearing, password reset/change, user delete, and role changes.
- Added PostgreSQL pool pre-warming (`POSTGRES_POOL_WARM_CONNECTIONS`, default 2) so page-load
  concurrency does not pay fresh TLS/connection setup.
- Raised PostgreSQL pool idle retention (`POSTGRES_POOL_IDLE_TIMEOUT_MS`, default 10 minutes)
  and enabled TCP keepalive. With pg's default 30-second idle timeout, the pool dropped to zero
  after a 60-second idle period and the next request spent about 2.13 s acquiring a fresh
  connection.
- Changed `/api/leads?limit=100` to skip stage totals by default; callers can request the count
  with `include_total=true`.
- Removed request-time soft-delete schema probing from normal API paths. Production uses
  `LEAD_SOFT_DELETE_ENABLED=true`; schema probing runs only during explicit schema setup.

## Final timings

Measured from this machine against the live Neon database:

| Request | Before | After |
|---|---:|---:|
| `/api/bootstrap` first after login | 5,599 ms | 1,187 ms |
| `/api/bootstrap` warm | 854-930 ms | 270-377 ms |
| `/api/leads?limit=100` first after login | 1,260 ms | 946 ms |
| `/api/leads?limit=100` warm | 730-1,348 ms | 266-377 ms |
| Concurrent bootstrap | 2,929 ms | 293 ms |
| Concurrent leads | 3,071 ms | 657 ms |

After the follow-up Chrome TTFB evidence and the idle-timeout fix, one measured local app path
was:

| Request | Final measured result |
|---|---:|
| `/api/health` | 1.9 ms, no DB |
| `/api/debug/db-ping` warm | 420-491 ms total; `db-acquire` 0.1 ms; `SELECT 1` 420-486 ms |
| `/api/bootstrap` warm | 343-466 ms total; `db-acquire` 0.1 ms |
| `/api/leads?limit=100` warm | 417-498 ms total; `db-acquire` 0.1 ms |
| `/api/leads?limit=100` after 60s idle, first request | 1,703 ms total; `db-acquire` 0.1 ms; auth query 492 ms; soft-delete/schema check 455 ms; leads query 746 ms |
| `/api/leads?limit=100` after 60s idle, second/third | 430 ms and 510 ms |
| Concurrent bootstrap + leads | bootstrap 495 ms, leads 917 ms; `db-acquire` 0.0-0.1 ms |

Those timings vary by run because the app runtime is reaching a Neon `us-east-2` pooled
endpoint from this machine. In the latest full run after removing request-time schema checks,
warm Leads SQL ranged from about 155 ms to 590 ms, and a later 60-second idle run showed a
1.8-second Leads query outlier. The time remained inside `leads-page-query`, not Node routing,
serialization, or schema metadata.

## Stage timings from final run

### `/api/bootstrap`

- First after login: auth lookup 489 ms, bootstrap SQL 241 ms, storage/soft-delete check 446 ms,
  total 1,187 ms.
- Warm: bootstrap SQL 266-374 ms, auth served from the short session cache, total 270-377 ms.
- Serialization and response write: under 1 ms.

### `/api/leads?limit=100`

- First after login: leads SQL 938 ms, total 946 ms.
- Warm: leads SQL 263-366 ms, total 266-377 ms.
- Concurrent with bootstrap: leads SQL 652 ms, total 657 ms.
- Serialization and response write: under 2 ms.
- Final Server-Timing for warm Leads showed `db-acquire` around 0.1 ms, `leads-page-query`
  around 413-489 ms, mapping 1-2 ms, serialization under 1 ms.

## Auth DB round trips

Auth is one `JOIN` query for session + user, and session expiry writes remain throttled by
`SESSION_TOUCH_INTERVAL_MS`; there is no expiry write on every request.

Concurrent cold/expired-cache test with a short test TTL proved single-flight works:

| Request | Auth behavior | Auth DB queries |
|---|---|---:|
| bootstrap | `session_cache_misses=1`, `session_lookup_started=1`; `auth_session_lookup_query` 183.8 ms | 1 |
| leads | `session_lookup_joined=1`; waited on `auth_session_join` 183.2 ms | 0 |

After the auth cache is populated, concurrent bootstrap and Leads both show `session_cache_hits=1`.

## Count query finding

The Leads count/stage aggregate is no longer part of the default `/api/leads?limit=100` path.
When needed, it is requested explicitly with `include_total=true`. This keeps the first page row
load focused on rows only. Workspace-wide counts already come from `/api/dashboard/totals`.

## DB ping finding

`/api/debug/db-ping` proves the application-to-Neon round trip is not single-digit milliseconds
from this runtime. `SELECT 1` measured about 243-326 ms warm in the latest full run, with one
authenticated first call at about 469 ms for `SELECT 1` plus auth/storage setup. Therefore a
Leads request cannot be faster than the DB round trip plus the direct page query from this
runtime, and frontend rendering/payload download are not the source of the measured TTFB.

## EXPLAIN ANALYZE

Exact queries were measured with `npm run diagnose:query-explain`.

| Query | App observed round trip | PostgreSQL planning | PostgreSQL execution | Finding |
|---|---:|---:|---:|---|
| `bootstrap_payload` | 251.0 ms | 0.167 ms | 1.202 ms | SQL plan is not the bottleneck. |
| `leads_page` exact `/api/leads?limit=100` SQL | 255.8 ms | 0.227 ms | 1.407 ms | SQL plan is not the bottleneck. |

The difference between PostgreSQL execution time and app-observed time is remote Neon/network
round-trip behavior. Rewriting these SQL statements is not expected to recover multi-second
latency unless EXPLAIN changes materially on Hostinger.

## Chrome TTFB comparison matrix

This table is ready to fill after the instrumented build is deployed and measured in Chrome:

| Endpoint | Chrome TTFB | `Server-Timing` `node-total` | DB/query time | Missing outside Node |
|---|---:|---:|---:|---:|
| `/api/debug/ping` | measure in Chrome | latest local 0.2-0.9 ms | 0 ms | Chrome TTFB minus `node-total` |
| `/api/debug/db-ping` | measure in Chrome | latest local 244-327 ms warm | latest local 243-326 ms warm | Chrome TTFB minus `node-total` |
| `/api/leads?limit=100` | previously ~3,310 ms localhost Chrome | latest local 158-595 ms warm; one 1,801 ms idle outlier | `leads-page-query` is now visible | Chrome TTFB minus `node-total` |

Run five consecutive requests for each endpoint, wait 60 seconds, then repeat. If practical,
set `DIAGNOSE_LONG_IDLE_MS=300000` for the 5-minute idle test.

## Blocking and integration checks

- Bootstrap and Leads no longer call Zoho, Gmail, Zoom, Eventbrite, Meta, Apollo, or Google
  Sheets in the critical path.
- Bootstrap no longer reads record tables and no longer runs `loadDb()`, `cloneDb()`,
  `recalculate()`, or full-state loading.
- Normal API requests no longer run `information_schema`, `pg_catalog`, `ALTER TABLE`,
  `CREATE TABLE`, or `CREATE INDEX`. Schema setup remains available only for intentional setup
  runs.
- A search for synchronous/blocking work found `fs.readFileSync`, `fs.writeFileSync`,
  `JSON.parse(JSON.stringify(...))`, synchronous password hashing, and gzip compression in the
  legacy/save/static/response paths. None of the expensive legacy `loadDb()/cloneDb()/recalculate()`
  paths are in the current `GET /api/leads?limit=100` hot path.
- A search for fixed ~3-second waits found frontend debounce/widget timers, external API
  timeouts/retries, and Zoho/Zoom/Eventbrite worker waits. None are in the GET Leads hot path.
- Background jobs are disabled by default in `npm run diagnose:api-latency`. Set
  `DIAGNOSE_BACKGROUND_JOBS=true` only in safe dev/staging to compare with auto-sync timers
  enabled.
- Pool stats are logged as `total/idle/waiting`. During warm Leads requests the pool remained
  healthy with no waiting queue. The 60-second idle regression was pg idle connection expiry,
  now fixed by retaining warm idle connections longer.

## Verification

- `npm run diagnose:api-latency`
- `npm run diagnose:query-explain`
- `npm run check`

