# Project Structure

## Root Files

- `server.js`: production Node HTTP server and exported test helpers.
- `package.json`: root backend scripts, test scripts and dependency list.
- `.env.example`: safe env variable template.
- `hostinger.env.example`: safe Hostinger-oriented env template.
- `PROJECT_PLAN.md`: current planning/status notes.
- `README.md`: shorter setup/deploy overview.
- `index.html`, `app.js`, `styles.css`, `developer.css`, `sw.js`: legacy static frontend fallback.
- `manifest.webmanifest`, `offline.html`: legacy/static browser support files.

## `server/`

CommonJS production backend.

- `routes/`: API route groups. `routes/index.js` wires them together.
- `integrations/`: provider implementations for Gmail, Eventbrite, Zoom, Zoho, Meta and Apollo.
- `storage.js`: storage mode selection, PostgreSQL schema creation, load/save behavior.
- `auth.js`: users, sessions, login, password reset, developer access.
- `authorization.js`: owner scoping and team/member record authorization.
- `workspace.js`: workspace seed/recalculate/integration status helpers.
- Domain modules: `leads.js`, `tasks.js`, `emails.js`, `events.js`, `applications.js`, `dashboard.js`, `analytics.js`, `monitoring.js`, `automations.js`, `notifications.js`, `documents.js`, `admin-audit.js`.

## `frontend/`

React/Vite frontend.

- `src/App.tsx`: top-level app composition.
- `src/router/`: route config.
- `src/store/backendSync.ts`: backend API loading and mapping into frontend workspace state.
- `src/store/WorkspaceProvider.tsx`: workspace context, backend sign-in state, local fallback/demo behavior.
- `src/pages/`: page components.
- `src/components/`: base and feature components.
- `src/config/`: navigation, modules, roles, CRM, eligibility and domain config.
- `out/`: generated build output served by backend.

## `src/`

NestJS/TypeScript source modules. This is not the current production entrypoint. It is used by `npm run start:dev` and `npm run build`, but Hostinger production should run `server.js`.

## `sql/`

Schema and migration helpers. Active PostgreSQL schema is created partly by `server/storage.js` and partly by these SQL files. Important files include:

- `2026-09-26_scalability_foundation.sql`
- `2026-09-26_zoom_sync_state.sql`
- `2026-09-30_lead_identity_constraints.sql`
- `2026-09-30_email_unanswered_page_index.sql`
- `2026-10-01_monitoring_snapshot.sql`
- `2026-10-12_automation_engine.sql`
- `2026-10-12_saved_views.sql`
- `marketing_tables.sql`

## `scripts/`

Smoke tests, audits, diagnostics, deployment helpers and maintenance scripts. Many package scripts call files here directly.

Examples:

- `frontend-startup-audit.js`, `frontend-route-smoke.js`
- `security-static-smoke-test.js`
- `zoho-static-audit.js`, `zoho-lifecycle-regression-test.js`, `zoho-async-sync-audit.js`
- `sync-persistence-test.js`
- `admin-audit-test.js`

## `docs/`

Existing reports in `docs/reports/` plus this handover package in `docs/developer-handover/`.

## `assets/`

- `assets/images/`: logos and browser images.
- `assets/documents/`: PDF document templates used by application workflows.

## `data/`

Local JSON database location. Do not treat local JSON as production data unless `DATABASE_URL` is intentionally unset in a local/dev environment.
