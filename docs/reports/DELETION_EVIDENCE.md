# Deletion Evidence

Date: 2026-10-14

## Summary

No source files were deleted in this cleanup pass. Several large candidates were audited but retained because they still have active runtime, build, test, or documented deployment references.

## Reference Cleanup

| Item | Change | Evidence | Validation |
| --- | --- | --- | --- |
| `frontend/index.html` `/vite.svg` favicon reference | Replaced with `/assets/images/Kent%20Business%20College%20logo.svg` | No tracked `vite.svg` exists; KBC logo asset is already served and referenced by `manifest.webmanifest` and legacy `index.html`. | `npm.cmd run ui:type-check`, `npm.cmd run ui:build` |
| `frontend/index.html` Google Fonts stylesheet link | Removed duplicate stylesheet link, kept preconnects | Same font family import exists at the top of `frontend/src/index.css`, which is part of the Vite source bundle. | `npm.cmd run ui:type-check`, `npm.cmd run ui:build` |
| `server/emails.js` email summary SQL body fallback | Removed `body` from `emailSummaryDataSql()` snippet construction | `scripts/frontend-startup-audit.js` requires list SQL to exclude large message fields; body hydration remains in `loadEmailDetail()`. | `npm.cmd run test:frontend`, `node --check server\\emails.js` |
| Legacy `app.js` Zoom route map | Added `zoom` to labels/navs/render map for the already existing `zoom()` view | The legacy fallback still contains `zoom()` and `loadZoomEvents()` and `scripts/frontend-startup-audit.js` navigates `#/zoom`; route was unreachable without the map entry. | `npm.cmd run test:frontend`, `node --check app.js` |

## Retained Candidates

| Candidate | Why It Was Not Deleted |
| --- | --- |
| `index.html`, `app.js`, `styles.css`, `sw.js` | `server/static-files.js` supports `KBC_UI=legacy` and fallback when `frontend/out` is missing; `scripts/start-legacy-ui.js` and `scripts/security-static-smoke-test.js` explicitly use this path; `sw.js` caches legacy shell assets. |
| `src/` NestJS code and Nest dependencies | `npm run build` uses `tsconfig.build.json`; `src/main.ts` wraps `server.js` through `NEST_COMPAT_MODE=true`; `package.json` exposes `start:dev`. |
| `mongodb` package and MongoDB adapter code | `server/storage.js` dynamically requires `mongodb` when `DATABASE_URL` is MongoDB; README documents MongoDB support; env aliases include `MONGODB_URI` and `MONGO_URI`. |
| Local JSON storage path | Local/dev/test mode uses JSON when no `DATABASE_URL` is set; multiple tests intentionally run without production DB. |
| Integration modules for Gmail, Zoho, Zoom, Eventbrite, Meta, Apollo | Registered route modules and integration centre code still reference them. Removing any would change integration behavior. |
| `scripts/` diagnostics | Many scripts are referenced by `package.json` test/diagnostic commands or document guarded database checks. They require a separate script-by-script lifecycle review. |

## Stop Conditions Hit

The following requested deletion areas stopped at documentation because usage is not safely removable yet:

- Legacy UI: still referenced by runtime fallback and tests.
- NestJS: still referenced by build/dev scripts.
- MongoDB: still documented and implemented as runtime adapter.
- Local JSON: still required for local and test behavior.
- Service worker: tied to legacy UI/offline path.
- API routes: route map shows many direct/workspace duplicate-looking routes, but many are deliberate PostgreSQL direct route plus workspace fallback pairs.
