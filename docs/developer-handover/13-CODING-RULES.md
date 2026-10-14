# Coding Rules

## Runtime Ownership

- Use `server.js` and `server/` for production backend work.
- Use `frontend/src` for default frontend work.
- Do not manually edit `frontend/out`; rebuild it.
- Do not add another DB/job/sync architecture unless explicitly replacing the current one.
- Do not treat `src/` NestJS modules as production behavior without verifying the deployment path changed.

## Data Access

- Never fetch all CRM data for a list page.
- Use server-side pagination, filters and SQL paths.
- Avoid `Storage.loadDb()` in high-traffic list endpoints when a direct SQL path exists.
- Keep bootstrap slim. Do not add records back to `/api/bootstrap`.
- Do not make provider API calls during normal list-page rendering.

## Authorization

- Use `Authorization.ownerFilter` for member-scoped list filters.
- Use `Authorization.ownerForWrite` for create/update owner fields.
- Use `Authorization.requireRecord` for detail/update/delete routes.
- Use `Authorization.requireTeam` for sync/import/review/admin/org-wide routes.
- Use `Authorization.rejectProtectedFields` for user-provided record bodies.
- Never bypass Developer account email checks.

## Sync

- Do not auto-run full sync on page open.
- Do not delete local provider history merely because an incremental response did not include it.
- Persist checkpoints and job state before reporting success.
- Keep provider rate limit/retry state visible.
- Prefer durable job/cursor patterns like Zoho for new provider sync work.

## Secrets

- Do not commit `.env`, `.env.hostinger`, `hostinger.env`, tokens, passwords, OAuth secrets, refresh tokens, access tokens, session secrets or real user passwords.
- Only document environment variable names.
- Redact provider errors before returning them to the frontend.

## Frontend

- Use the existing React components/config patterns.
- Do not add polling where `WorkspaceProvider` already refreshes integration overview.
- Do not fetch inside render loops.
- Keep routes/data loading page-sized.
- Keep legacy `app.js` changes separate and intentional.

## Database

- Use structured SQL/JSON operations already present in modules.
- Add indexes with a migration file when production data size matters.
- Do not reset production data for schema fixes.
- Avoid destructive pruning except through existing, reviewed save paths.

## Tests

- Run targeted script tests for the area touched.
- For auth/sync/frontend changes, run the minimum test sets in `10-TESTING.md`.
- Run `npm run check` before broad releases.
