# Call-driven lead journey and post-call Planner

## Existing-system audit and ownership

KBC already stores Zoom Phone calls in `app_workspace.meta.zoom.calls` (local storage: `db.zoom.calls`) and Zoom meetings in `app_events`. Calls retain their KBC IDs and stable Zoom identifiers. Existing `lead_id` relationships are reused; this integration never matches a person by their name, email or phone.

Leads remain in `app_leads`. Existing Tasks (`app_tasks`), Planner/My Day, applications, `app_notifications`, record authorization and `app_audit` remain the sources of business state. No second Calls, Tasks, Planner or notification framework was introduced. The existing eligibility AI is separate and is not called by this feature.

The external service owns call processing, transcription, analysis, evaluation and recommendations. It receives no direct KBC database access. KBC stores its final result immutably, validates the proposed actions and applies only employee-approved changes.

## Stage model and precedence

Existing stages are preserved. Sales-stage concepts missing from the original admissions-oriented catalog are controlled labels, not replacements for admissions statuses.

| External concept | KBC stage / authoritative indicator |
| --- | --- |
| new | New lead |
| attempted_contact / no_answer | Call outcome/attempt evidence; no primary journey stage update |
| contacted | Contacted |
| qualified | Qualified |
| interested | Interested |
| callback_required | Separate call outcome and dated next action; never a primary journey step |
| follow_up | Separate Follow-up Required disposition; legacy values remain readable |
| application_started | Existing Qualified stage plus an actual application-created indicator |
| application_submitted | Application Submitted |
| documents_pending / documents_received | Existing Eligibility stage; actual document verification is a separate business fact |
| offer_sent | Offer Sent, with authoritative evidence or explicit authorised confirmation |
| signed | Signed, backed by a KBC signed/verified contract/agreement or explicit authorised confirmation |
| enrolled | Existing Enrolled stage, backed by KBC enrolment or explicit authorised confirmation |
| not_interested | Not Interested |
| lost | Existing Lost stage |

Existing Eligibility, Ready for Enrolment and Not Eligible remain available. A submitted application, verified documents, signature or enrolment is never inferred solely from a transcript.

For regression protection, Application Submitted (50), Eligibility (60), Ready for Enrolment (70), Offer Sent (75), Signed (80), Not Eligible (90) and Enrolled (100) take precedence over ordinary sales-stage suggestions. A post-call approval cannot move backwards from these states or regress a recorded sales journey step. Staff can keep the stage while approving tasks. A separate manual override requires a reason; regressing a business stage also requires team permission and explicit confirmation.

Webhooks never change the lead stage. Human approval is always required, including for ordinary sales-stage suggestions. A review opened against an outdated stage returns HTTP 409 and must be reloaded. Existing manual updates and application transitions record their source. PostgreSQL triggers capture all persisted stage changes, including other existing writers; JSON/Mongo saves maintain an append-only stage journal. Existing audit history is retained. The first observed local stage is marked as a baseline, not fabricated historical evidence.

## External payload contract

`POST /api/integrations/call-evaluation/webhook`

Configure `CALL_EVALUATION_WEBHOOK_SECRET` server-side with at least 32 random characters. The checked-in example contains no secret. Do not expose this value to frontend code.

Required headers:

```text
Content-Type: application/json
X-KBC-Timestamp: <current Unix timestamp in seconds>
X-KBC-Signature: v1=<lowercase hex HMAC-SHA256(secret, timestamp + '.' + exact raw request bytes)>
```

Signature comparison uses a constant-time comparison. Requests older/newer than five minutes, missing credentials, tampered bytes and payloads over 256 KiB are refused. JSON is signed as transmitted, including whitespace and UTF-8 bytes. Retries must use a fresh timestamp/signature and the same event/evaluation IDs and result payload.

```json
{
  "event_id": "call-result-event-001",
  "external_call_id": "existing-zoom-call-id",
  "evaluation_id": "external-evaluation-001",
  "status": "completed",
  "summary": "Ahmed is interested and requests a callback Tuesday.",
  "total_score": 84,
  "lead_signals": {
    "answered": true,
    "interested": true,
    "callback_required": true
  },
  "suggested_stage": "interested",
  "next_action": {
    "title": "Call Ahmed Tuesday",
    "due_at": "2026-10-20T09:00:00Z"
  },
  "suggested_tasks": [
    {
      "action_id": "callback",
      "title": "Call Ahmed Tuesday",
      "description": "Discuss programme options.",
      "due_at": "2026-10-20T09:00:00Z",
      "priority": "P2"
    }
  ],
  "recommendations": ["Confirm employer details."],
  "evaluation_criteria": [
    { "name": "Discovery", "score": 8, "max_score": 10, "feedback": "Relevant questions were asked." }
  ]
}
```

Strict validation rejects unknown keys, transcript bodies, arbitrary lead IDs, strings used as booleans, conflicting interest signals, duplicate action IDs and invalid scores/dates. `event_id`, `evaluation_id`, `status` and at least one stable call identifier are required. Optional `meeting_uuid` is supported; if both identifiers are supplied they must identify the same existing record. A meeting with multiple linked leads is ambiguous and is refused. Missing/unverified/ambiguous links return 409 without consuming the event, allowing the relationship to be corrected before retrying.

`status` is `completed` or `failed`. Scores are 0–100 or omitted/null; criterion scores require a positive maximum. Only supplied boolean signals are retained. Supported signals: contact_attempted, contacted (normalized to connected), answered, connected, interested, callback_required, not_interested, documents_requested, information_requested, application_discussed. Scores and criteria are not fabricated for no-answer calls. Explicitly supplied external scores are retained as external results, without running any local evaluation.

