# Monitoring 500 performance fix

Generated 2026-10-01.

## Result

The `/api/monitoring` 500 / ~72-second failure is fixed. Monitoring now uses a production-safe
stale-while-revalidate snapshot path for normal page loads:

```text
GET /api/monitoring or /api/dashboard/monitoring
-> auth
-> read app_monitoring_snapshot by primary key
-> return fresh or stale snapshot immediately
-> refresh in background when stale
-> run monitoring_main synchronously only when snapshot is missing
```

No external API calls are made by Monitoring page requests.

## Snapshot behavior

| State | Behavior |
|---|---|
| Fresh | Return snapshot immediately. No aggregate query. |
| Stale | Return stale snapshot immediately, include safe `_snapshot` metadata, schedule background refresh. |
| Missing | Run `monitoring_main` once as fallback, write snapshot, return response. |

Refresh coordination uses a PostgreSQL advisory lock keyed by the normalized snapshot id:

```text
main:<today_start>:<tomorrow_start>
```

There is also a short in-process read coalescing cache so concurrent hot-path requests do not flood
the pool. Cross-process refresh protection is still the PostgreSQL lock.

## Production config

```env
SKIP_SCHEMA_SETUP=true
MONITORING_STATEMENT_TIMEOUT_MS=5000
MONITORING_SNAPSHOT_ENABLED=true
MONITORING_SNAPSHOT_PROACTIVE_ENABLED=true
MONITORING_SNAPSHOT_TTL_MS=120000
MONITORING_SNAPSHOT_REFRESH_INTERVAL_MS=60000
```

Apply the table explicitly with:

```powershell
npm.cmd run monitoring:snapshot
```

or:

```text
sql/2026-10-01_monitoring_snapshot.sql
```

Normal page requests do not depend on schema setup.

## Measured hot path

Latest `npm.cmd run test:monitoring:swr` results:

| Scenario | Result |
|---|---|
| Fresh snapshot | 200; snapshot read only; no `monitoring_main`. |
| Stale snapshot | 200; stale snapshot returned immediately; no foreground `monitoring_main`. |
| 10 concurrent stale requests | 10/10 returned 200; foreground `monitoring_main` count: 0; max duration 934 ms. |
| Missing snapshot | 200; expected fallback ran `monitoring_main` once and wrote snapshot. |
| Snapshot SELECT explain | `app_monitoring_snapshot_pkey`; PostgreSQL execution 0.072 ms. |

Sample timings:

| Request | Duration | Foreground DB path |
|---|---:|---|
| Fresh `/api/dashboard/monitoring` | 729 ms | `monitoring_snapshot_read_query` 292.5 ms |
| Stale `/api/dashboard/monitoring` | 576 ms | `monitoring_snapshot_read_query` 286.3 ms |
| 10 concurrent stale requests | max 934 ms | snapshot hot path only |
| Missing `/api/dashboard/monitoring` | 3909 ms | `monitoring_main_query` 674.2 ms + snapshot write |

Smoke test with proactive enabled:

| Request | Result |
|---|---:|
| `/api/monitoring` first | 200, node-total ~721.9 ms, snapshot read 283.4 ms |
| `/api/dashboard/monitoring` immediately after | 200, node-total ~1.1 ms from memory cache |

## Direct aggregate status

`monitoring_main` remains available only for refresh, fallback and diagnostics.

Latest `npm.cmd run diagnose:monitoring`:

| Metric | Value |
|---|---:|
| PostgreSQL execution | 428.151 ms |
| App query duration | 688.5 ms |
| Returned rows | 1 |
| Payload | 3.3 KB |

Latest benchmark confirms the direct query still varies and should not be on the normal browser
hot path:

| Variant | PostgreSQL execution |
|---|---:|
| `MATERIALIZED` | 335.202 ms |
| `NOT MATERIALIZED` | 621.461 ms |
| Planner default | 339.817 ms |

Largest remaining direct-query components:

| Component | PostgreSQL execution |
|---|---:|
| `team_rows` | 166.469 ms |
| `quality_row` | 122.345 ms |

No speculative indexes were added for these because refresh is now asynchronous/background.

## Verification

Passed:

```powershell
node --check server.js
node --check scripts\monitoring-swr-test.js
npm.cmd run monitoring:snapshot
npm.cmd run test:monitoring:swr
npm.cmd run diagnose:monitoring
npm.cmd run diagnose:monitoring:benchmark
node scripts\monitoring-endpoint-smoke.js
```

`npm.cmd run check` currently stops outside the Monitoring code because `app.js` is deleted from
the working tree while package/static audit scripts still reference it. I did not restore that
deleted file without explicit approval.

## Files changed

- `server.js`
  - Added stale-while-revalidate Monitoring snapshot behavior.
  - Added PostgreSQL advisory refresh lock.
  - Added refresh failure metadata preservation.
  - Added proactive refresh scheduler after server startup.
  - Added short memory coalescing for concurrent snapshot reads.
  - Added safe `Server-Timing`: `snapshot-read`, `snapshot-age`, and foreground-only timings.
- `scripts/monitoring-snapshot-refresh.js`
  - Explicit schema/create/refresh command for `app_monitoring_snapshot`.
- `scripts/monitoring-swr-test.js`
  - Validates fresh, stale, concurrent stale, missing and snapshot SELECT EXPLAIN behavior.
- `sql/2026-10-01_monitoring_snapshot.sql`
  - Standalone snapshot table migration.
- `.env`, `.env.hostinger`, `.env.example`, `hostinger.env.example`
  - Monitoring snapshot and proactive refresh settings.
