# Admissions Workflow Phase 5

Date: 2026-10-12

## Scope

Implemented a structured Admissions Workflow on top of the existing Lead and Application records. The work keeps `app_applications` as the canonical application table and uses existing `requirements`, `contract`, `learner`, lead ownership, tasks, and audit records.

## What Changed

- Added admissions aggregate API: `GET /api/admissions/pipeline`.
- Added bounded stage list API: `GET /api/admissions/stage/:stage?limit=&offset=`.
- Added application detail API: `GET /api/applications/:id`.
- Added guarded status transition API: `PATCH /api/applications/:id/status`.
- Upgraded Applications UI into an Admissions pipeline with server-side counts and paginated stage loading.
- Added Application Detail view with applicant, linked Lead 360, programme/intake/status/owner, requirements checklist, tasks, next action, activity and stage history.
- Changed Lead 360 Application tab to a compact application summary with a link to the canonical application detail view.
- Added `npm run test:admissions` and `npm run diagnose:admissions`.

## Statuses And Stages

Persisted application statuses are not renamed. The workflow uses the existing values found in code:

- `In review`
- `Eligible`
- `Not Eligible`
- `Enrolled`

Computed admissions stages are derived from existing status plus requirements/learner data:

- `Documents Missing`: at least one required document is missing or rejected.
- `Documents Pending`: at least one uploaded requirement is pending review.
- `In review`: default review state when no document blocker takes precedence.
- `Eligible`: existing application status is `Eligible`.
- `Not Eligible`: existing application status is `Not Eligible`.
- `Enrolled`: existing learner record or status `Enrolled`.

## Permissions

All new single-record application reads and transitions use existing Phase 1 authorization:

- Member users are constrained to applications linked to leads they own.
- Team/review/admin users can access team workflow records.
- Status transitions require `sales` or `review` permission after record access is checked.

## Performance

Pipeline counts are computed in SQL aggregate form and do not load all applications into Node. Stage lists are bounded with `limit + offset`. Existing indexes already cover the main access paths:

- `app_applications_lead_id_idx`
- `app_applications_status_idx`
- `app_applications_created_at_idx`
- lead owner/source indexes from prior phases

No new index migration was added in this phase. JSON requirement-stage filters should be measured with production row counts before adding a GIN/expression index.

## Known Gaps

- Stage age is audit-backed when a matching audit item exists; otherwise it reports `created_at_fallback`.
- Enrolment remains the existing `application.learner` JSON structure plus attribution snapshot. No separate enrolment table was invented.
- Automation integration remains event-compatible through `application_status_changed`; no enabled external automation actions were added.

## Verification

Completed:

```bash
npm run test:authorization
npm run test:my-day
npm run test:frontend
npm run test:automations
npm run test:admissions
npm run check
npm run diagnose:lead-360
npm run diagnose:admissions
```

Admissions diagnostic on the configured PostgreSQL database:

- Pipeline aggregate: 831 applications in 208.4 ms.
- Stage distribution: 831 `Enrolled`, 0 in all other computed stages.
- Enrolled stage page: 25 records in 912.2 ms.
- Sample application detail: 318.5 ms.

The slower stage/detail timings should be re-measured after real non-enrolled admissions volume exists. No index was added without production evidence.