Up to 20 suggested tasks and 20 recommendations are accepted. Action IDs are stable and cannot start with `__`, which is reserved for KBC's callback suggestion. Exact times must be ISO timestamps with a timezone. Relative language such as “next week” must use `due_at: null`; the employee chooses the date/time. Optional `completed_at` is an exact call-completion timestamp. KBC's existing call timestamp takes precedence when identifying the latest call.

## Idempotency, persistence and transactions

`app_call_results` stores one immutable received result per unique event and evaluation, with its pending/completed/dismissed review. Duplicate delivery returns 200 without new notifications, reviews, histories or tasks. Reusing an identifier with different content returns 409. New results return 202.

Approving a pending review locks the review and lead in one PostgreSQL transaction. It validates record ownership, the current stage, business-stage rules, selected action IDs, assignees and dates, then writes the stage, existing Tasks, next action, history/audit entries, review receipt and notification read state. Approval retries return the saved receipt. Dismissal rejects the suggestions without deleting the call result. Failed writes roll back. Local JSON uses a serialized copy-and-save transaction; PostgreSQL is the production choice for coordination with all concurrent existing writers.

Task IDs and source keys are deterministic tuples of evaluation ID, KBC call ID and suggested action ID. Editing a task title/date before approval does not change its identity. Task data retains `source=call_analysis`, `source_event_id`, `evaluation_id`, `action_id`, `source_key`, `lead_id` and `call_id`. Existing Task completion/reopening writes are reused, so completion remains in the normal audit timeline.

Migration: `sql/2026-10-15_call_driven_journey.sql`. Normal schema setup includes it; the feature also ensures its tables on first use. Deployments that manage schemas separately should apply the migration before enabling this integration. No production migration, commit, push or deployment is performed by implementing these files.

## Staff flow and UI

The assigned lead owner sees pending reviews across sessions. Polling runs only in a visible, focused KBC tab. On the matching active lead, a review can surface when another dialog/editor is not active. Elsewhere, a nonintrusive pending-review banner is shown. Closing leaves it pending; Dismiss persists rejection. Reassignment follows current lead ownership and revokes the previous owner's review access.

The existing notification drawer loads `app_notifications`; “Call analysis ready for …” links to the correct Post Call Review. Employees edit the stage, task selections/titles/assignees, next action and exact follow-up times before **Save & Add to Planner**. Protected stages default to Keep current stage and need business evidence or explicit authorised confirmation. Completed reviews show the saved decision and approved action snapshots.

Lead 360 shows the actual KBC stage, latest linked Zoom call/outcome, supplied score, next action/date, owner and open/completed task counts. The Journey tab loads bounded call results, stage history, existing Tasks and existing audit activity. Older stage/call pages are available. Call Detail loads the actual existing call by ID and displays external summaries, scores, criteria, recommendations and post-call actions. It neither processes audio nor generates transcripts.

Existing Planner / My Day consume `app_tasks`; there is no new planner. Planner refreshes its existing paginated task feed so approved tasks appear in Today, Upcoming, Overdue and Completed with the existing filters. Call-source relationships survive API mapping. The Leads list is unchanged at the query level: it receives stage/summary fields, never all call results, transcripts, tasks or stage history. Lead 360 loads summary counts separately; full history is lazy and bounded.

## API and permissions

- `GET /api/call-reviews`: bounded pending reviews for the current lead owner.
- `GET /api/call-reviews/:event_id`: authorised review and current business facts.
- `POST /api/call-reviews/:event_id/decision`: approve/dismiss, with expected stage and editable selected tasks.
- `GET /api/leads/:id/call-journey?summary=1`: compact summary and task counts.
- `GET /api/leads/:id/call-journey`: bounded results, facts, stage history and normal audit timeline. `calls_before` is a cursor; `history_offset` pages stages.
- `POST /api/leads/:id/journey-stage`: controlled manual stage change with expected stage, reason and explicit business confirmation when required.
- `GET /api/zoom/calls/:id`: existing call and bounded final results, checked against the linked lead.
- Existing Task completion endpoint remains; `/api/tasks/:id/reopen` persists reopening.

Members act on owned leads/reviews and cannot assign another user's tasks. Team staff can review accessible team records; protected manual confirmations require team permission. Incoming results do not choose KBC users, create leads, change assignment or overwrite authoritative stages. An unavailable external service does not block ordinary KBC leads, tasks or Planner; analysis UI reports pending/unavailable.

## Verification

`npm run test:call-journey` exercises interested callback, no answer, Signed intent, authoritative facts, regression prevention, concurrent duplicate delivery/approval, task identity, immutable multi-call history, delayed old results, stale approvals, reassignment, cross-owner denial, dismissal, rollback, relative dates, strict schema and exact UTF-8 HMAC verification using isolated adapters.

`npm run test:authorization` includes actual HTTP checks for the signed public webhook, invalid signatures, tampered UTF-8 payloads and stale timestamps, alongside existing record authorization checks. Browser regression covers staff review, editing, Planner visibility and existing lead/employer/commercial workflows. Type checking, frontend/backend builds and existing admissions, lead-pagination and My Day checks remain applicable.

Tests never call the external analysis service or use production credentials. A live external delivery and a disposable PostgreSQL migration/transaction smoke test remain environment-specific integration checks; isolated tests do not constitute a live-provider or production-database test.


## Visual Lead Journey and Zoom-based Planner

