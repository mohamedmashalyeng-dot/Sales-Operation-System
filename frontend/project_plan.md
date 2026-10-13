# Kent Business College Workspace

## 1. Project Description

**Product:** Kent Business College Workspace — an internal enterprise web application (CRM + Admissions + Sales + Operations) used daily by college employees.

**Target users:** Admissions officers, sales representatives, marketing staff, operations managers, administrators, developers/integration managers.

**Core value:** Give the team one operational workspace to manage admissions, prospective students, business leads, emails (response tracking), applications, events, appointments, phone calls and team productivity — faster and clearer than the tools it replaces.

**Note on status:** This build is a **100% frontend-only interactive prototype**. All records shown are clearly labelled fictional demonstration data persisted in `localStorage`. There is **no backend, no Supabase, no database, no authentication service and no API integration** — and none is required. Live Gmail, Zoom, Zoho CRM and Eventbrite connections are **not** active. A **Reset Demo Data** control in Settings restores the seed dataset.

**Demo roles (simulated, frontend-only):** Staff Sales, Staff Enrolment, Manager and Admin. A role switcher in the top bar and in Settings changes navigation, dashboard metrics, record visibility, available actions, filters, reports and management capabilities immediately. Permissions are **simulated only and are not real security**.

## 2. Page Structure

- `/` — Today (Command Centre)
- `/admin` — Admin Dashboard
- `/leads` — Leads (CRM list)
- `/leads/:id` — Lead detail
- `/planner` — Planner (tasks / calendar)
- `/inbox` — Inbox (email response tracking)
- `/inbox/:id` — Email detail
- `/applications` — Applications (admissions pipeline)
- `/applications/:id` — Application detail
- `/events` — Events (registration & attendance)
- `/events/:id` — Event detail
- `/zoom` — Zoom (meetings & calls)
- `/zoho` — Zoho CRM
- `/sources` — Sources & Attribution (reporting)
- `/apprenticeship-reports` — Apprenticeship Reports (funding eligibility, intake, commercial)
- `/future-intake` — Future Intake Pipeline (board / table / cohort calendar)
- `/commercial` — Commercial Opportunities (pipeline)
- `/employers` — Employers (agreement + Apprenticeship Service tracking)
- `/employers/:id` — Employer detail
- `/developer` — Developer / diagnostics
- `/settings` — Settings
- `/audit` — Audit Trail

## 3. Core Features

