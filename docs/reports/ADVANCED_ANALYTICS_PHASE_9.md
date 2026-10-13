# Advanced Analytics + Conversion Funnel - Phase 9

Date: 2026-10-12

## 1. Existing Metrics Discovered

- Dashboard already uses `kbc_lead_captured_at(data, created_at)` for lead captured-date semantics.
- Monitoring dashboard already aggregates stage counts, programme rows, team rows, response averages, stale leads and integration health.
- Admissions Workflow defines real stages through `ADMISSIONS_STAGE_ORDER`: `In review`, `Documents Missing`, `Documents Pending`, `Eligible`, `Not Eligible`, `Enrolled`.
- Lead stages in the workspace include `New lead`, `Qualified`, `Application Submitted`, `Eligibility`, `Ready for Enrolment`, `Enrolled`, `Not Eligible`, `Lost`.
- Response-time source is `app_emails.received_at -> app_emails.response_at`, excluding trashed/sent/outbound messages.

## 2. Metric Definitions

Full definitions are in `docs/reports/ANALYTICS_METRIC_DEFINITIONS.md`.

Implemented metrics:

- Captured Leads
- Progressed Leads
- Applications from lead cohort
- Approved from lead cohort
- Enrolled from lead cohort
- Applications created event count
- Enrolments recorded event count
- Average / median first response time
- Response-time buckets
- Source conversion performance
- Programme conversion performance
- Owner workload metrics
- Observational stage ageing
- Lead/application/enrolment trends

## 3. Funnel Definition

The funnel is cohort-based on the lead captured date:

1. Captured Leads
2. Progressed Leads
3. Applications
4. Approved
5. Enrolled

Approved means current application state `Eligible`, `Enrolled`, or `learner is not null`.

## 4. Cohort / Event Methodology

- Funnel conversion is cohort-based: denominator is the selected lead cohort.
- Application/enrolment event counts are shown separately.
- Trend buckets include leads by captured date, applications by created date, and enrolments by learner enrolled date.

## 5. Date Semantics

- Lead captured: `kbc_lead_captured_at(app_leads.data, app_leads.created_at)`.
- Application created: `app_applications.created_at`.
- Enrolled event: `app_applications.learner->>'enrolled_at'`.
- Email response: `received_at` to `response_at`.
- Stage ageing: observational fallback to lead captured/application created date where exact stage-entry audit is unavailable.

## 6. Authorization Scopes

- Analytics is available to signed-in users.
- Members are forced to their own `owner_id` through the existing permission model.
- Team users may view team scope or filter by owner.
- No organization-wide totals are exposed to member/sales users.

## 7. Endpoints

- `GET /api/analytics/overview`
- `GET /api/analytics/diagnose`

Both are read-only and do not call external providers.

## 8. Snapshot / Cache Strategy

No persistent analytics snapshot was added in this phase.

Reason:

- Default queries are bounded and use existing indexes.
- Latest EXPLAIN for the slowest measured query reported PostgreSQL execution around `1.638ms`, with `348` shared hit blocks and `0` shared read blocks.
- Wall-clock diagnostic timings include Neon/network round trip and pool behavior, so snapshot work should be considered only if production requests prove slow under real traffic.

## 9. SQL Plans

Latest `npm run diagnose:analytics`:

- Slowest wall-time query: `analytics_programmes`
- Observed diagnostic wall time: `2620.7ms`
- EXPLAIN observed time: `1010.5ms`
- PostgreSQL execution time: `1.638ms`
- Planning time: `2.553ms`
- Actual rows: `11`
- Shared hit blocks: `348`
- Shared read blocks: `0`

## 10. Indexes Added

None.

Existing relevant indexes reused:

- `app_leads_captured_at_idx`
- `app_leads_created_at_idx`
- `app_leads_programme_id_idx`
- `app_leads_source_capture_idx`
- `app_leads_owner_id_idx`
- `app_applications_created_at_idx`
- `app_applications_lead_id_idx`
- `app_emails_received_at_idx`

## 11. Funnel Timing

Latest diagnostic:

- `analytics_funnel`: `156.2ms` wall time, 1 row.
- SQL execution for slowest query was sub-2ms by EXPLAIN; measured wall time is mostly connection/round-trip overhead.

## 12. Response-Time Definition

Included:

- Linked emails with `lead_id`
- `received_at` and `response_at`
- `response_at >= received_at`
- Not trashed
- Not sent/outbound

Excluded:

- Trash/bin messages
- Outbound/sent messages
- Missing response timestamp
- Negative durations

## 13. Source Metrics

Grouped by real source fields:

- `source_lead_capture`
- `source_first_touch`
- source fields in lead JSON
- fallback `Other`

Shows volume and conversion. No ROI is shown because spend data is unavailable.

## 14. Programme Metrics

Grouped by:

- `programme_id`
- programme name from lead/programme tables
- fallback `No programme`

Shows leads, applications, approved, enrolled and conversion rates.

## 15. Team / Owner Metrics

Presented as workload and bottleneck context:

- cohort leads
- open leads
- applications
- enrolled
- open tasks
- overdue tasks
- median response

This is intentionally not an employee ranking leaderboard.

## 16. UI Implemented

Added Analytics page with:

- date/source/programme/owner filters
- executive KPIs
- conversion funnel
- source performance
- programme performance
- response-time buckets
- owner workload
- stage ageing
- trend bars

The UI uses existing KBC panels, cards, borders and restrained chart styling.

## 17. Tests

Added:

- `npm run test:analytics`
- `npm run diagnose:analytics`

Completed during implementation:

- `npm run test:analytics`
- `npm run diagnose:analytics`
- `npm run test:frontend`
- `npm run test:authorization`
- `npm run test:my-day`
- `npm run test:automations`
- `npm run test:admissions`
- `npm run test:data-quality`
- `npm run test:integration-centre`
- `npm run check`

Full regression passed.

## 18. Known Data Limitations

- Stage-entry dates are incomplete for some lead/application states, so stage ageing is observational.
- Approval event date is not always reliable; approval is represented as current state in cohort conversion.
- No marketing spend exists; ROI is intentionally absent.
- Response-time accuracy depends on staff/system recording `response_at`.
- Analytics does not run Data Quality scans; known data quality problems may still affect metrics.