Lead 360 now prominently renders a horizontal process timeline using the existing KBC theme. The seven presentation groups are New Lead, Contacted, Qualified, Interested, Application, Signed and Enrolled. No parallel stage taxonomy is persisted: Application groups Application Submitted, Eligibility, Ready for Enrolment and Offer Sent; Attempted Contact remains a legacy New Lead grouping. Callback Required and Follow-up are separate dispositions, while Lost/Not Interested/Not Eligible/Duplicate clearly close the journey. Legacy records remain intact. A legacy callback displays the last recorded primary journey stage, if available.

All nodes before the current stage are checked and their connecting lines are filled, including stages without individual transition records. The current node is highlighted; later unrecorded stages remain muted. Dates and transition details are displayed only when recorded. Reached dates come from the first recorded transition into each presentation group; later document/application substeps do not replace the original Application date. First-observed baseline timestamps are explicitly distinguished from unknown original reached dates. Clicking a reached/current node shows stage, reached date, actor, source, reason and a link to its related Zoom call. Narrow screens scroll the timeline without shrinking labels. The summary query returns at most the first and latest transition per persisted stage; full history remains paginated on the Journey tab. Lead rows retain compact stage/next-action/due-date cells, with no per-row history requests.

Post Call Review shows the proposed stage transition independently from call outcome and next action. For example, an interested customer requesting a callback proposes Interested, shows Callback Required as the outcome, and schedules only employee-approved actions with exact dates. Answered/No Answer are never allowed to regress a Qualified or Interested lead. Application/Signed/Enrolled still require authoritative records or explicit authorised confirmation.

Planner is now scoped to approved Zoom call tasks through the existing Tasks endpoint:

`GET /api/tasks?source=zoom_calls&status=all&limit=200`

The filter runs before pagination in both SQL and JSON/Mongo storage. A row needs source `call_analysis`, call ID, source event, evaluation ID, source key, and membership in a completed result's immutable approval receipt with matching call/lead/event/evaluation relationships. Merely labelling a task Zoom does not qualify. Returned rows carry `call_verified: true`. This prevents unrelated, demo, unapproved or locally fabricated rows appearing in Planner; existing records are preserved in storage. Planner refreshes this verified feed on entry and after an approved call review, with no global call/task preload. Its counters, tabs, calendar and activity use only that feed. Each task links to the real call, recorded review and lead. Completion and reopening use the existing persisted task endpoints; the legacy local-only create/edit/delete flow is no longer offered inside Planner. Call-log callback actions lead to the real call's result review, rather than generating a local task with an invented tomorrow deadline.

Validation additions: 21 isolated workflow/security checks cover actual Tasks filtering before pagination, forged Zoom labels, missing approvals, stage/outcome separation, sales-stage regression protection, grouped timeline milestones and legacy baseline handling. The browser scenario verifies the seven steps, clickable transition details, separate Interested/Callback Required values, exclusion of unrelated Planner tasks, persisted task completion and final call results. Optional desktop/mobile screenshots also assert horizontal scrolling without page overflow. Live PostgreSQL and live external-provider delivery still require deployment-environment verification; they were not exercised against production data.


## Complete workflow verification and next-action persistence

`npm run test:call-journey:http` runs 31 checks against the actual Node server, HTTP router, authentication, strict signed webhook, existing Tasks/notification endpoints, stage journal and durable JSON storage in a disposable application copy. It verifies successful signed receipt, replay rejection, member permissions, review/approval, call-only task pagination, independent stage/outcome values, call start/completion timestamps, task completion/reopening, next-action advancement, final call results and survival of a real server restart. No production `.env`, database or provider credential is read. This complements the isolated policy tests and headless browser checks; it does not replace a live PostgreSQL/provider test.

A staff-confirmed next action records `next_action_source=call_analysis` and an optional `next_action_task_id`. Unrelated task deadlines cannot replace its confirmed date, and an explicit next action can persist without a selected task. Completing the linked task advances to the earliest remaining approved call action or clears the due action; reopening restores an available call action. PostgreSQL task mutations synchronize the linked lead in the same transaction; local JSON/Mongo recalculation applies the same rule. Frontend completion/reopening refreshes Lead 360 and Planner. Empty next-action dates remain empty throughout API mapping and the lead form: neither lead creation time nor the current time is substituted. The UI displays Not scheduled.

When the final result supplies only an explicit `next_action`, KBC presents that supplied action as a selectable task in Post Call Review. It retains an unknown due date until staff choose one. Existing suggested tasks are reused instead of duplicating the action. The activity timeline combines bounded existing audit entries with recorded Zoom call starts and ends; it never invents a completion time from an analysis-received timestamp.


## Workspace sections and Zoom meeting viewing

Campaigns, Sources & Attribution and Future Intake are no longer workspace modules. Navigation/search entries, module routes, lead attribution/intake panels, campaign invitation filters and the related dashboard/reporting controls were removed. Old module URLs redirect to Leads; stored lead/source/meeting/history records are retained. Lead Journey continues to show stages and call history. Lead closing retains outcome/date/owner/reason controls without attribution or campaign selection.

Zoom meetings are available at `/zoom/meetings` and an individual meeting at `/zoom/meetings/:id`. The Meetings tab requests a bounded server page on entry, with All/Upcoming/Past filters, topic/host/ID search and cursor pagination. It no longer depends on the initial workspace preload. Opening a meeting requests `GET /api/zoom/meetings/:id`; attendees load in pages of 50 via `offset`, using the existing Zoom records in `app_events`. The drawer shows recorded host/account/time/duration/status, attendees and their linked leads, plus an HTTPS Join Zoom meeting link when one is available. Missing times, durations and hosts are not substituted with fictional defaults. Raw provider payloads, private host start URLs and arbitrary attendee fields are not returned. Access follows the existing team-only meeting-list policy.