- [x] App shell: collapsible sidebar, breadcrumb topbar, global search, notifications, integration status, profile, quick actions, **demo role switcher**
- [x] Today command centre: KPI summary, Needs Your Attention queue, Priority Leads, My Work Today, Recent Activity, Team Overview (Manager/Admin), filters — **all values derived live from the shared store and scoped to the active demo role**
- [x] Roles & permissions: central action-level capability config, role switcher, visibility scoping, `PermissionGate` on pages/actions/bulk ops/direct navigation
- [x] Leads: list/detail, create & edit, assignment, priority, contact/email history, tasks, related applications, activity timeline, Zoho sync indicators
- [x] Inbox: response-tracking statuses (Unanswered / Unread / Seen no reply / Overdue / Resolved / Sent / All / Trash), SLA & overdue durations, labels, assignment, bulk actions, email detail + composer
- [x] Planner: multi-source tasks, list/calendar views, overdue/today/upcoming/completed, create/edit/assign/reschedule/complete
- [x] Applications: overview, list, detail, programme/intake, documents, status history, follow-up tasks, stage changes
- [x] Events: dashboard metrics, events list + date filters, event detail, registrations, attendance, callbacks, reports, marketing, import/sync (CSV, Eventbrite, Zoom) simulations
- [x] Zoom: overview, meetings, calls, phone numbers, follow-ups
- [x] Zoho CRM: synced contacts/leads, sync health, mapping, errors & retry
- [x] Lead Sources & Multi-Touch Attribution: acquisition source / channel / platform / campaign / UTM, Journey & Attribution tab (First, Second, Subsequent, Latest, Closing touches), closing workflow with frozen closing snapshot, Closed Won / Application / Enrolled kept as separate milestones
- [x] Sources & Attribution dashboard: leads by source & campaign, closed won by acquisition source & closing channel, first-touch vs closing-touch, conversion rates, avg time to close, avg touches, programme & owner performance, event/webinar contribution, sortable source table, filters + drill-downs
- [x] Admin dashboard: users & roles, team & workload distribution, sales/enrolment performance, lead ownership, workflow monitoring, simulated integration health, system alerts, permission matrix
- [x] Developer diagnostics: demo dataset overview, store statistics, localStorage persistence status, data consistency & relationship checks, orphaned record warnings, simulated integration statuses, reset utilities
- [x] Audit Trail: searchable/filterable record changes with timestamp, actor, role, entity, action and before/after values
- [x] Settings: profile, role, notifications, display (density / landing / badges), demo data, reset, integrations, admin users & permission overview — **preferences apply workspace-wide and persist**
- [x] Global interactions: search, filter, sort, tabs, modals, drawers, forms, validation, pagination, bulk select, toasts, loading/empty/error states, confirmations
- [x] Apprenticeship eligibility: initial screening checklist (residency, immigration, other funding, employment type, weekly hours, employer in England, 50% hours in England) with answer / evidence-status / notes / checked-by, a configurable screening status kept **separate** from a verified funding decision, and an Enrolment/Admin-only verified decision with reasons
- [x] Future Intake: deferral workflow capturing programme, intake, preferred start month, reason, learner/employer readiness, owners and follow-ups; board / table / cohort-calendar views; overdue follow-ups surface in Today; deferral is never treated as lost
- [x] Commercial pathway: referral for commercial review with option type (course vs privately funded apprenticeship), funding interest, budget and quote status; separate pipeline stages and reporting from funded starts
- [x] Employer onboarding: Kent Business College employer agreement tracking (status, dates, verified-by, follow-up) and Apprenticeship Service / DAS readiness checklist (UKPRN shared, provider addition requested/confirmed, funding actions reviewed)
- [x] Apprenticeship Reports: 15 live metrics + grouped reports by programme, intake, source, first/second/closing touch, sales owner, enrolment owner, employer, funding route, deferral reason and commercial conversion

## 4. Data Model Design

> Not persisted in this phase. Below is the intended schema for the future backend (Readdy Backend or SaaS Supabase).

| Table | Key fields |
|-------|-----------|
| users | id, name, email, role, team, avatar_url, status |
| leads | id, name, email, phone, programme, intake, source, owner_id, status, priority, created_at |
| lead_attribution | lead_id, channel, platform, campaign, campaign_id, utm_source/medium/campaign, acquisition_date, original_owner_id, closing_snapshot {outcome, closing_date, closing_owner_id, interaction_type, source, channel, campaign, loss_reason, touchpoint_id} |
| touchpoints | id, lead_id, timestamp, source, channel, interaction_type, outcome, owner_id, notes, is_closing, ref_type, ref_id |
| lead_activities | id, lead_id, type, summary, actor_id, created_at |
| threads (emails) | id, subject, sender, labels[], owner_id, read_state, response_state, received_at, deadline_at, resolved_at |
| messages | id, thread_id, direction, body, sent_at, author |
| tasks | id, title, description, owner_id, priority, due_at, source, related_type, related_id, status |
| applications | id, applicant_name, programme, intake, status, owner_id, submitted_at |
| application_documents | id, application_id, name, type, status, url |
| events | id, name, start_at, source, status, booked, confirmed, declined, pending |
| event_registrations | id, event_id, person_id, outcome, attended, callback_at |
| zoom_meetings | id, topic, host, account, start_at, join_url, related_event_id |
| calls | id, direction, status, duration, caller, receiver, lead_id, occurred_at |
| zoho_records | id, entity, zoho_id, owner_id, sync_state, last_synced_at, error |
| audit_events | id, actor_id, entity_type, entity_id, action, before, after, created_at |
| labels | id, name, colour, kind |
| lead_eligibility | lead_id, status (screening), responses[{question_id, answer, evidence, notes, weekly_hours, checked_by}], decision (verified), verification_date, decision_maker_id, decision_reasons |
| future_intakes | id, lead_id, current_programme, current_intake, preferred_intake, preferred_start_month, reason, learner_readiness, employer_readiness, sales_owner_id, enrolment_owner_id, last_contact_at, next_follow_up_at, notes, deferred_at |
| commercial_opportunities | id, lead_id, funding_eligibility_outcome, referral_reason, programme_interest, suggested_programme, option_type, funding_interest, budget_status, quote_status, commercial_owner_id, next_follow_up_at, notes, stage |
| employer_agreements | id, employer_name, employer_contact, status, date_sent, date_signed, verified_by, follow_up_due, notes, lead_id, application_id |
| das_records | id, employer_name, status, checklist flags, responsible_staff_id, last_updated_at, follow_up_at, notes, lead_id, application_id |

