# app.js repository consistency fix

Generated 2026-10-01.

## Decision

This was **Case A: accidental deletion**.

`app.js` was not intentionally replaced or migrated. The project still uses the static frontend
entry loaded by `index.html`:

```html
<script src="/app.js?v=20260930-bootstrap-config-only" defer></script>
```

`app.js` is tracked by git and required in production. No alternate frontend entry file was found.
`package.json` also still validates it with:

```json
"check": "node --check server.js && node --check app.js && ..."
```

## Fix Applied

Restored the tracked `app.js` entry instead of creating a fake placeholder file.

After restore, the git version was older than the current audit expectations, so the missing
frontend changes were reapplied on top of the restored file:

- Zoho records preview now reads local `/api/integrations/zoho/records`.
- Zoho full sync starts a background job with `/api/integrations/zoho/sync`.
- Zoho sync status polls `/api/integrations/zoho/sync-status/:jobId`.
- API helper inspects `Content-Type` and hides raw gateway timeout HTML.
- Client fallback lead totals use `uniqueClientLeads`.
- Added a focused frontend route smoke script for login and core pages.

The completed Monitoring SWR server architecture was not changed.

## References Checked

| Check | Result |
|---|---|
| Was `app.js` replaced? | No replacement entry found. |
| Current production frontend entry | `/app.js` from `index.html`. |
| `index.html` references `app.js` | Yes. |
| `package.json` references `app.js` | Yes, via `node --check app.js`. |
| Audit scripts assume `app.js` exists | Yes: security, Zoho, dashboard dedupe, rocket CRUD audits. |
| `app.js` tracked by git | Yes. |

## Files Changed

- `app.js`
  - Restored as the real frontend entry.
  - Reapplied current Zoho async sync UI support.
  - Reapplied client lead dedupe fallback.
  - Hardened non-JSON/504 API error handling.
- `scripts/zoho-async-sync-audit.js`
  - Scoped the advisory-lock assertion to the Zoho hot path so it does not reject the intentional
    Monitoring snapshot lock.
- `scripts/frontend-route-smoke.js`
  - Added a focused render smoke test for the active static frontend routes.

## Verification

Passed:

```powershell
node --check server.js
npm.cmd run build
npm.cmd run check
node scripts\frontend-route-smoke.js
```

`npm run check` result:

```text
Static and bootstrap security smoke tests passed.
Zoho static audit passed.
Zoho lifecycle regression passed.
Zoho async sync audit passed.
Dashboard lead dedupe audit passed.
Rocket CRUD static audit passed.
Leads pagination audit passed.
Bootstrap payload audit passed.
Lead dedupe tests passed.
build passed.
```

Frontend route smoke result:

```text
Frontend route smoke passed: login, dashboard, leads, inbox, tasks, applications, meetings, monitoring.
```

## Follow-up: Empty Pages After Restore

After the restore, the Leads page could show `0 leads` even when production data still existed.
The cause was frontend/runtime consistency, not database deletion:

- The restored `app.js` still assumed bootstrap shipped record arrays.
- The optimized bootstrap is intentionally slim and does not ship leads/tasks/events.
- `/api/leads` returns page rows as `items`, while the restored frontend was reading only
  `result.leads`.

Fixed in `app.js`:

- Leads now lazy-load the first page from `/api/leads?limit=100&include_total=true`.
- `loadMoreLeads()` accepts the real `items` response shape.
- Planner lazy-loads `/api/tasks`.
- Events lazy-loads `/api/events`.
- Monitoring primes leads/tasks/events before local fallback calculations.

`index.html` now cache-busts the corrected frontend:

```html
<script src="/app.js?v=20261001-page-data-loaders" defer></script>
```

## Production Entry

Production continues to use:

```text
/app.js
```

No `app.js` references were removed because they are still correct for this project.
