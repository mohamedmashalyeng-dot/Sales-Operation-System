# Analytics Metric Definitions

Date: 2026-10-12

## Scope

Analytics uses deterministic operational metrics only. No forecasting, scoring, ROI, or AI-derived insight is included.

Authorization follows the existing workspace policy:

- Member / sales users: records owned by the signed-in user.
- Monitor / manager / admissions / QA / admin / developer users: team scope.

## Date Semantics

- Lead captured: `kbc_lead_captured_at(app_leads.data, app_leads.created_at)`, reusing the existing dashboard captured-at helper and index.
- Application created: `app_applications.created_at`.
- Approved: current application status is `Eligible` or the application is already enrolled. The reliable approval event timestamp is not always present, so approval is a cohort state metric unless audit history is present in detail views.
- Enrolled: `app_applications.learner->>'enrolled_at'`, falling back to `status = 'Enrolled'` / `learner is not null` for state counts.
- Email received: `app_emails.received_at`, excluding trashed emails.
- First response: `app_emails.response_at` for linked inbound/non-sent messages where `response_at >= received_at`.

## Funnel Metrics

### Captured Leads

- Meaning: Leads whose first reliable capture date falls inside the selected period.
- Numerator: Count of active `app_leads`.
- Denominator: Not applicable.
- Date field: Lead captured date.
- Filters: Date range, programme, intake, owner, source.
- Exclusions: Soft-deleted/merged leads excluded by existing lead active condition.
- Authorization scope: Member owns only; team users may view team/filtered owner scope.
- Limitations: Depends on provider capture fields when present; otherwise falls back to `created_at`.

### Progressed Leads

- Meaning: Captured leads that moved beyond new intake or have an application.
- Numerator: Captured leads with stage not in `New lead`, `Lost`, `Not Eligible`, `Deferred`, or with an application.
- Denominator: Captured Leads.
- Date field: Lead captured date for cohort membership.
- Filters / exclusions / scope: Same as Captured Leads.
- Limitations: Lead stage history timestamps are incomplete; this is a current-state cohort metric.

### Applications From Lead Cohort

- Meaning: Captured leads that have at least one application.
- Numerator: Cohort leads with `exists app_applications`.
- Denominator: Captured Leads.
- Date field: Lead captured date for denominator; application may happen later.
- Filters: Lead filters plus joined application scope.
- Limitations: Cohort conversion, not applications created during period.

### Approved From Lead Cohort

- Meaning: Captured leads with an application currently approved or enrolled.
- Numerator: Cohort leads with application `status = Eligible`, `status = Enrolled`, or `learner is not null`.
- Denominator: Applications From Lead Cohort.
- Date field: Lead captured date for cohort membership.
- Limitations: Approval event date is not always reliable; current state is used.

### Enrolled From Lead Cohort

- Meaning: Captured leads that reached enrolment.
- Numerator: Cohort leads with an enrolled application or lead stage `Enrolled`.
- Denominator: Approved From Lead Cohort for approval-to-enrolment, Captured Leads for overall conversion.
- Date field: Lead captured date for cohort membership.
- Limitations: Current state, with enrolment date used separately in event/trend charts.

## Event Metrics

### Applications Created

- Meaning: Application records created in the selected period.
- Numerator: `app_applications` where `created_at` is inside range.
- Denominator: Not applicable.
- Date field: `app_applications.created_at`.
- Limitations: Not the same as cohort conversion.

### Enrolments Recorded

- Meaning: Enrolment events recorded in the selected period.
- Numerator: Applications with `learner.enrolled_at` inside range.
- Denominator: Not applicable.
- Date field: `learner.enrolled_at`.
- Limitations: Older records without learner timestamps may be visible in state totals but not event trends.

## Response Time

- Meaning: Time from inbound customer email to first recorded staff response.
- Numerator: Linked, non-trash, inbound/non-sent emails with `received_at` and `response_at`.
- Denominator: Same email set.
- Date field: `received_at`.
- Filters: Date range, programme, intake, owner, source.
- Exclusions: Trashed messages, sent/outbound folder messages, missing lead relationship, negative durations.
- Metrics: average, median, and buckets `<15m`, `15-60m`, `1-4h`, `4-24h`, `>24h`.
- Limitations: Uses the recorded `response_at`; if staff responded outside the system and did not record it, the metric is incomplete.

## Stage Ageing

- Meaning: Current record age in its present lead or admissions stage.
- Numerator: Age in days from reliable stage-entry timestamp when audit exists, otherwise from captured/application created date.
- Denominator: Current records in the stage.
- Date field: lead captured date or application created date fallback.
- Filters: Same as lead/application filters.
- Limitations: Labelled observational. It is not a full stage-duration metric when stage history is missing.

## Source Performance

- Meaning: Conversion by real lead source.
- Numerator: Cohort counts grouped by `source_lead_capture`, `source_first_touch`, or source fields in lead data.
- Denominator: Captured Leads per source.
- Date field: Lead captured date.
- Limitations: No marketing cost/spend data exists, so this is conversion performance, not ROI.

## Programme Performance

- Meaning: Conversion by real programme id/name.
- Numerator: Cohort counts grouped by `programme_id` and programme name.
- Denominator: Captured Leads per programme.
- Date field: Lead captured date.
- Limitations: Missing programme is labelled `No programme`.

## Owner / Team Performance

- Meaning: Operational workload and bottleneck view, not a leaderboard.
- Metrics: cohort leads, open current leads, applications, overdue tasks, response median.
- Date field: Lead captured date for cohort; task due date for overdue tasks; email received date for response.
- Limitations: Workload mix differs by source and programme; do not use as employee ranking.
