# Data Quality Centre - Phase 7

Date: 2026-10-12

## 1. Schema / Relationships Audited

Relevant tables inspected from current schema/code:

- `app_leads`: primary key `id`; owner via `owner_id`; programme via `programme_id`; external ids in `data` such as `zoho_record_id`, `meta_lead_id`, `apollo_person_id`; no assumed foreign keys.
- `app_tasks`: primary key `id`; relationship to leads via `lead_id`; owner via `owner_id`.
- `app_emails`: primary key `id`; optional relationship to leads via `lead_id`; standalone mailbox emails without `lead_id` are valid.
- `app_applications`: primary key `id`; canonical Admissions workflow expects `lead_id`; document state in `requirements`, `contract`, `learner`.
- `app_events`: primary key `id`; attendee lead links live in `attendees` JSONB.
- `app_audit`: primary key `id`; lead references use `entity = 'lead'` and `entity_id`.
- `app_zoho_records`: synced Zoho summaries keyed by `key`; Data Quality does not call Zoho APIs.
- `app_lead_external_ids`: existing dedupe/merge support table when migration exists.
- `app_users`: owner records, configured by `POSTGRES_USERS_TABLE`.

## 2. Existing Cleanup Logic Discovered

- `lib/lead-dedupe.js`: duplicate discovery, classification, merge preview, relationship counts, and destructive merge infrastructure guarded by explicit flags.
- `scripts/lead-dedupe-report.js`: read-only duplicate/orphan report and dry-run plans.
- `scripts/lead-dedupe-merge.js`: explicit reviewed merge command; not used by this phase.
- `scripts/lead-email-canonicalize.js`: explicit cleanup workflow with safety flags; not used by this phase.
- Existing normalization helpers include email normalization and phone digit extraction patterns.

## 3. Issue Categories

Implemented:

- `duplicate_leads`
- `missing_email`
- `invalid_email`
- `missing_phone`
- `invalid_phone`
- `missing_owner`
- `missing_programme`
- `orphan_task`
- `orphan_application`
- `orphan_email_relation`
- `duplicate_external_id`
- `zoho_mismatch`
- `stale_lead`
- `stale_application`
- `incomplete_application`

## 4. Duplicate Rules

Duplicate lead groups use only strong exact keys:

- normalized email exact match
- normalized phone digits exact match
- same `zoho_record_id`
- same `meta_lead_id`
- same `apollo_person_id`

Name-only matching is intentionally not used.

## 5. False-Positive Protections

- Similar names alone are not duplicate evidence.
- Synthetic `.local` emails are excluded from email duplicate grouping.
- Standalone emails without `lead_id` are not orphaned.
- No record is merged, deleted, reassigned, or overwritten.

## 6. Missing / Invalid Data Rules

- Missing email/phone: blank after trimming.
- Invalid email: basic `local@domain.tld` format only; no deliverability claim.
- Invalid phone: too short, too long, repeated placeholder digits, or obvious placeholders.
- Missing owner: blank owner or owner not found in `app_users`.
- Missing programme: blank programme id or programme not found in `app_programmes`.

## 7. Orphan Rules

- Tasks are orphaned only when `lead_id` is present and no active lead resolves.
- Applications are orphaned when `lead_id` is present and no active lead resolves.
- Emails are orphaned only when they claim a `lead_id` that no longer resolves.

## 8. Stale Definitions

- Stale leads: open/non-terminal stage, older than configurable `DATA_QUALITY_STALE_DAYS` defaulting to 90, and no current `next_action_at`.
- Stale applications: non-terminal application older than the stale window and not enrolled.

## 9. Zoho Reconciliation

Read-only only:

- Local lead has `zoho_record_id` but no synced `app_zoho_records` row.
- Local email differs from synced Zoho summary email where both are present.

No Zoho API call is made and no source-of-truth decision is applied.

## 10. Authorization

- API routes require `Authorization.requireTeam(user)`.
- Member/sales users cannot access organization-wide Data Quality results.
- Data Quality navigation is hidden for users without review/admin/developer permissions.
- Duplicate groups are team-only, preventing cross-owner information leakage to ordinary members.

## 11. Snapshot Architecture

Added migration:

- `sql/2026-10-12_data_quality_snapshot.sql`
- Table: `app_data_quality_snapshot`

`GET /api/data-quality/summary` uses the snapshot when present and fresh. Stale snapshots are returned immediately and a refresh is queued asynchronously. Missing snapshot table falls back to live computation and reports that the migration should be applied.

## 12. SQL Plans / Timings

Latest `npm run diagnose:data-quality` on PostgreSQL:

- Summary live computation: 4036.4 ms
- Duplicate issue page: 1639.4 ms for 10 rows
- Orphan task issue page: 357.7 ms for 0 rows
- Stale lead issue page: 506.2 ms for 10 rows
- Zoho mismatch issue page: 900.7 ms for 0 rows

EXPLAIN samples:

