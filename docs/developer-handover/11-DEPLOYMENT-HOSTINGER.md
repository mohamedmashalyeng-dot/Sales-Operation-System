# Deployment: Hostinger

## Runtime

- Node version: use Node 20+ where possible. `package.json` declares `>=18`.
- Startup file: `server.js`.
- Start command: `npm start`.
- Production process: Node HTTP server from `server.js`.
- Health check: `GET /api/health`.

## Build

Install root dependencies:

```bash
npm ci --omit=dev
```

Build frontend before packaging/deploying unless Hostinger runs the build:

```bash
npm run ui:install
npm run ui:build
```

Confirm `frontend/out/index.html` exists. If it is missing, production will serve the legacy root frontend unless `KBC_UI` changes that behavior.

## Environment Variables

Use Hostinger env UI or a private env file beside `package.json`. Do not put real values in repository docs.

Required production groups:

- Core: `NODE_ENV`, `PORT`, `TZ`, `BACKGROUND_JOBS_ENABLED`.
- Database: `DATABASE_URL`, `POSTGRES_*`, pool settings, `SKIP_SCHEMA_SETUP`.
- Admin/dev account: `INITIAL_ADMIN_*`, `DEV_PANEL_*`.
- Gmail: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, optional SMTP vars.
- Eventbrite: `EVENTBRITE_CLIENT_ID`, `EVENTBRITE_CLIENT_SECRET`, `EVENTBRITE_REDIRECT_URI`, optional `EVENTBRITE_PRIVATE_TOKEN`.
- Zoho: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`, accounts/API URLs, scopes/modules, sync tuning.
- Zoom: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, user/history/sync vars.
- Optional: Meta and Apollo vars.

Use `.env.example` and `hostinger.env.example` for names only. Do not copy real `.env` values into tickets, docs or commits.

## Database Configuration

Production should use PostgreSQL/Neon via:

```env
DATABASE_URL=postgresql://...?...sslmode=require
```

The code can create many tables automatically when `SKIP_SCHEMA_SETUP=false`. Keep it false during schema-changing deploys unless migrations are already applied. For production performance/concurrent index migrations, use the SQL files intentionally.

## OAuth Callback Requirements

Provider consoles must match production domain exactly:

- Gmail: `https://<domain>/api/integrations/gmail/callback`
- Eventbrite: `https://<domain>/api/integrations/eventbrite/callback`
- Zoho: `https://<domain>/api/integrations/zoho/callback`

Zoom uses Server-to-Server OAuth credentials, not a browser callback.

## Post-Deploy Smoke Test

1. Visit `/api/health`.
2. Sign in as configured admin/developer.
3. Confirm dashboard loads.
4. Open leads list and one lead detail page.
5. Open inbox page.
6. Open applications page.
7. Open events/meetings pages.
8. Open integrations/monitoring and confirm status is readable.
9. Check browser devtools for stale service worker or asset 404s.
10. Confirm no `.env`, backup, SQL dump or local data file is publicly served.

## Rollback

- Re-deploy the previous working package/build.
- Preserve the production database; do not reset it.
- If a frontend-only release broke, restore previous `frontend/out` or set `KBC_UI=legacy` temporarily if the legacy UI is acceptable.
- If a sync release broke, disable jobs with `BACKGROUND_JOBS_ENABLED=false`, restart, inspect `integration_jobs`, then repair.

## Hostinger-Specific Notes

- Some Hostinger setups do not load hidden dotfiles. `hostinger.env.example` notes using `hostinger.env` beside `package.json`.
- If env values are controlled by Hostinger UI, changing `.env.hostinger` locally does nothing until the UI values are updated and app restarted.
- Do not deploy `node_modules` as public files.
