# Local Setup

## Requirements

- Node.js 18 or newer. Use Node 20+ to match production guidance.
- npm.
- Optional PostgreSQL/Neon database if testing production-like storage.

## Install

```bash
npm install
npm run ui:install
```

`npm install` installs the backend/root dependencies. `npm run ui:install` installs `frontend/` dependencies.

## Environment

Copy `.env.example` to `.env` for local development. Do not copy `.env`, `.env.hostinger`, tokens or passwords into docs or tickets.

Important local options:

- `PORT`: server port. Defaults to `3000`.
- `DATABASE_URL`: leave empty for local JSON storage; set a PostgreSQL URL to test production mode.
- `BACKGROUND_JOBS_ENABLED`: use `false` locally unless intentionally testing sync jobs.
- `KBC_UI`: default is `readdy`; set `legacy` to force root `index.html/app.js/styles.css`.
- `KBC_READDY_OUT_DIR`: optional override for the frontend build output directory.
- `VITE_API_PROXY_TARGET`: API target for the Vite dev server.

## Run Backend

```bash
npm start
```

Equivalent start command: `node server.js`.

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

Expected response:

```json
{ "ok": true }
```

## Run React Frontend In Dev Mode

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run ui:dev
```

Open the Vite URL, usually `http://127.0.0.1:5173/`.

## Build Frontend

```bash
npm run ui:build
```

This writes `frontend/out/`. The Node backend serves that folder by default when it exists.

## Common Local Cases

- If port `3000` is occupied, set `PORT=5500` or another free port.
- If using Vite, set `VITE_API_PROXY_TARGET` to the backend port.
- If you share production DB locally, set `ZOHO_SYNC_WORKER=false` and keep `BACKGROUND_JOBS_ENABLED=false` unless you are deliberately testing workers.

## Minimum First Run Check

```bash
npm run test:frontend
npm run test:security
npm run ui:build
```
