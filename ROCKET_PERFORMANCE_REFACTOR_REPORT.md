# Rocket Performance Refactor Report

Date: 2026-09-27

## Security Issues Fixed

- Static file serving is now allowlisted to public browser assets only.
- Dotfiles and secrets are blocked, including `.env` and `.env.hostinger`.
- Server/runtime files are blocked, including `server.js`, `package.json`, `tsconfig.json`, `scripts/*`, `src/*`, `data/*`, deployment snapshots, backups and zip archives.
- Static path traversal is blocked before disk access and again by resolving the final path under `ROOT`.
- Session lookup now supports a hashed token index and no longer exposes session metadata through `publicUser`.
- Password reset completion now updates the user directly in PostgreSQL instead of saving the full legacy database payload.
- Bootstrap integration payloads are recursively stripped of token/secret/password fields before reaching the browser.
- `saveDb` and `savePostgresTables` now refuse partial workspace objects marked `__partial` or `__partial_load`.

## Static File Exposure Fixed

Public files are limited to one root-level filename with these extensions:

`.html`, `.js`, `.css`, `.webmanifest`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.ico`, `.woff`, `.woff2`

Blocked examples covered by the smoke test:

- `/.env`
- `/.env.hostinger`
- `/server.js`
- `/package.json`
- `/data/pathway-db.json`
- `/src/main.ts`
- `/scripts/security-static-smoke-test.js`
- `/anything.zip`
- `/../server.js`
- `/.git/config`

## Final Rocket Speed Audit

Verified on 2026-09-27 against the local production server on port `3001` backed by PostgreSQL. Timings below are `curl` total request durations from the app host, so they include auth/session lookup, local HTTP overhead and Neon round trips. SQL counts below exclude the auth/session query and `begin`/`commit` transaction statements; most authenticated routes add one session/user join and occasionally one throttled session-touch query.

| Action | Frontend handler | API endpoint | Backend handler | SQL queries | loadDb | cloneDb | recalculate | saveDb | savePostgresTables | External APIs | `/api/bootstrap` afterward | Full `render()` | Optimistic UI | Measured server duration | Remaining bottleneck |
|---|---|---|---|---:|---|---|---|---|---|---|---|---|---|---:|---|
| Lead create | `act==='add-lead'` dialog submit | `POST /api/leads` | `createLeadFastDb` | 6 | No | No | No | No | No | No | No | Yes, local patch | Yes | 1254.4ms | Neon RTT across programme, owner, duplicate, lead, task and audit writes |
| Lead stage | `.crm-stage-select` change | `PATCH /api/leads/:id` | `updateLeadFastDb` | 3 | No | No | No | No | No | No | No | No, partial lead list DOM | Yes | 887.4ms | Row lock + audit write |
| Lead owner | `act==='update-lead'` dialog submit | `PATCH /api/leads/:id` | `updateLeadFastDb` | 3 | No | No | No | No | No | No | No | Yes, local patch | Yes | 844.8ms | Row lock + audit write |
| Lead edit priority/stage/owner | `act==='update-lead'` dialog submit | `PATCH /api/leads/:id` | `updateLeadFastDb` | 3 | No | No | No | No | No | No | No | Yes, local patch | Yes | 832.0ms | Row lock + audit write |
| Lead delete | `act==='delete-lead'` confirm | `DELETE /api/leads/:id` | `deleteLeadFastDb` | 7 | No | No | No | No | No | No | No | Yes, local delete patch | Yes | 1397.4ms cleanup run | Related task/email/application/attribution deletes |
| Add programme opportunity | `act==='add-programme'` dialog submit | `POST /api/leads/:id/opportunities` | `addProgrammeOpportunityFastDb` | 4 | No | No | No | No | No | No | No | Yes, local patch | Yes | Not re-measured in final synthetic run | Programme lookup + audit write |
| Note creation | `act==='add-note'` dialog submit | `POST /api/leads/:id/notes` | `addLeadNoteFastDb` | 2 | No | No | No | No | No | No | No | Yes, local audit patch | Yes | 698.8ms | Audit insert only |
| Task create | `act==='add-task'` dialog submit | `POST /api/tasks` | `createTaskFastDb` | 3 | No | No | No | No | No | No | No | Yes, local task patch | Yes | 892.3ms | Lead lookup + audit write |
| Task complete | `act==='complete'` / `completeTaskOptimistic` | `POST /api/tasks/:id/complete` | `completeTaskFastDb` | 3 | No | No | No | No | No | No | No | Yes, local rerender after optimistic change | Yes | 837.5ms | Row lock + audit write |
| Task delete | `act==='delete-task'` confirm | `DELETE /api/tasks/:id` | `deleteTaskFastDb` | 3 | No | No | No | No | No | No | No | Yes, local delete patch | Yes | Not re-measured in final synthetic run | Row lock + audit write |
| Event attendee check-in | `act==='checkin'` | `POST /api/attendees/:id/checkin` | `checkInAttendeeFastDb` | 3-5 | No | No | No | No | No | No | No | Yes, local event/task patch | Yes | Not re-measured in final synthetic run | JSON attendee lookup inside event row |
| Log call | `act==='log-call'` dialog submit | `POST /api/calls` | `logCallFastDb` | 2-3 | No | No | No | No | No | No | No | Yes, local task/audit patch | Yes | Not re-measured in final synthetic run | Optional follow-up task insert |
| Record inbound email | `act==='record-email'` dialog submit | `POST /api/emails` | `recordEmailFastDb` | 3 | No | No | No | No | No | No | No | Yes, local email patch | Yes | 833.5ms | Lead lookup + email/audit writes |
| Open email detail | `act==='open-email'` / `openEmailDialog` | `GET /api/emails/:id` | `loadEmailDetail` | 1-2 | No | No | No | No | No | No | No | No full page render | Read state only | Not re-measured in final synthetic run | Detail/thread payload size |
| Email read | `openEmailDialog` optimistic read patch | `PATCH /api/emails/:id/read` | `updateEmailReadStateFastDb` | 2 | No | No | No | No | No | No | No | No full page render | Yes | 694.1ms | Row lock + JSON label update |
| Email unread | API-supported read toggle | `PATCH /api/emails/:id/read` | `updateEmailReadStateFastDb` | 2 | No | No | No | No | No | No | No | No full page render | Yes | 699.2ms | Row lock + JSON label update |
| Resolve email | `act==='resolve-email'` dialog submit | `POST /api/emails/:id/resolve` | `resolveEmailFastDb` | 3 | No | No | No | No | No | No | No | Yes, local email patch | Yes | Not re-measured in final synthetic run | Row lock + audit write |
| Send Gmail response | `act==='send-email-response'` dialog submit | `POST /api/emails/:id/reply` | Legacy reply path | Legacy | Yes | Yes | Yes | Yes | Yes | Gmail/SMTP | No | Yes, local email mark | Partial | Not treated as ordinary CRUD | External email delivery and thread correctness require integration pipeline |
| Email delete | `act==='delete-email'` confirm | `DELETE /api/emails/:id` | `deleteEmailFastDb` | 3 | No | No | No | No | No | No | No | Yes, local delete patch | Yes | 832.6ms cleanup run | Row lock + audit write |
| Application create / manual application | `act==='apply'` dialog submit | `POST /api/applications` | `createApplicationFastDb` | 4-6 | No | No | No | No | No | No | No | Yes, local lead/application patch | Yes | 1157.2ms | Lead row lock + evidence JSON payload + audit |
| Evidence upload | `act==='upload-evidence'` dialog submit | `POST /api/applications/:id/evidence` | `uploadEvidenceFastDb` | 2 | No | No | No | No | No | No | No | Yes, local application patch | Yes | Not re-measured in final synthetic run | Base64 file size inside JSONB |
| Evidence download | Evidence link/button | `GET /api/evidence/:id/file` | `sendEvidenceFileFastDb` | 1 | No | No | No | No | No | No | No | No | N/A | Not re-measured in final synthetic run | File payload transfer |
| Evidence review | `act==='review-evidence'` dialog submit | `POST /api/evidence/:id/review` | `reviewEvidenceFastDb` | 2 | No | No | No | No | No | No | No | Yes, local application patch | Yes | Not re-measured in final synthetic run | JSONB path search |
| Evidence delete | `act==='delete-evidence'` confirm | `DELETE /api/evidence/:id` | `deleteEvidenceFastDb` | 3 | No | No | No | No | No | No | No | Yes, local application/evidence patch | Yes | Not re-measured in final synthetic run | JSONB path search + audit |
| Application status | `act==='review-app'` dialog submit | `POST /api/applications/:id/review` | `reviewApplicationFastDb` | 5 | No | No | No | No | No | No | No | Yes, local lead/application patch | Yes | 1114.6ms | Locks application and lead, writes audit |
| Contract verify | `act==='contract'` dialog submit | `POST /api/applications/:id/contract` | `verifyContractFastDb` | 2 | No | No | No | No | No | No | No | Yes, local application patch | Yes | Not re-measured in final synthetic run | Application row update |
| Enrol application | `act==='enrol'` dialog submit | `POST /api/applications/:id/enrol` | `enrolApplicationFastDb` | 6 | No | No | No | No | No | No | No | Yes, local lead/application/attribution patch | Yes | Not re-measured in final synthetic run | Attribution insert + two row updates |
| Application delete | `act==='delete-application'` confirm | `DELETE /api/applications/:id` | `deleteApplicationFastDb` | 5-6 | No | No | No | No | No | No | No | Yes, local delete patch | Yes | Not re-measured in final synthetic run | Lead stage repair when needed |

Non-CRUD user-clickable actions that still use full-state or refresh behavior are intentionally outside the ordinary single-record CRUD rule:

| Action | Why full-state or external work remains |
|---|---|
| Reconcile leads | Bulk merge/link job across leads, attendees, calls and emails. It must inspect cross-record state and reload after completion. |
| Manual event import | Bulk import from spreadsheet/Google Sheets can create/update many events and attendees. |
| Gmail/Eventbrite/Zoom/Meta/Apollo sync | External provider APIs plus multi-record reconciliation. Refresh after completion is required because many lists can change. |
| Gmail reply | Sends real email and records response/thread state. It is not ordinary CRUD; correctness depends on Gmail/SMTP integration behavior. |
| Admin user create/role/reset/delete | Workspace permission and user-list changes still refresh admin state after success. These are admin/security operations, not CRM single-record CRUD. |

## Routes Migrated To Direct SQL

- `POST /api/leads`
- `PATCH /api/leads/:id`
- `DELETE /api/leads/:id`
- `POST /api/leads/:id/opportunities`
- `POST /api/leads/:id/notes`
- `POST /api/tasks`
- `POST /api/tasks/:id/complete`
- `DELETE /api/tasks/:id`
- `POST /api/attendees/:id/checkin`
- `POST /api/calls`
- `POST /api/emails`
- `POST /api/emails/:id/resolve`
- `PATCH /api/emails/:id/read`
- `DELETE /api/emails/:id`
- `POST /api/applications`
- `POST /api/applications/:id/evidence`
- `POST /api/evidence/:id/review`
- `DELETE /api/evidence/:id`
- `POST /api/applications/:id/review`
- `POST /api/applications/:id/contract`
- `POST /api/applications/:id/enrol`
- `DELETE /api/applications/:id`
- `POST /api/password/reset`
- Admin user create/reset/role/delete already use direct SQL on PostgreSQL.

## Routes Still Using Legacy Pipeline

These are not ordinary single-record CRUD actions, or they still depend on integration/full-workspace logic:

- `POST /api/password/forgot` for reset email config and delivery.
- `POST /api/leads/reconcile`.
- `POST /api/events/import`.
- Gmail OAuth/status/sync routes.
- Eventbrite OAuth/status/sync routes.
- Zoom event/call sync routes and Zoom calls list.
- Meta sync route.
- Apollo sync route.
- Non-PostgreSQL fallback routes under the legacy block.

## saveDb Callers Remaining

Remaining `saveDb` callers are now limited to:

- Initial seed/migration/cache hydration.
- Legacy JSON/Mongo fallback behavior.
- Bulk reconciliation/import/sync jobs.
- OAuth callback state saves for integrations.
- Password forgot path only as part of the pre-existing full DB mail config read path.

No normal PostgreSQL single-record CRM CRUD action uses `saveDb`.

`saveDb` is guarded against partial payloads so a paged/bootstrap workspace cannot accidentally trigger full-table synchronization.

## loadDb Callers Remaining

Remaining `loadDb` callers are:

- Startup and seed/hydration paths.
- Full bootstrap fallback when PostgreSQL direct tables are unavailable.
- Legacy integration, import, reconcile and sync jobs.
- Legacy non-PostgreSQL CRUD fallback.
- Password forgot email config path.

Normal PostgreSQL CRUD routes return before the legacy `loadDb()` block.

## recalculate Callers Remaining

Remaining server-side `recalculate()` usage is associated with:

- Legacy full DB load/save.
- Bootstrap fallback and data normalization.
- Bulk import/sync/reconcile flows.
- Local file/Mongo compatibility paths.

The fast CRUD routes do not call server-side `recalculate()`.

Frontend ordinary CRUD now uses `syncClientDerived(data)` after local mutation patches instead of the legacy `recalculate(data)` name. This is a browser-only derived-state pass and does not trigger server full-state work.

Server-side full-table sync is additionally guarded by the partial-workspace flags.

## Bootstrap Refreshes Removed

Removed for ordinary CRUD:

- Add lead.
- Update lead/stage.
- Delete lead.
- Add programme opportunity.
- Add note.
- Add task.
- Complete task.
- Delete task.
- Event check-in.
- Log call.
- Record/resolve/delete email.
- Email read/unread.
- Create/review/enrol/delete application.
- Upload/review/delete evidence.

Bootstrap refresh remains for:

- Initial app load.
- Integration sync/import/reconcile jobs.
- Admin user management screens.
- Login/role changes where permissions or workspace user lists change.

## Optimistic UI Actions Added

- Lead stage updates.
- Task completion.
- Email read/unread updates.
- Note creation patches the local audit/timeline state.
- Server mutation patching for add/update/delete responses.
- Local deletion patching for leads, tasks, emails, applications and evidence.
- Manual application creation patches leads/applications/attribution without a bootstrap reload.
- Evidence/application review/enrolment updates patch the local application and lead state.

## Auth Query Reduction

Before:

- Session lookup.
- User lookup.
- Session expiry touch on every authenticated request.
- Some auth-adjacent routes fell through the full `loadDb()` block.

After:

- Authenticated PostgreSQL requests use one `sessions JOIN users` query.
- Session expiry is touched only after `SESSION_TOUCH_INTERVAL_MS` (10 minutes).
- Session token hash is indexed and backward-compatible with existing raw session IDs.
- Logout and password reset completion return before the legacy `loadDb()` block.

## Request Timing Instrumentation

- API requests now record route, method, status and total duration in `monitoringState.api_timings`.
- Slow API requests log a concise timing line without request bodies, credentials or payload data.
- `/api/monitoring/system` includes recent timing samples for production latency auditing.

## DB Indexes Added

- `app_sessions(user_id)`
- `app_sessions(expires_at)`
- Partial unique `app_sessions(token_hash) where token_hash is not null`
- `app_leads(stage)`
- `app_leads(owner_id)`
- `app_leads(created_at)`
- `app_tasks(lead_id)`
- `app_tasks(status)`
- `app_tasks(due_at)`
- `app_applications(lead_id)`
- `app_emails(received_at)`

## Background Sync Improvements

- Gmail auto sync remains automatic and controlled by environment settings.
- Event/Zoom/Gmail sync data is preserved and not wiped by ordinary CRUD.
- Frontend keeps heavy provider syncs explicit because they can run seconds to minutes and depend on third-party quotas.
- Heavy sync routes still reload after completion because they can mutate many records across leads, emails, events, calls and attribution.

## Before/After Timing Table

| Flow | Before | After |
|---|---:|---:|
| Single lead stage change | Full `loadDb` + `recalculate` + `saveDb` + bootstrap reload, often seconds | Direct row update + audit, local optimistic patch, measured 887.4ms local HTTP |
| Complete task | Full state save + reload | Direct task update + audit, optimistic UI, measured 837.5ms local HTTP |
| Create application | Full state save + reload | Direct transaction updating lead/application/attribution, local patch, measured 1157.2ms local HTTP |
| Delete application/evidence/email/task/lead | Missing or legacy full state work | Direct SQL delete with local UI patch |
| Password reset completion | Full DB save pipeline | Direct SQL user update + token/session cleanup |
| Static request | Any readable root file risk | Public allowlist only |
| Authenticated request | Session + user + touch every request | Single join + throttled touch |

## Remaining Bottlenecks

- Provider sync jobs still intentionally do full-workspace reconciliation and external API pagination.
- `POST /api/emails/:id/reply` still depends on Gmail/SMTP and the legacy mail-send path.
- `POST /api/password/forgot` still loads legacy config to reuse the existing Gmail API/SMTP delivery behavior.
- `GET /api/bootstrap` still returns a broad workspace snapshot; more screens should continue moving to paged APIs.
- Evidence files are stored as base64 in application JSON; large documents will still increase row and payload size.
- JSONB path lookups for evidence are acceptable now, but a dedicated evidence table is the next scaling step.

## Hostinger Limitations

- Hostinger -> Neon network latency dominates small queries; batching inside transactions helps but cannot remove RTT.
- Node process cold starts/restarts can make first request slower.
- Large uploads are limited by Hostinger request body limits and browser base64 conversion.
- Long provider syncs may hit hosting execution, memory or outbound network limits.

## Neon Latency Findings

- Fast CRUD is now mostly one transaction with bounded row-level work.
- Remaining perceived latency should come from Neon RTT, row locks, JSONB document size and external providers.
- Indexes cover the highest frequency dashboard/list predicates currently used by the app.
- Avoiding `saveDb` prevents rewriting all workspace tables for one small change.

## Secret Names Requiring Rotation

Rotate these names if they were exposed in any previous deployment zip, screenshot, logs or shared file. Values are intentionally not included here.

- `DATABASE_URL`
- Gmail OAuth client ID, client secret, refresh token and access token
- Gmail SMTP user/password
- Eventbrite client ID, client secret, access token and refresh token
- Zoom account 1 and 2 credentials/tokens
- Meta access token and page/form config
- Apollo API key
- `INITIAL_ADMIN_PASSWORD`
- `DEV_PANEL_PASSWORD`
- `SESSION_SECRET`
- Any `MAIL_*`, `SMTP_*` or provider webhook secrets configured outside this file

## Rollback Instructions

1. Revert `server.js`, `app.js`, `styles.css`, `package.json` and `scripts/security-static-smoke-test.js` to the previous deployment tag or backup commit.
2. Redeploy the previous Hostinger artifact.
3. Keep the new database indexes; they are additive and safe.
4. If session token hash behavior must be reverted, existing raw session IDs still work because lookup remains backward-compatible.
5. Run `npm run check` before and after rollback deployment.

## Next Recommended Migration Phase

1. Move Gmail reply/send into a direct SQL route that only updates the target email and audit row after provider send succeeds.
2. Convert `POST /api/password/forgot` to a minimal SQL config read or SMTP-only reset delivery path.
3. Split evidence documents into a dedicated table or object storage pointer instead of base64 inside application JSON.
4. Convert Zoom calls list to paged direct SQL.
5. Move provider sync state from legacy workspace JSON into dedicated integration state tables.
6. Add route-level timing logs for p50/p95 measurements in production.

## Verification

- `npm run check`
- `node --check server.js`
- `node --check app.js`
- `npm run test:security`
- `npm run test:rocket`
- `npm run build`
- Static and bootstrap secret smoke tests passed.
- Live static checks returned 404 for `/.env`, `/.env.hostinger`, `/server.js`, `/package.json`, `/package-lock.json`, `/data/pathway-db.json`, `/src/main.ts`, `/old.zip` and `/hostinger.zip`.
- Live CRUD timings verified at minimum: lead stage, lead owner, lead edit, task create, task complete, application status, note creation and email read/unread.
