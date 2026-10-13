# Automation Engine Phase 4

Date: 2026-10-12

## Existing Infrastructure Found

- `integration_jobs` already provides a durable PostgreSQL job pattern for Zoho sync, including status, locks, retry timing, and stale leases.
- `app_audit` is the existing audit trail and Lead 360 already reads it into the timeline.
- Task creation, lead updates, application review, and task completion already run through server-side business functions and authorization helpers.
- Background syncs are scheduled in integration modules, but there was no generic CRM automation rule engine.

## Automation Schema

Added an additive migration: `sql/2026-10-12_automation_engine.sql`.

Tables:
- `app_automation_rules`
- `app_automation_events`
- `app_automation_jobs`
- `app_automation_runs`

Indexes are scoped to the queries used by the foundation: enabled rules by trigger, claimable jobs by status/run time, jobs by rule/status, events by trigger/time, and runs by rule/time.

## Trigger Types

Initial supported triggers:
- `lead_created`
- `lead_stage_changed`
- `lead_updated`
- `application_status_changed`
- `task_completed`
- `email_received`
- `time_based_follow_up`
- `no_activity_for`

Incremental event capture was wired into lead create/update, application status review, and task completion. Email and time-based triggers are represented in the model but not broadly wired to every mutation yet.

## Condition Model

Rules store declarative condition arrays only. Supported operators:
- `equals`
- `not_equals`
- `in`
- `not_in`
- `is_empty`
- `is_not_empty`
- `before`
- `after`
- `older_than`

Condition groups support `all` and `any`. No arbitrary SQL or JavaScript is stored or executed.

## Action Types

Phase 4 internal actions:
- `create_task`
- `add_note`
- `mark_follow_up_required`
- `change_stage`
- `assign_owner`
- `update_safe_field`

External email, SMS, WhatsApp, arbitrary webhooks, AI-written automations, and workflow canvas features are deferred.

## Idempotency

Jobs are unique per `(rule_id, event_id)`. Runs use a unique `idempotency_key`. Task creation also records an `automation_idempotency_key` in task data so a retried action does not create duplicate tasks for the same rule/event/action index.

## Job Claiming

Workers claim jobs with `FOR UPDATE SKIP LOCKED`, moving claimable rows from `pending` or `retry_wait` to `running` with a worker id and claim timestamp.

## Retry Model

Failed jobs retry with bounded attempts and delayed backoff. Exhausted jobs remain visible as `failed` with a safe error message.

## Stale Recovery

Running jobs with an old `claimed_at` timestamp are returned to `retry_wait`, making them recoverable after a worker restart.

## Loop Prevention

Automation-originated events carry `origin_run_id` and `depth`. Processing stops above depth 2 to prevent a stage-changing rule from recursively triggering itself forever.

## Security Model

Automation management APIs require existing monitor/developer style permissions through `Auth.permissionsForUser` and do not introduce a new superuser role. Actions execute under the rule creator/owner concept and still call `Authorization.requireRecord` for lead-bound mutations.

## Dry Run

`POST /api/automations/:id/preview` and `POST /api/automations/preview` evaluate bounded sample records and return proposed actions without writing leads, tasks, applications, notes, stages, or ownership.

## UI Routes

Added an `Automations` page in the current KBC/Readdy style:
- rule list
- status metrics
- enable/disable
- test/preview
- compact structured draft builder
- manual worker run

No drag-and-drop canvas was added.

## Lead 360 Integration

Automation actions write `app_audit` entries with actor `automation:<rule-id>`. Lead 360 already reads audit rows into its timeline, so automation actions appear naturally without a separate Lead 360 API.

## My Day Integration

Automation-created tasks are normal `app_tasks` records. They appear in My Day when they match existing My Day criteria. No separate My Day automation API was added.

## Migrations

Apply `sql/2026-10-12_automation_engine.sql` before enabling automation APIs in production. The migration is additive and non-destructive.

## Performance Impact

Normal CRM mutations only attempt a lightweight outbox insert when automation tables exist. Rule evaluation and actions run asynchronously from `app_automation_jobs`, so user requests do not execute full automation actions.

## Tests

Added `npm run test:automations`.

It always covers condition logic. If `AUTOMATION_TEST_DATABASE_URL` points to an isolated PostgreSQL database, it also covers migration, rule creation, event capture, processing, idempotent task action behavior, stale recovery, and dry-run non-mutation.

## Diagnostics

Added `npm run diagnose:automations`, which reports enabled rules, pending/running/retry/failed jobs, oldest pending job, last processed timestamp, and processing latency. It does not mutate data.

## Deferred Features

- automatic external email sending
- SMS/WhatsApp
- arbitrary webhooks
- AI automation generation
- drag-and-drop canvas
- deep branching workflow designer
- automatic bulk backfill on enable