- duplicate email groups: 199.434 ms, 23,884 shared hit blocks
- orphan tasks: 191.117 ms, 167,706 shared hit blocks, 8,005 shared read blocks
- stale leads: 0.028 ms for first 10 rows
- Zoho mismatch: 839.525 ms, 495,213 shared hit blocks, 45,873 shared read blocks

## 13. Data Quality Performance Closure

Phase 7.1 applied only Data Quality snapshot/index work.

Snapshot migration applied:

- `sql/2026-10-12_data_quality_snapshot.sql`
- Created `app_data_quality_snapshot`
- Created implicit primary key index `app_data_quality_snapshot_pkey`
- Non-destructive: no `DELETE`, `TRUNCATE`, production record mutation, CRM table rewrite, Zoho write, or cleanup action.

Snapshot behavior:

- TTL: `15 minutes` via `DATA_QUALITY_SNAPSHOT_TTL_MS`, defaulting to `15 * 60 * 1000`.
- Fresh snapshot returns from `app_data_quality_snapshot`.
- Stale snapshot returns immediately and production requests queue a safe background refresh.
- Missing snapshot computes once, persists, then returns.
- Refresh concurrency uses PostgreSQL advisory lock `hashtext('data-quality:snapshot:main')` plus in-process promise coalescing; it does not rely only on memory.

Latest `npm run diagnose:data-quality` closure timings:

- Missing snapshot compute and persist: 3362.5 ms.
- Fresh snapshot read: 144.3 ms API total.
- Stale snapshot read without waiting: 149.3 ms API total.
- Live summary calculation: 3367.5 ms.
- Duplicate issue query: 641.6 ms API total for 10 rows; focused SQL plan 2.446 ms, 707 shared hit blocks.
- Zoho mismatch query: 287.4 ms API total for 0 rows using the fresh zero-count snapshot fast path.
- Zoho live SQL fallback plan: 581.534 ms, 523,654 shared hit blocks, 22,635 shared read blocks.

Duplicate optimization:

- Before: 1639.4 ms for first issue page.
- After: 639.4 ms for first issue page.
- The endpoint still uses exact normalized email, phone digits, `zoho_record_id`, `meta_lead_id`, and `apollo_person_id`.
- The first page no longer constructs every duplicate rule before returning; it checks bounded rule groups in SQL and stops once the page is filled.
- Records are fetched in bounded batches by rule/key; no Node full-table scan was introduced.

Zoho optimization:

- Before: 900.7 ms issue page and 839.525 ms EXPLAIN sample.
- After: 287.4 ms issue page through the fresh zero-count snapshot fast path; live SQL fallback plan 581.534 ms.
- Query remains read-only and uses only locally synced PostgreSQL data.
- No Zoho API call is made.
- Current dataset has 0 mismatches. Fresh snapshots with `zoho_mismatch = 0` return an empty issue page immediately; stale snapshots or non-zero counts fall back to the read-only live SQL reconciliation.
- The live SQL fallback must still prove absence across a large local reconciliation set. The covering indexes reduce the cost, but a larger architecture change was intentionally avoided.

Performance index migration added and applied:

- `sql/2026-10-12_data_quality_performance_indexes.sql`
- `app_leads_dq_email_norm_idx`: 5968 kB
- `app_leads_dq_phone_norm_idx`: 72 kB
- `app_leads_dq_meta_id_idx`: 8192 bytes
- `app_leads_dq_apollo_id_idx`: 8192 bytes
- `app_leads_dq_zoho_mismatch_idx`: 13 MB
- `app_zoho_records_dq_key_email_idx`: 14 MB

Result equivalence:

- Data Quality tests still pass, including exact duplicate email, exact external id, no fuzzy name duplicate, missing/invalid fields, orphans, authorization route hooks, and bounded pagination.
- Metrics remain unchanged for the measured snapshot: `duplicate_leads = 37`, `duplicate_external_id = 0`, `zoho_mismatch = 0`.
- Authorization guard remains `Authorization.requireTeam(user)`.

## 14. Indexes

The initial Phase 7 did not add indexes. Phase 7.1 added only measured Data Quality expression/covering indexes listed above.

## 15. Tests

Passed:

- `npm run test:data-quality`
- `npm run test:authorization`
- `npm run test:my-day`
- `npm run test:frontend`
- `npm run test:automations`
- `npm run test:admissions`
- `npm run test:saved-views`
- `npm run check`
- `npm run diagnose:lead-360`
- `npm run diagnose:global-search`
- `npm run diagnose:data-quality`

## 16. Known Limitations

- Live summary computation remains expensive, but normal summary requests now use the database-backed snapshot.
- Zoho mismatch remains above the preferred SQL target on the current zero-mismatch dataset because it must scan local reconciliation data to prove no mismatch exists.
- No destructive cleanup workflow is implemented.
- No AI scoring or vague company-wide score is implemented.
- Lead 360/Application inline warnings were skipped to avoid extra quality scans on record detail pages.

## 17. Future Cleanup Workflow

Recommended future workflow only:

Detect -> Review -> Select Master -> Preview relationships -> Resolve conflicts -> Move relationships -> Soft-delete duplicate -> Audit -> Verify.

This phase implements Detect, Group, Explain, and Review only.
