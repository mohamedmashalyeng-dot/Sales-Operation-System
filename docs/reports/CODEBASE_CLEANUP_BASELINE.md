# Codebase Cleanup Baseline

Date: 2026-10-14

## Purpose

This baseline records the current KBC Workspace architecture before any broad cleanup. The cleanup rule for this pass is evidence first: files stay in place unless runtime, build, test, deployment, and dynamic references all show that they are unused.

## Git Baseline

Initial working tree status showed existing uncommitted changes across frontend pages, backend email/application routes, `PROJECT_PLAN.md`, `styles.css`, and an untracked `frontend/src/utils/filterOptions.ts`. Those changes were treated as user/work-in-progress changes and were not reverted.

`git diff --stat` at the start of this pass reported 30 modified tracked files with 564 insertions and 252 deletions.

## Inventory

Tracked file counts from `git ls-files`:

| Type | Count |
| --- | ---: |
| JavaScript `.js` | 133 |
| TypeScript `.ts` | 98 |
| React TypeScript `.tsx` | 135 |
| CSS `.css` | 3 |
| HTML `.html` | 3 |
| SQL `.sql` | 15 |
| JSON `.json` | 11 |
| Markdown `.md` | 26 |
| PDF `.pdf` | 5 |
| Images `.png/.svg/.webp` | 4 |
| Web manifest `.webmanifest` | 1 |
| Examples/config-like `.example/.gitignore` | 3 |

Approximate line counts:

| Area | Lines |
| --- | ---: |
| `server.js` | 125 |
| `server/` | 20,196 |
| `frontend/src/` | 35,927 |
| Legacy `app.js` | 3,487 |
| Legacy `styles.css` | 5,498 |
| `sw.js` | 22 |

The API route scan found 156 explicit `route === ...` or `route.match(...)` route branches in `server/routes/`.

## Active Runtime Entrypoints

| Entrypoint | Evidence | Status |
| --- | --- | --- |
| `server.js` | `package.json` `start` points to `node server.js`; README and Hostinger checklist name `server.js`; it creates the HTTP server and delegates API/static handling. | Active production entrypoint |
| `server/routes/index.js` | Required by `server.js`; owns API route ordering, auth gate, direct DB routes, and workspace fallback routes. | Active API router |
| `server/static-files.js` | Required by `server.js`; serves either `frontend/out` Readdy build or legacy static files. | Active static serving |
| `frontend/src/main.tsx` | Referenced by `frontend/index.html`; Vite build entry. | Active frontend source entrypoint |
| `index.html` + `app.js` + `styles.css` | Served when `frontend/out` is unavailable or when `KBC_UI=legacy`; tested by `scripts/security-static-smoke-test.js`; `sw.js` caches `app.js`/`styles.css`. | Legacy path retained |
| `src/main.ts` | Nest CLI entry; sets `NEST_COMPAT_MODE=true` and wraps legacy `server.js` handlers. | Compatibility entrypoint |

## Build Entrypoints

| Command | Evidence | Status |
| --- | --- | --- |
| `npm run ui:build` | Root package delegates to `npm --prefix frontend run build`; Vite outputs to `frontend/out`. | Active frontend build |
| `npm run build` | Root package runs `tsc -p tsconfig.build.json`; Nest source exists and `start:dev` uses Nest CLI. | Active TypeScript/Nest build path |
| `npm start` | Starts `server.js`. | Production start command |

## Production Frontend Path

`server/static-files.js` defaults `KBC_UI` to `readdy` and serves `frontend/out` when `frontend/out/index.html` exists. If that build is missing, or `KBC_UI=legacy`, it serves the root legacy static UI (`index.html`, `app.js`, `styles.css`, `sw.js`).

Conclusion: the canonical frontend source is `frontend/`, but the legacy UI remains an intentional fallback and test path in this repository.

## Backend Path

`server.js` accepts all HTTP traffic. API requests go to `Routes.handleApi`; non-API requests go to `StaticFiles.serveStatic`.

The route layer has two modes:

- Direct routes: lightweight DB-backed route groups tried before full workspace load.
- Workspace routes: fallback route groups after `Storage.loadDb()`.

This is deliberate architecture, not dead duplication.

## Database Adapters

`server/storage.js` supports:

- PostgreSQL when `DATABASE_URL`/`POSTGRES_URL` starts with `postgres` or `postgresql`.
- MongoDB when the database URL starts with `mongodb://` or `mongodb+srv://`.
- Local JSON file when no database URL is configured.

README documents PostgreSQL as production-ready and still documents MongoDB support. Because MongoDB is still an explicit runtime branch and documented adapter, it is not removable in this pass.

## Integration Modules

Active integration modules discovered:

- Gmail: `server/integrations/gmail.js`, `server/routes/gmail.js`
- Zoom: `server/integrations/zoom.js`, `server/routes/zoom.js`
- Zoho: `server/integrations/zoho.js`, `server/routes/zoho.js`
- Eventbrite: `server/integrations/eventbrite.js`, `server/routes/eventbrite.js`
- Meta: `server/integrations/meta.js`, `server/routes/meta.js`
- Apollo: `server/integrations/apollo.js`, `server/routes/apollo.js`

These are registered in `server/routes/index.js` or surfaced through integration centre status. None were removed.

## Service Worker Baseline

`sw.js` is a small legacy shell cache for `offline.html`, `app.js`, `styles.css`, `developer.css`, and KBC logo assets. It skips localhost and API requests. The React/Vite frontend does not currently register a separate service worker. There are not two active service workers in source, but the legacy service worker is tied to the legacy UI path and smoke tests.

## Known Legacy Paths

Retained intentionally:

- Root `index.html`, `app.js`, `styles.css`, `sw.js`: required by `KBC_UI=legacy`, fallback behavior, and existing smoke tests.
- NestJS `src/`: required by `npm run build`, `start:dev`, `nest-cli.json`, and the compatibility wrapper in `src/main.ts`.
- MongoDB dependency: required by documented runtime branch when `DATABASE_URL` is MongoDB.
- Local JSON storage: required for local development and tests when production DB env is absent.

## Cleanup Performed In This Pass

Safe source cleanup performed before testing:

- `frontend/index.html` no longer references missing `/vite.svg`.
- `frontend/index.html` no longer loads a duplicate Google Fonts stylesheet already imported by `frontend/src/index.css`.
- `server/emails.js` email list SQL no longer reads the large `body` column just to build inbox summaries.
- `app.js` reconnects the existing legacy Zoom page to the legacy route map and sidebar navigation, preserving the legacy fallback path that tests still exercise.

No source file was deleted.