HTTP checks cover sign-in/team authorization, missing meetings, the safe detail projection and attendee pagination. Browser checks cover navigation from another module, meeting details, an actual join link, attendee rendering, direct meeting links, and the removed-module redirects.

## Enrolled learner applications

The Applications list now fetches authenticated server pages (50 records) with server-side filters, totals and search. Direct application links fetch the actual detail rather than relying on the startup sample. Source evidence is displayed, contact/owner fields come from the linked lead, and missing document evidence displays Pending. Document status is read-only in this view.

Gmail enrolment processing creates missing applications in the same persistence operation, including for leads already marked Enrolled. Existing interested-label aliases are retained; exact Enrolled, Enrolment confirmed and Enrollment confirmed labels are also recognised. These aliases remain business configuration, not independent proof of signed agreements. New imported applications retain the recorded Enrolled status without inventing a signed/verified contract, original enrolment date or external learner reference.

POST /api/applications/reconcile-enrolled is restricted to team users and creates missing records without deleting existing applications. PostgreSQL uses per-lead transactions and advisory locks; local reconciliation is serialised within the process. The optional background backfill reuses this reconciliation and no longer deletes applications of other stages. Explicit reconciliation runs even when automatic creation is disabled.

On 2026-10-15 the local JSON workspace had 1,506 active Enrolled leads and 1,503 applications. The local-only backfill created the 3 missing applications; a second dry-run reported 1,506 applications and zero missing. A timestamped database backup was retained. No remote CRM/database writes or deployments were performed. The standalone helper defaults to a dry-run: `python scripts/backfill-local-enrolled-applications.py`; use `--apply` for a backed-up local write while the local server is idle.

Zoho Contacts classification is pending the user's business-rule clarification. The 82,659 imported Contact summaries expose module status Contacts rather than an enrollment/contract status. They have not been bulk-classified as Enrolled. Existing Enrolled leads are handled regardless of their import source. Live Zoho enrolment/contract field mapping and live PostgreSQL integration were not verified in this change.

Validation: `npm run test:enrolled-applications`, 38 isolated actual HTTP checks including enrollment creation/idempotency/ownership/detail and missing proof, existing admissions audit, 193 authorization checks, frontend type-check and production build. Browser coverage includes Applications entry after another module, second-page loading, source rendering and direct detail links with Pending documents.

## Planner cursor load failure (2026-10-15)

The local listener on port 3000 was still running an earlier backend snapshot: the call-result webhook returned the generic sign-in response instead of reaching its signed webhook handler, while the newly built UI was calling the Zoom-only task route. A read-only PostgreSQL diagnosis also confirmed that `app_call_results` did not yet exist. The ordinary task cursor query succeeded, but the Zoom provenance query returned PostgreSQL 42P01.

Call-journey schema setup now uses a dedicated client, transaction and advisory lock. Concurrent requests share one initialization promise; separate processes serialize the migration. Failures roll back, release the client and allow the next request to retry. The configured PostgreSQL call-journey migration was applied successfully, then the old local server was restarted after verifying that its served JavaScript matched this workspace build. Current health is 200 and the webhook reaches its expected unconfigured-handler response. Background job settings were preserved.

The exact reported cursor (`ZT-820085c014f7d840`, sort time 2026-09-30T11:51:38.200Z) now executes successfully against the configured PostgreSQL database with `status=all`, `source=zoom_calls`, and limit 200. Both first and next pages return no approved call tasks, as no call-result approval receipts exist yet. Zoho tasks are retained in storage and excluded by the existing Zoom provenance policy. No tasks were fabricated to fill the Planner.

Frontend request errors now show a concise message with HTTP status instead of a full API URL and opaque cursor; the request path remains available on the error object for debugging. Regression checks cover concurrent schema initialization, rollback/retry/client release, the existing 21 call-workflow checks and 38 actual HTTP checks. Type-check, production build, shell and bootstrap audits passed. `node scripts/diagnose-call-task-pagination.js` is a read-only diagnosis for the configured PostgreSQL database.

## Repeated message and published-version mismatch (2026-10-15)

A further check of `https://sales.kentbusinesscollege.com/planner` returned `/assets/index-Bfn2598N.js`, which still contains the old `Backend request failed:` message. The local workspace build is `/assets/index-CheXjMgB.js`; its served bytes were verified against the built file. The prior local server restart did not deploy changes to the published site. No site deployment was performed.

Zoom task responses now include `source: zoom_calls` and `call_provenance_version: 1`. The frontend validates this marker on every page before following its next cursor. A backend that ignores the source filter now produces an explicit workspace-update message, rather than silently downloading unrelated Zoho tasks until a cursor request fails. Existing general task loads retain their original behavior. Browser regression coverage supplies an older backend page with the reported Zoho cursor, verifies that this cursor is never followed, and retries successfully after the fixture switches to the updated response.

A runtime upload archive was prepared in `releases/kbc-workspace-call-tasks-20261015-133414.zip` (105 files, 3,429,103 bytes; SHA-256 `cf956520405e8fa7c711b707e233479539413ef035631e414307d062bba1f68b`). It contains server code, SQL migrations, the built frontend, public images, the retirement service worker and root package files. Environment files, workspace data and node_modules are excluded. Frontend and backend files must be updated together and the published Node application restarted. Publishing remains subject to the user's earlier no-deployment instruction.