## 5. Backend / Third-party Integration Plan

- **Database:** Not connected — demonstration data for now. User chose to build the interactive prototype first. Can connect Readdy Backend or SaaS Supabase later.
- **Authentication:** Not connected (prototype shows a fixed demonstration user).
- **Gmail:** Not connected — Inbox shows demonstration threads and documents the required sync contract.
- **Zoho CRM:** Not connected — sync indicators are UI placeholders only.
- **Zoom:** Not connected — meetings/calls are demonstration records.
- **Eventbrite:** Not connected — import/sync flows are UI placeholders.
- **Payments:** Not required for this internal workspace.

## 6. Development Phase Plan

> **Progress:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ (Attribution, Admin, Developer, Audit Trail, Settings) · Phase 5 ✅ (Apprenticeship eligibility, future intake, commercial pathway, employer onboarding) · Phase 6 pending (QA, accessibility, integration handoff).

### Phase 1: Design System, App Shell, Today
- Goal: Shared visual language, working navigation shell, and the operational command centre.
- Deliverable: Design tokens, base component library, sidebar + topbar navigation, Today dashboard with KPI summary, attention queue, priority leads, my work today, recent activity and filters.

### Phase 2: Leads, Inbox, Planner
- Goal: The core daily CRM and communication workflows.
- Deliverable: Leads list + detail + create/edit; Inbox response-tracking queue + email detail + composer; Planner tasks + calendar views.

### Phase 3: Applications, Events, Zoom, Zoho CRM
- Goal: Admissions pipeline, events, meetings/calls and the CRM integration workspace.
- Deliverable: Applications list + detail; Events dashboard + list + detail; Zoom meetings/calls/numbers; Zoho sync workspace.

### Phase 4: Attribution, Admin, Developer, Audit Trail, Settings
- Goal: Trustworthy demonstration reporting of where leads come from and where they close, plus governance and diagnostics.
- Deliverable: Lead Sources & multi-touch attribution (acquisition fields, Journey & Attribution tab, closing workflow with stable closing snapshot), Sources & Attribution dashboard; Admin dashboard; Developer diagnostics; Audit Trail; workspace-wide Settings preferences (density, landing, badges). Expanded fictional dataset covering open / won / lost leads, single and multi-touch journeys, event- and paid-campaign-originated leads and incomplete-attribution leads.

### Phase 5: Apprenticeship Eligibility, Future Intake, Commercial Pathways & Employer Onboarding
- Goal: A complete UK apprenticeship recruitment/enrolment workflow that retains every viable lead and keeps funding eligibility, learner readiness, sales conversion, enrolment and confirmed starts as separate dimensions.
- Deliverable: Eligibility screening + verified decision (role-restricted), Future Intake pipeline with deferral workflow and follow-ups, Commercial Opportunities pathway, Employer agreement + DAS onboarding tracking, Apprenticeship Reports; schema **v2** migration that adds the new collections and backfills baseline records without overwriting user data.

### Phase 6: QA, Accessibility & Integration Handoff
- Goal: Responsive QA, accessibility pass, performance and documented API integration spec per screen.
- Deliverable: Responsive fixes, keyboard/focus/contrast pass, loading/empty/error coverage, integration handoff notes.