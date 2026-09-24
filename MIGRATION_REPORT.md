# Kent Business College NestJS Migration Report

## 1. What Changed

- Added a NestJS + TypeScript application entry point in `src/main.ts`.
- Made NestJS the production default entry through `dist/main.js`.
- Preserved the existing legacy backend as the compatibility engine during this phase.
- Added a Nest compatibility mode to `server.js` so it can be imported without opening a second HTTP listener.
- Kept all existing API routes, response shapes, cookies, static files, OAuth callbacks and background sync behavior compatible.

## 2. New Folder Architecture

- `src/main.ts`
- `src/app.module.ts`
- `src/auth`
- `src/users`
- `src/leads`
- `src/tasks`
- `src/emails`
- `src/events`
- `src/applications`
- `src/programmes`
- `src/integrations/gmail`
- `src/integrations/eventbrite`
- `src/database`
- `src/common`

## 3. Legacy Functions Migrated

This phase creates the NestJS shell and routes traffic through the existing tested legacy handlers:

- `handleApi`
- `serveStatic`
- `startAutoSync`

Business logic is intentionally still delegated to the legacy backend to avoid breaking production behavior during the first migration phase.

## 4. Database Changes Made

No destructive database changes were made.

The existing PostgreSQL/Neon tables remain compatible. Existing additive schema setup inside the legacy backend is preserved.

## 5. Additive Migrations Created

None in this phase.

## 6. Authentication Changes

- Existing `sid` cookie behavior is preserved.
- Login response now returns before writing login audit metadata, reducing perceived login delay.
- Persistent database-backed sessions are not implemented yet in this phase; this remains a required next migration step.

## 7. Performance Improvements

- `/api/bootstrap` now uses lightweight email summaries when loading the first email page from PostgreSQL.
- NestJS listens immediately and starts background sync only after the HTTP server is listening.
- Existing Gmail and Eventbrite synchronization remains background-only and does not block startup.

## 8. Environment Variables Required

Existing environment variables are preserved, including:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `POSTGRES_URL`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REDIRECT_URI`
- `EVENTBRITE_CLIENT_ID`
- `EVENTBRITE_CLIENT_SECRET`
- `EVENTBRITE_REDIRECT_URI`
- `DEV_PANEL_EMAIL`
- `DEV_PANEL_PASSWORD`
- Current Gmail/Eventbrite/Meta/Apollo sync variables already used by `server.js`

No real secrets were added to `.env.example`.

## 9. Hostinger Deployment Settings

Use:

- Framework: Other / Node.js
- Node: 20.x
- Package manager: npm
- Build command: `npm run build`
- Output directory: `dist`
- Entry file: `dist/main.js`
- Port: `process.env.PORT || 3000`

The NestJS app listens on `0.0.0.0`.

## 10. Testing Performed

Performed locally:

- `node --check app.js`
- `node --check server.js`
- `npm run build`

Pending verification on deployed environment:

- Login with real production credentials
- `/api/bootstrap` against production Neon data
- Gmail OAuth callback
- Eventbrite OAuth callback
- Background sync timing on Hostinger

## 11. Known Limitations

- This is Phase 1 of the migration: NestJS foundation plus compatibility adapter.
- Core business logic has not yet been fully moved into Nest services.
- Sessions are still legacy in-memory sessions and should be migrated to a database-backed session table in the next phase.
- Write paths still use existing legacy persistence behavior where not already optimized.

## 12. Rollback Instructions

To run the previous backend directly:

```bash
npm run start:legacy
```

For Hostinger rollback, set the entry file back to:

```text
server.js
```

and set build command to empty or none.