API regression coverage is now 39 actual HTTP checks, plus 21 isolated call-workflow checks and schema concurrency/rollback checks. Frontend type-check, build, shell audit and bootstrap audit passed. The local listener was restarted to activate the matching frontend/backend version; health returns 200.

## Commercial and Employers: bounded loading and AI lead plans (2026-10-15)

`GET /api/business` now projects only business collections from workspace metadata. PostgreSQL returns up to 50 recent lead display records plus bounded linked records, rather than every CRM lead. Employer names and linked-lead counts are aggregated separately; the response includes up to 50 employer rows, full totals and metrics, with server-side search/agreement/DAS filters. Commercial requests omit the employer directory, and employer detail requests scope lead loading to the selected company. This preserves companies beyond the lead display sample without transferring all contact data. The Employers UI uses the returned total and pages, and search is debounced.

A read-only check against the configured PostgreSQL database measured 25,567 directory companies, a 50-company response of 22,526 bytes and 50 lead display records. The previous unpaged directory response was 4,687,071 bytes. Commercial returned 13,343 bytes. Candidate queues return 25 records per cursor page; measured reads were approximately one second per candidate page. Timings depend on database/network load. No CRM records were changed by this diagnosis.

Both module pages now include AI lead filtering and planning. Staff can review unclassified displayed leads, classify up to 25 at a time, and view matched contacts, supporting quotes and suggested next actions. Commercial contacts go to Commercial; employer contacts go to Employers; clear dual-purpose contacts can appear in both. Unknown/ambiguous contacts stay in Needs review. The classification does not treat a company field as an employer role, or an eligibility rejection/missing information as commercial interest. Employer directory company relationships and existing manually managed opportunities remain visible separately.

