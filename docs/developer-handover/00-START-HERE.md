# KBC Workspace Developer Handover

Last inspected: 2026-10-14.

This package documents the current repository implementation only. It does not treat planned or legacy architecture as active unless the code currently uses it.

## What KBC Workspace Is

KBC Workspace is the Kent Business College admissions, CRM and operations workspace. It manages:

- Leads and admissions pipeline work.
- Applications, evidence files, enrolment decisions and attribution.
- Tasks, follow-ups, "My Day" and dashboards.
- Gmail inbox and response tracking.
- Eventbrite events and registrations.
- Zoom meetings and Zoom Phone calls.
- Zoho CRM record import/sync.
- Integration monitoring, notifications, audit and admin tooling.

## Current Runtime In One Minute

- Production entrypoint: `server.js`.
- Production API/router implementation: `server/` and `server/routes/`.
- Default frontend source of truth: `frontend/`.
- Default frontend build output: `frontend/out/`.
- Fallback legacy frontend: `index.html`, `app.js`, `styles.css`, `sw.js`.
- Static serving mode: `server/static-files.js` serves `frontend/out`; the root legacy UI is no longer a runtime fallback.
- Production database expected by current docs/env: PostgreSQL/Neon through `DATABASE_URL`.
- Other storage modes still supported in code: MongoDB and local JSON file.
- Background jobs start from `Jobs.startAutoSync()` inside `server.js`, but only run when `BACKGROUND_JOBS_ENABLED=true`.

## Run Locally

```bash
npm install
npm start
```

Open `http://127.0.0.1:3000/`, unless local env sets another `PORT`.

For React UI development:

```bash
npm run ui:install
npm run ui:dev
```

The Vite dev server proxies `/api` to `VITE_API_PROXY_TARGET`, defaulting to `http://127.0.0.1:3000`.

## First 30 Minutes

1. Read `server.js`, `server/routes/index.js`, and `server/static-files.js`.
2. Read `server/config.js` without copying any values from real env files.
3. Read `server/storage.js` around storage mode and `createPostgresAppTables`.
4. Read `server/auth.js` and `server/authorization.js`.
5. Open `frontend/src/store/backendSync.ts` and `frontend/src/store/WorkspaceProvider.tsx`.
6. Run `npm run test:frontend` and `npm run test:security`.
7. Visit `/api/health` after starting the server.

## What To Read Next

- Architecture: `01-ARCHITECTURE.md`
- Local setup: `02-LOCAL-SETUP.md`
- Database: `04-DATABASE.md`
- API map: `05-API-MAP.md`
- Auth/permissions: `06-AUTH-PERMISSIONS.md`
- Sync architecture: `08-SYNC-ARCHITECTURE.md`
- Known issues: `12-KNOWN-ISSUES.md`
- Coding rules: `13-CODING-RULES.md`

## Final Status Snapshot

Current architecture status: NEEDS CLEANUP

The active runtime is clear, but the repo still contains active CommonJS backend code, a React/Vite frontend, legacy root frontend files, generated output, SQL migration history, and NestJS compatibility/source code. New work must avoid creating a third competing path.

Onboarding readiness: READY

With this handover, a developer can understand the current system in 1-2 hours. The risk is not lack of code; the risk is changing the wrong layer.

Top 5 things to understand:

1. `server.js` plus `server/routes/` is the production backend.
2. `frontend/` owns the default UI; `frontend/out/` is generated.
3. PostgreSQL app tables are the production data model when `DATABASE_URL` is PostgreSQL.
4. Authorization is centralized in `server/authorization.js` and must be applied to record routes.
5. Integrations have different sync models; Zoho is job-based, Gmail/Eventbrite/Zoom are not identical.

Top 5 things not to change casually:

1. Session/auth code in `server/auth.js`.
2. Owner and record checks in `server/authorization.js`.
3. Provider token storage and OAuth callback routes.
4. Sync cursors, imported ID lists, checkpoints and integration job state.
5. Generated files in `frontend/out/`.

Top current technical risks:

- Frontend/runtime duplication between React build and legacy root files.
- Sync correctness under rate limits and restarts.
- Eventbrite and Zoom bounded scan behavior versus true durable incremental sync.
- Service worker cache staleness for the legacy frontend.
- Production env and OAuth callback drift between Hostinger and provider consoles.
