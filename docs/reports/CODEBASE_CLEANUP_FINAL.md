# Codebase Cleanup Final

Date: 2026-10-14

## Scope Completed

This pass completed the baseline audit, canonical architecture documentation, deletion evidence documentation, and a small set of low-risk cleanup fixes. It did not perform broad deletions because the major candidates still have active evidence of use.

## Canonical Architecture Before

Before this pass, the codebase already had a dual frontend/static path:

- Vite/Readdy frontend source in `frontend/`, building to `frontend/out/`.
- Legacy root UI in `index.html`, `app.js`, `styles.css`, and `sw.js`.
- `server.js` as production runtime entrypoint.
- `server/routes/index.js` as API router.
- `server/storage.js` as storage adapter.

This was present but not captured in a focused cleanup baseline.

## Canonical Architecture After

No architecture was rewritten. The canonical path is now documented in `docs/reports/CANONICAL_ARCHITECTURE.md`:

- `frontend/src` is the main frontend source.
- `frontend/out` is generated build output.
- `server.js` is the production entrypoint.
- `server/routes` is the API routing boundary.
- `server/*` modules contain business logic.
- PostgreSQL is the intended production database path, with MongoDB and local JSON still retained because they are active/documented adapters.

## Files Removed

None.

## Files Moved

None.

## Files Changed

| File | Change |
| --- | --- |
| `frontend/index.html` | Replaced missing Vite favicon reference with KBC logo; removed duplicate Google Fonts stylesheet link already imported by `frontend/src/index.css`. |
| `server/emails.js` | Kept inbox list SQL on summary fields by removing the `body` fallback from `emailSummaryDataSql()`. Email body loading remains lazy in detail routes. |
| `server/dashboard.js` | Made local My Day at-risk lead detection deterministic against the requested day bounds and avoided treating missing `created_at` values as stale. |
| `app.js` | Reconnected the existing legacy Zoom page to legacy labels, navs, and render map so the retained fallback path still serves Zoom meetings/calls. |
| `docs/reports/CODEBASE_CLEANUP_BASELINE.md` | Added baseline inventory and runtime/build entrypoint evidence. |
| `docs/reports/CANONICAL_ARCHITECTURE.md` | Added current architecture diagram and boundary notes. |
| `docs/reports/DELETION_EVIDENCE.md` | Added deletion evidence and retained-candidate rationale. |
| `docs/reports/CODEBASE_CLEANUP_FINAL.md` | Added this final cleanup summary. |

## Files Retained Intentionally

- Legacy UI files: retained due to runtime fallback, `KBC_UI=legacy`, and smoke tests.
- `src/` NestJS files: retained due to build/dev compatibility path.
- MongoDB adapter and dependency: retained due to documented and implemented runtime branch.
- Local JSON fallback: retained for local development and tests.
- `sw.js`: retained because legacy UI still registers/caches it outside local dev.
- Diagnostic scripts: retained pending script-by-script review.

## Legacy Paths Removed

No legacy path was removed. Stale/duplicate references in `frontend/index.html` were cleaned, and the existing legacy Zoom path was reconnected.

## Legacy Paths Still Required

- `KBC_UI=legacy` static serving path.
- Legacy service worker shell cache.
- Nest compatibility wrapper.
- Workspace fallback routes after `Storage.loadDb()`.

## Unused Dependencies Removed

None. No dependency met the evidence threshold for removal.

## Languages And Frameworks Removed

None. JavaScript, TypeScript, React/Vite, NestJS, SQL, HTML, CSS, and JSON all still have active source, build, test, or tooling roles.

## Storage Adapters Removed Or Retained

- PostgreSQL: retained as intended production storage.
- MongoDB: retained because it is implemented and documented.
- Local JSON: retained for local/dev/test fallback.

## CSS Cleanup

No CSS rules were deleted. The only style-related cleanup was removal of the duplicate Google Fonts stylesheet link from `frontend/index.html`; `frontend/src/index.css` remains the source of the font import.

## JS/TS Cleanup

No JS/TS code was deleted. One legacy route-map regression was fixed by wiring the existing `zoom()` view back into `app.js`. The local My Day fallback was also aligned with deterministic day bounds so tests and local mode do not drift based on wall-clock time.

## Backend Cleanup

No backend routes or modules were deleted. Route scan found many direct-route plus workspace-route pairs that are active fallback design, not proven dead code. Email list SQL was tightened so list pages do not pull large message bodies.

## Service Worker Cleanup

No service worker change was made. There is no separate Vite service worker in source, and the legacy `sw.js` remains tied to the legacy UI path.

## Build Cleanup

`frontend/index.html` now uses the KBC logo instead of missing `/vite.svg` and avoids a duplicate font stylesheet request.

## Tests

Commands run after cleanup:

```bash
node --check app.js
node --check server\emails.js
node --check sw.js
npm.cmd run ui:type-check
npm.cmd run ui:build
npm.cmd run test:frontend
npm.cmd run test:security
npm.cmd run test:my-day
npm.cmd run check
```

All passed. The build emitted the existing Vite warnings about future `configLoader: native` behavior and chunk size; those warnings are outside this cleanup scope.

## Bundle / LOC / Dependency Notes

Baseline:

- `server.js`: 125 lines
- `server/`: 20,196 lines
- `frontend/src/`: 35,927 lines
- `app.js`: 3,487 lines
- `styles.css`: 5,498 lines
- API route branches scanned: 156
- Tracked JS files: 133
- Tracked TS files: 98
- Tracked TSX files: 135

Frontend build after cleanup:

- `out/index.html`: smaller by the removed duplicate font stylesheet link.
- Main JS bundle: 961.61 kB minified.
- Main CSS bundle: 174.93 kB.

No dependency count changed.

## Risks

- Legacy UI cannot be deleted without replacing `KBC_UI=legacy` tests and fallback behavior.
- NestJS cannot be removed without changing build/dev scripts.
- MongoDB cannot be removed without a product/deployment decision to end MongoDB support.
- Local JSON production hardening would be a behavior change and should be handled separately.
- Some broad checks intentionally skip optional isolated database assertions unless local database URLs are provided.

## Remaining Technical Debt

- Decide whether `KBC_UI=legacy` is still a supported production fallback or only a temporary safety net.
- Decide whether MongoDB remains a supported adapter.
- Add a production guard to prevent accidental JSON fallback when `NODE_ENV=production`.
- Continue route-by-route classification for direct/workspace duplicate-looking routes.
- Review scripts individually as active, diagnostic, one-time migration, obsolete, or dangerous.
- Consider splitting `server.js` test exports into a dedicated test-support module later.