`GET /api/business/candidates` is authenticated and owner-scoped. `POST /api/business/classify` authorizes the whole selected batch before provider access. It sends bounded CRM notes and up to four inbound message excerpts per lead; provider instructions explicitly treat record content as untrusted data. Output uses the existing configured model and the Responses API strict JSON schema, following [official OpenAI structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Returned IDs must exactly match the batch. Unsupported quotes and confidence below 0.75 cause review. Response persistence rechecks ownership and deletion; provider/validation failure leaves existing plans untouched. Plans are stored on the lead as `business_plan`, with input hashes to reuse unchanged analysis, owner, supporting evidence and Suggested status. Follow-up dates are retained only from recorded next-action dates. Lead stages, human funding decisions and the approved-call-only Planner Tasks are not changed. No emails/messages are sent.

The current `.env` OpenAI key was tested without exposing it: OpenAI returned HTTP 401 with `invalid_api_key`. No real customer batch was sent for classification and no live AI plan was fabricated. A valid `OPENAI_API_KEY` and backend restart are required for live AI planning. Existing business records and the new paged lists remain usable while the provider is unavailable.

Validation: 16 business persistence/authorization/paging checks; 11 isolated AI routing/evidence/cache/failure checks; 45 actual isolated HTTP checks including candidate pagination, authentication and missing-provider handling; 193 authorization checks; frontend type-check and production build; shell and bootstrap audits. Browser checks cover reviewing candidates, saving and displaying a dual-destination plan, cross-module persistence, evidence/actions and preservation on provider failure. PostgreSQL list and classification-context queries were exercised read-only; real model output and PostgreSQL plan writes were not exercised with live customers. The local server was restarted; no deployment was performed.

## Result -> mapping -> analysis -> post-call popup -> Planner (2026-10-15)

The requested post-call popup now shows Call outcome, the externally supplied Rating, Summary, selectable Commitments and the Stage control, followed by Save & Add to Planner. It also identifies and links the mapped Lead and Call. A missing rating is displayed as Not supplied; no rating is invented from a numerical score. An audit note has a neutral default so an otherwise complete review can be approved directly, with the note and an optional next-action override available under advanced review details.

The signed call-result payload accepts optional `call_outcome`, `rating` and `commitments`. Commitments can be strings or objects containing title, optional action_id/description/due_at/priority. String commitments get deterministic IDs. Overlapping supplied tasks and commitments are merged before review; conflicting IDs/dates and unsupported fields are rejected. Relative dates remain unset. The canonical normalized shape of old payloads is retained when the new fields are absent, preserving old replay hashes. Existing results and scoring are not rewritten.

Example additional result fields, alongside the existing stable event/evaluation/call identifiers:

```json
{
  "status": "completed",
  "call_outcome": "Follow-up",
  "rating": "Good",
  "summary": "Send programme information and call back next week.",
  "lead_signals": { "answered": true, "interested": true },
  "commitments": [
    { "title": "Send programme information", "due_at": "2026-11-10T09:00:00Z" },
    "Call back next week"
  ]
}
```

The source sends the complete signed JSON payload to `POST /api/integrations/call-evaluation/webhook`. Mapping must resolve exactly one existing Call with an active linked Lead; ambiguous mappings never create a review against a guessed person. The result is saved before notification/review. New pending results are detected every 10 seconds while the workspace is visible and focused, and can open the popup from other modules when no dialog or active text edit would be interrupted. Existing pending reviews remain recoverable from the pending-review banner, linked Lead/Call and notifications. Closing a review leaves it pending; changing the active event remounts the review form to avoid stale selections.

Approval adds only checked commitments, with staff-confirmed exact dates and assignees, through the existing atomic and idempotent approval transaction. The primary Stage stays separate from call outcome, and business-stage restrictions remain in place. The default next action is selected from approved tasks. No hidden next action is copied into an otherwise unchecked commitment. Completed receipts remain viewable, and retries cannot duplicate Planner tasks.

Validation: 25 isolated call-workflow checks, 50 actual isolated HTTP checks, frontend type-check/build and shell/bootstrap audits passed. Browser coverage verifies a new result arriving while Commercial is open; automatic popup with Follow-up/Good and mapped Call; missing-date validation; unchecking the relative callback; saving without an extra note; and only the selected programme-information commitment appearing in Planner. Existing module and application browser checks also passed.

The local server was restarted with this code. Live delivery is not configured: `CALL_EVALUATION_WEBHOOK_SECRET` is currently absent/too short. The external analysis sender must be configured with the same secret and the established signed payload protocol before real results can arrive. No live incoming result was fabricated, no shared secret was printed or inserted, and no deployment was performed.

## Events list and direct details — 15 October 2026

Events now requests a bounded page directly when the module opens, including client navigation from Applications or Commercial. Search, source and date filters run on the backend before pagination and totals. Cursor navigation exposes records beyond the initial 50-event startup sample. Equal-date ordering now uses the same ID direction as the PostgreSQL cursor predicate. Loading, refresh and retry states distinguish failed requests from an empty result.

The list uses the existing server registration aggregates instead of presenting missing attendee arrays as zero bookings. Source linkage is retained in the summary projection, and missing status no longer defaults every event to live. Direct event links fetch the selected event and its registrations; detail loading waits for bootstrap so the startup sample cannot overwrite the selected record. Other event tabs retain their existing behavior and are explicitly described as showing the records loaded in the current session.

A read-only query against the configured PostgreSQL database found 92 events: 43 Eventbrite, 35 Zoom and 14 Manual. The real list returned 50 records and the next page 42, with no duplicate IDs; the first page was about 45 KB and took approximately 1.7 seconds. Source filters and combined search/date SQL executed successfully.

Validation: 57 actual isolated HTTP checks, 193 authorization checks, frontend type-check/build and shell/bootstrap audits passed. Browser coverage includes client navigation into Events, aggregate booking counts, next/previous pages, server search/source filtering, failed-request retry, opening a record outside the startup sample and refreshing its direct link. Existing browser workflows also passed. Local server restarted on port 3000; health and Events page returned 200, and unauthenticated Events API returned 401. No deployment performed.

## Zoom meetings access — 15 October 2026

Added a role-gated Zoom meetings shortcut to Events. Zoom tab navigation now changes the route to /zoom/meetings or /zoom/calls, so entering through the Meetings direct link no longer prevents switching to Calls. Other tabs use /zoom?view=... and keep their existing views.

Read-only checks against the configured database returned 35 Zoom meetings in approximately 0.8 seconds. A real meeting detail request succeeded, with its recorded attendee count and an available join link. The local /zoom/meetings page returned 200 and served the current build. Frontend type-check/build and shell audit passed. Browser checks passed for switching Meetings to Calls and back, the Events shortcut through client navigation, direct meeting links, attendees and the join link. No backend or provider synchronization changes were needed.

## People for every event — 15 October 2026

The People tab now browses the complete event dataset through the existing server search/source/date filters, in pages of 10 events. Each event has Show people / Hide people and Open event controls; the first event opens automatically. Its people are fetched separately, in pages of 50, with name, email, phone, recorded registration status, recorded attendance and an existing linked Lead. Registration alone never establishes attendance. Missing contact details remain unrecorded, and people without email remain separate rows. The view is directly accessible at /events?view=people and survives reload.

Added authenticated GET /api/events/:id/people with bounded limit/offset paging and a fixed response field allowlist. PostgreSQL slices the selected event's attendee array before returning it; provider payloads and tokens are omitted. Empty events, unavailable records, loading and recoverable request failures have separate states. The existing authenticated Events read policy is retained. Registration management remains accessible through Open event.

Read-only database checks found 2,488 attendee/registration records across 61 of 92 events; the remaining 31 have no recorded people. A populated event with 113 people returned 50 records on each of the first two pages, with a first-page response of approximately 9.5 KB. No customer records were changed.

Validation: 63 isolated actual HTTP checks, 193 authorization checks, frontend type-check/build and shell/bootstrap audits passed. Browser coverage verifies the People tab after startup summaries, 50-person pagination, separate rows without email, event-specific failure/retry, empty events, people for events outside the startup batch, and direct reload. Existing browser workflows passed. The verified local server was restarted for the new API; no deployment performed.

## Zoom Overview totals and previews — 15 October 2026

Zoom Overview now loads its header totals, four metric cards, next four meetings and five recent calls through an authenticated team-only GET /api/zoom/overview endpoint. Totals cover all stored records and are independent of startup samples, call filters and the page currently displayed. PostgreSQL performs aggregate counts and returns only bounded previews. Upcoming previews use ascending start time; recent calls use descending recorded start time. Meeting metadata omits attendees and raw provider fields, and call previews use the existing public call list mapper.

Meetings today uses the browser's explicit local midnight boundaries, including the exclusive start of the following day. Refresh and call sync refresh the overview. Loading/error states display unavailable values instead of zero; failures provide Retry overview. Merely entering Overview no longer also requests the Calls tab's filtered page.

Read-only verification for 15 October 2026 found 35 total Zoom meetings, 6 upcoming meetings, 0 meetings today, 250 logged calls and 49 missed/voicemail calls. The overview returned 4 next meetings and 5 recent calls in approximately 6.9 KB. No provider sync or data mutation was needed.

Validation: 69 actual isolated HTTP checks, 193 authorization checks, frontend type-check/build and shell/bootstrap audits passed. Tests verify full totals beyond previews, inclusive/exclusive local day boundaries, ascending meeting order, bounded recent calls, access control and omitted provider payloads. Browser tests verify client navigation into Overview without Zoom startup samples, all four metric values, populated previews, loading states, failure/retry and existing module workflows. The verified local server was restarted and serves the current build. No deployment performed.

### Published Zoom version check

A follow-up read-only check of https://sales.kentbusinesscollege.com/zoom confirmed that the published page still serves index-Bfn2598N.js, which contains no /api/zoom/overview request. The local server serves index-CbTciN3J.js and includes the new overview request, with no-cache page headers. This is a published/local version difference; refreshing the published page cannot supply code that has not been uploaded.

Prepared and validated releases/kbc-workspace-zoom-overview-20261015-152010.zip: 106 runtime files, 3,450,503 bytes, SHA-256 470aabab421652c133664f9850e19fd79a498038001c463412ce94c89e314c7f. It includes matching backend and built frontend changes and excludes environment files, workspace data and node_modules. The archive remains local; no upload or deployment occurred.

## Completed event attendance and Waiting — 15 October 2026

Added an Attendance column to the Events list. Completed events show recorded attendance counts; upcoming and ongoing events show Waiting. People cards and event detail rows use the same rule. Detail attendance cards and the new Waiting audience filter reflect the event's timing. Attendance editing is disabled while rows are Waiting; registration cancellation remains available.

Completion uses a valid end time first, or an end derived from a recorded duration. Future start times remain upcoming even with stale provider status, and past end times override stale live status. Legacy past records with no end use their recorded schedule/status; missing schedules remain waiting unless completion is explicitly recorded. Eventbrite's live publication status is not treated as an ongoing session by itself. Missing dates no longer become the current date during mapping.

Attendance remains based on explicit attendance values, check-in/attended timestamps or positive/negative recorded statuses. Registered/Confirmed and an event ending do not establish attendance or absence. Unknown attendance stays unrecorded after completion. Not attended is classified as absence instead of matching the attended substring. People without email remain separate audience rows. Waiting is derived for display; imported attendance is preserved.

PostgreSQL summary attendance now uses explicit evidence and recorded aggregate attendance, avoiding duplicate confirmed/attended counts and incorrect positive matches for negative statuses. End/duration fields are retained in summary projections.

Validation: 16 attendance rule checks passed, including a read-only PostgreSQL CTE fixture exercising the actual list SQL. Frontend type-check/build, 69 actual isolated HTTP checks and shell/bootstrap audits passed. Browser checks passed for completed totals, future Waiting, ongoing events before their end, positive status and check-in evidence, explicit absence, unknown attendance, the Waiting filter, disabled premature attendance editing and separate people without emails. Existing workflows also passed. The verified local server was restarted; the published site has not been updated.

## Check stages before the current stage — 15 October 2026

The Lead Journey timeline now checks every step before the current stage and fills the connecting lines through the current step. Existing recorded milestones remain visible. Earlier steps can be opened even without individual history; missing dates and transition details remain explicitly unrecorded. The current stage keeps its highlight, and later unrecorded stages remain pending. This changes presentation only.

Frontend type-check/build and the shell audit passed. The browser scenario verifies a jump to Interested with New Lead, Contacted and Qualified checked, three filled connectors, Application/Signed/Enrolled pending, and accurate missing-history details when Qualified is opened. The local server serves the updated build.

## Separate email cards in conversation details — 15 October 2026

Conversation details now show one bordered card per email, with its own subject, Sent/Received direction, recorded sender/recipient and timestamp including seconds. Different message IDs remain separate even when subject, content or send time matches. The message body is never substituted with another email's preview when missing. Quoted older messages remain attached to their source email in a separate expandable section, rather than being counted as new sent messages.

All recorded response notes in the loaded conversation are retained when no corresponding standalone outbound message exists. A legacy response note matching an actual outbound message's body and timestamp is not rendered again. Missing sender details/timestamps remain unrecorded, and real sender/recipient fields are retained by the existing detail response. Aborted navigation requests do not replace the newly opened email's messages/loading state. Delivery behavior and stored customer records are unchanged.

Validation: frontend type-check/build, 72 actual isolated HTTP checks, 193 authorization checks and the shell audit passed. The browser scenario verifies five distinct emails including multiple sent messages, identical sent content with separate IDs, correct chronological order and sender/recipient details, separate quoted history, no duplicate mirrored response and an explicitly missing body. Existing module checks also passed. The verified local server was restarted and serves the updated build; no publication performed.

## Today dashboard matching the supplied design — 15 October 2026

Replaced the Today widget layout with the requested greeting/date and Week/Month/Year controls, Sales Performance Overview with target ring and cumulative applications, five KPI cards with real daily bars, Programme/Intake/Owner/Source/Search filters, monthly grouped pipeline and a bounded Priority Leads table. The existing workspace shell remains in use. Mobile cards stack without page overflow. Both `/` and `/today` serve Today; existing role landing preferences remain respected.

The authenticated `/api/dashboard/today` endpoint aggregates the full authorized record population in PostgreSQL, with matching local JSON behavior. Today startup no longer fetches sampled lists to calculate dashboard totals. All dimensions and search run on the backend; member ownership is enforced regardless of the requested owner. Aggregates and previews use one database statement, avoiding join multiplication and exposing only the fields needed for display. Priority previews are limited to six actual high-priority/overdue active leads. Their links open the corresponding lead.

Browser-local calendar boundaries and IANA timezone determine the local day, calendar periods and monthly buckets, including Cairo DST. Comparisons use the same elapsed duration of the previous calendar period. Leads/applications use recorded creation dates. Active applications are a current snapshot across all dates. Follow-ups are open tasks with a persisted call-analysis approval receipt; unrelated/imported or unapproved tasks do not contribute. Enrolled/Won counts deduplicate learners and use recorded enrolment dates or genuine stage transitions; initial baseline observations never invent a historical win date. Undated outcomes are disclosed beneath the pipeline. SLA uses answered or expired inbound external emails, excluding pending emails still within 48 hours, outbound/internal mail, trash and invalid response order. No denominator displays a dash instead of a fabricated percentage.

Optional `TODAY_MONTHLY_APPLICATION_TARGET` configures a positive integer workspace target for the unfiltered team monthly view. Missing or inapplicable targets display Target not set; no screenshot sample target is stored. Requests are cancellable, search is debounced, focus/minute refresh keeps the date current, and loading/errors cannot masquerade as zero counts. Failed requests expose Retry.

Validation: 68 data checks passed, including actual PostgreSQL queries over isolated read-only CTE fixtures, local/PostgreSQL filter parity, ownership override attempts, local-midnight boundaries, malformed/undated enrolment dates, real stage transitions versus baseline history, duplicate learners, approved task provenance, SLA denominators, and configured/missing target scope. The production read-only aggregate matched an independent lead count and returned approximately 19 KB in 1.5–2.1 seconds for 129,315 stored leads. Five existing outcomes lacked a reliable date and were excluded from period figures. Frontend type-check/build, 77 isolated HTTP checks and the shell audit passed. Browser checks passed for real aggregate rendering, loading, programme/reset/date/chart filters, backend failure/retry and desktop/mobile overflow, alongside existing module workflows. Changes remain local.

## Human confirmation of Commercial / Employers routing — 15 October 2026

Reviewed the actual sources: the employer directory combines imported CRM lead employer fields with explicitly stored employers, agreements and DAS records; a company name alone proves neither the contact role nor a training need. Commercial opportunities are explicit persisted referrals. A read-only check returned 25,567 directory companies and zero commercial referrals. Neither count is a count of verified prospects.

Added Send to Commercial / Send to Employers buttons on lead overview and each business review card. The authenticated GET/POST lead business-route endpoint stores the human choice, actual reviewer ID/display name and server timestamp. Staff are restricted to owned leads; managers can route team leads. Repeated choices are idempotent. Switching destinations moves the lead between the confirmed queues while preserving business records. Changes and previous destinations are recorded in audit. SQL row locking and a fresh owner/deletion predicate prevent routing a lead whose ownership changed during the request.

Confirmed queues now require the persisted manual route. All AI-only plans, including high-confidence suggestions, remain in Needs review until a person chooses a destination. Later AI analysis can update only the suggested plan and cannot replace the manual route. Recorded source, AI suggestion and manual confirmation are displayed separately. Routing does not establish funding eligibility, purchase intent, completed onboarding or a planner task. It does not invent a commercial programme/referral or company record; detailed proposals and onboarding remain separate workflows. The legacy company directory remains available with an explicit source explanation rather than being presented as verified employer prospects.

Validation: 17 isolated AI/routing checks, 238 actual HTTP authorization checks and 16 business persistence checks passed. Browser checks verified AI suggestions awaiting review, routing to Commercial, changing to Employers and persistence across navigation, alongside existing workflows. Actual PostgreSQL routing SQL was exercised only against session-private temporary fixtures, including idempotence, queue exclusivity, audit rollback and a concurrent ownership change; no customer tables were accessed by that test. Read-only queries verified both real confirmed queues contain only manual routes (currently empty). Frontend type-check/build, syntax checks, shell audit and served-build verification passed. Local changes only; no publication and no real leads routed automatically.

## Business AI connection failure and retry — 15 October 2026

A direct provider probe using the configured local key and a synthetic input returned HTTP 401 with error code invalid_api_key. No CRM records, customer messages or stored plans were sent or changed by the probe. The key was neither printed nor replaced. Enabling actual AI analysis requires a valid replacement OPENAI_API_KEY in the local .env and a server restart; this cannot be repaired by reloading leads. Official guidance consulted: https://developers.openai.com/api/docs/guides/error-codes.

Business planning now distinguishes invalid credentials, archived projects, blocked server IPs, exhausted credits/spending limits, request throttling, model access, permission failures, invalid requests, outages, network failures and timeouts. Responses use fixed explanations instead of the raw provider error, avoiding leaked key fragments, project identifiers or input data. Failures preserve existing suggestions and human routes.

Separated lead-loading errors from AI-analysis errors in the business review UI. Retry AI analysis calls the classify endpoint again; Retry lead loading remains exclusive to list-loading failures. Saved plans and manual routing remain usable after provider errors. Classification is disabled while the displayed list is unavailable, and stale rows are hidden after list-loading failures.

Validation: 29 isolated business AI/routing checks passed, including safe error messages, preservation of saved plans and availability of manual routing for each provider failure. Browser checks verified that the AI retry calls classification, retains error feedback on another failure and clears it on provider recovery. Frontend type-check/build, syntax, shell audit and served-build verification passed. The local server was restarted; no publication performed. The real provider remains blocked by its rejected API key pending a valid replacement.
