# Known Issues And Risks

These are based on repository inspection, not assumptions about production data.

## P0

No confirmed P0 code issue was found during this handover inspection.

Treat these as P0 if observed in production:

- Production serving `.env`, backups, data dumps, or local database files.
- `DATABASE_URL` missing in production, causing JSON file storage.
- Auth/authorization bypass on new record routes.
- Provider sync deleting historical data because a partial/incremental response omitted records.

## P1

- Architecture duplication: active CommonJS backend, React/Vite frontend, legacy root frontend, generated output and NestJS source all coexist. A developer can easily change the wrong layer.
- Integration sync persistence differs per provider. Zoho has durable jobs; Gmail/Eventbrite/Zoom do not share that job model.
- Eventbrite sync is a bounded scan/upsert model and reports no remote deletions.
- Zoom calls are stored in workspace meta JSON, not normalized call rows.
- Gmail can continue historical page-token imports unless incremental-only mode is enabled and correctly checkpointed.
- Service worker cache in `sw.js` can serve stale legacy assets unless cache keys are bumped.

## P2

- Many route files have both direct PostgreSQL handlers and workspace-loaded fallback handlers; behavior must stay aligned.
- `src/` NestJS code can distract from the active `server.js` runtime.
- `.env.example` and Hostinger env can drift from actual `server/config.js`.
- Production schema is split between auto-created tables and SQL migration files.
- Some debug/diagnostic scripts may require live DB or credentials; run them intentionally.

## P3

- Existing docs/reports may contain historical status that is no longer the active runtime.
- React `WorkspaceProvider` still includes substantial local/demo mutation logic, which can confuse backend-backed behavior.
- Legacy `app.js` still contains a large separate frontend with local fallback behavior.

## Areas Requiring Verification Before Related Changes

- Zoho pagination, counters, cursors and module sync marks.
- Sync restart behavior after a killed process.
- Gmail history/trash reconciliation under quota pressure.
- Eventbrite duplicate merge and deletion scan completeness.
- Zoom report overlap and multi-account behavior.
- Frontend duplicate requests/polling when integration sync is active.
- Service worker and browser cache after deployment.
- Security/reliability around new admin, sync or evidence-file endpoints.
