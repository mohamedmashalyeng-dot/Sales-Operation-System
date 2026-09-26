# Kent Business College CRM Scalability Refactor Report

## 1. Original Architecture Problems Found

- NestJS is the production entry point (`src/main.ts`), but all real API traffic is still delegated to the legacy compatibility engine in `server.js`.
- NestJS modules/controllers/services currently exist mostly as empty shells. Current flow is:
  - Frontend `app.js`
  - `/api/*`
  - `src/main.ts` Express compatibility middleware
  - `server.js` route handler
  - PostgreSQL tables / external APIs
- PostgreSQL is already the production source of truth, but several write paths still mutate an in-memory application object and call `saveDb()`, which can reconcile whole tables.
- `savePostgresTables()` still performs full dataset upserts plus `deleteMissingIds()` for major tables. This is the main remaining scalability risk.
- `/api/bootstrap` has already been partially optimized: it reads limited leads/tasks/emails/events and email summaries. It no longer loads every email on normal startup.
- `/api/emails` has cursor pagination for the default inbox path, but filtered/search email queries still load all email summaries and filter in Node.
- Sessions are persisted in PostgreSQL (`app_sessions`) and survive process restarts, but session IDs are still stored as plaintext primary keys. A `token_hash` migration column has been added for the next compatibility-safe session hardening phase.
- Background sync starts after `listen()`, which protects Hostinger startup, but duplicate-job protection is still mostly process-local and should move toward database locks/checkpoints.

## 2. Code Changed

- Added lightweight `GET /api/dashboard/summary` in `server.js`.
- The new dashboard summary endpoint uses SQL aggregation in PostgreSQL instead of loading complete records.
- Added `GET /api/leads?limit=50&cursor=...` for cursor-based lead pagination without changing the existing create-lead endpoint.
- Added local fallback aggregation for non-PostgreSQL development mode.
- Added page-level "new since your last visit" markers in `app.js` for leads, planner, inbox, applications, events, and Zoom.
- Added `created_at` timestamps to newly created tasks/events where missing, so page badges have stable item creation times.
- Bumped frontend asset cache versions in `index.html`.

## 3. Database Migrations Added

- Added `sql/2026-09-26_scalability_foundation.sql`.
- The migration is additive only. It does not drop or rewrite existing data.
- It creates `integration_sync_state` for restart-safe future sync checkpoints/locks.
- It adds nullable session metadata columns for a later token-hash migration.

## 4. Database Indexes Added

Indexes documented in `sql/2026-09-26_scalability_foundation.sql` cover observed query paths:

- Bootstrap and lead list ordering: `app_leads(created_at, id)`.
- Lead filters: stage, owner, programme, normalized email.
- Task dashboard/planner filters: status, due date, owner, lead.
- Email cursor pagination: `app_emails(received_at, id)`.
- Email detail/thread lookup: lead, sender, Gmail thread.
- Email unread/label filters: JSONB GIN indexes for Gmail labels.
- Applications: created date, status, lead.
- Events: start date and Zoom identifiers.
- Audit: occurred date and entity lookup.
- Sessions/sync state: token hash, last used, provider/status locks.

## 5. Session Implementation

- Current production-compatible behavior remains unchanged.
- PostgreSQL-backed sessions already exist.
- Migration adds `token_hash`, `last_used_at`, `ip_address`, and `user_agent` columns for a later no-break transition.
- Current users are not invalidated.

## 6. Dashboard Optimization

- New endpoint:

```http
GET /api/dashboard/summary
```

- Returns aggregate sections for leads, tasks, emails, applications, and events.
- Uses `COUNT` and filtered aggregation in SQL.
- Does not call Gmail/Eventbrite/Zoom.
- Does not load full tables to calculate counts.

## 7. Lead Pagination

- Added:

```http
GET /api/leads?limit=50&cursor=...
```

- Supports cursor pagination ordered by `created_at DESC, id`.
- Supports `search`, `stage`, `owner_id`, and `programme_id` filters.
- Returns both `items` and `leads` aliases for easier frontend migration.
- Preserves existing `POST /api/leads` behavior.
- Current frontend still uses bootstrap/client-side lead data; migration can now happen incrementally.

## 8. Email Pagination

- Existing default email pagination is already present.
- Remaining risk: filtered/search email mode still pulls all email summaries and filters in Node.
- Next step: migrate common filters to SQL while keeping response shape unchanged.

## 9. Gmail Batching

- Existing Gmail sync already uses limits/batches and stores Gmail state under workspace data.
- Next step: move sync checkpoints into `integration_sync_state`.

## 10. Gmail Incremental Sync

- Current code supports incremental behavior through Gmail state fields.
- Next step: persist provider/account checkpoint rows in `integration_sync_state` and use database locks.

## 11. Background Processing Design

- Current startup is safe: HTTP listen happens before background sync.
- Remaining work: replace process-local duplicate guards with PostgreSQL advisory locks or `integration_sync_state.locked_until`.

## 12. Hostinger Compatibility

- `package.json` remains compatible:
  - Build: `npm run build`
  - Production start: `npm run start:prod`
  - Entry: `dist/main.js`
- No Docker, Redis, Kafka, or new runtime service was introduced.

## 13. Performance Improvements Verified

- `node --check app.js` passed.
- `node --check server.js` passed.
- Local health endpoint responded with PostgreSQL storage.
- TypeScript build verification is listed in the current change summary after execution.

## 14. Environment Variables

- `.env.example` updated with placeholders for existing runtime knobs:
  - `SKIP_SCHEMA_SETUP`
  - `SMTP_HELO`
  - `EVENT_AUTO_SYNC_MAX_EVENTS`
  - `EVENTBRITE_DELETE_SCAN_PAGES`
  - `EVENTS_INCREMENTAL_ONLY`
  - `EVENTS_SHEET_URL`

## 15. Deployment Steps

1. Deploy code normally on Hostinger.
2. Run `npm install` if dependencies changed.
3. Run `npm run build`.
4. Start with `npm run start:prod`.
5. Run the additive SQL migration manually against Neon/PostgreSQL outside a transaction.

## 16. Migration Steps

- Run `sql/2026-09-26_scalability_foundation.sql` manually.
- Because it uses `CREATE INDEX CONCURRENTLY`, do not wrap it in `BEGIN/COMMIT`.
- No existing data should be deleted.

## 17. Rollback Procedure

- Code rollback: redeploy the previous application build.
- Database rollback is usually unnecessary because changes are additive.
- If needed, drop only the newly added indexes/table/columns from `sql/2026-09-26_scalability_foundation.sql` after confirming no deployed code depends on them.

## 18. Known Limitations

- Full per-record repository refactor is not complete.
- Some writes still call `saveDb()` and can trigger broad table reconciliation.
- Filtered email search still needs SQL-backed filtering.
- Session token hashing is prepared at schema level but not yet active.
- Background sync lock/checkpoint table is prepared but not yet wired into Gmail/Eventbrite.

## 19. Recommended Future Upgrades

- Move leads/tasks/applications writes to direct `INSERT/UPDATE/DELETE` functions.
- Add `GET /api/leads` cursor pagination and migrate the frontend incrementally.
- Move filtered email list queries fully into SQL.
- Store Gmail/Eventbrite/Zoom sync checkpoints in `integration_sync_state`.
- Add PostgreSQL advisory locks for background sync.
- Gradually move legacy route logic into real NestJS controllers/services/repositories.
