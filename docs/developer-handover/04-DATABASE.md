# Database

## Actual Production Database Path

The active production path is PostgreSQL/Neon when `DATABASE_URL` starts with `postgres://` or `postgresql://`. This is implemented in `server/storage.js`.

Supported but non-primary modes:

- MongoDB when `DATABASE_URL` starts with `mongodb://` or `mongodb+srv://`.
- JSON file at `data/pathway-db.json` when `DATABASE_URL` is empty.

Do not dump production data for onboarding. Use schema, table names, counts and safe metadata only.

## Storage Bootstrap

On startup/first storage use, `Storage.ensureStorage()` connects to the configured storage. For PostgreSQL it creates core app tables unless `SKIP_SCHEMA_SETUP=true`.

`server/storage.js` creates the core `app_*` tables and indexes. Some later features are created by SQL migration files and feature modules.

## Important Tables

| Table | Purpose | Primary identifier | Main relationships / external IDs |
| --- | --- | --- | --- |
| `app_workspace` | Single workspace state row for global config and integration state | `id` (`main`) | Holds `gmail`, `eventbrite`, `meta` JSON. `meta` contains `zoom`, `zoho`, `apollo` state. |
| `app_users` | Login users and roles | `id`, unique `email` | Used by sessions, owners, permissions. |
| `app_sessions` | Server sessions | `id`, `token_hash` | `user_id` links to `app_users`; stores OAuth state fields. |
| `app_login_events` | Login audit trail | `id` | Optional user relation. |
| `app_password_resets` | Password reset tokens | `id`, unique `token_hash` | `user_id` links to `app_users`; token hashes only. |
| `app_programmes` | Programme catalog | `id` | Used by leads, intakes and applications. |
| `app_intakes` | Intake lookup | `id` | `programme_id`. |
| `app_leads` | CRM/admissions lead records | `id` | `owner_id`, `programme_id`; external IDs in `data` include Zoho/Eventbrite/Meta/Apollo fields. |
| `app_tasks` | Planner and follow-up tasks | `id` | `lead_id`, `owner_id`. |
| `app_emails` | Gmail/inbox records and response tracking | `id`, unique `gmail_message_id` | `lead_id`; Gmail thread/labels in `data`. |
| `app_applications` | Application/enrolment workflow | `id` | `lead_id`; requirements/evidence in JSON. |
| `app_events` | Events, Eventbrite and Zoom meeting-backed events | `id` | Attendees JSON links to leads; Eventbrite and Zoom IDs in data/top-level fields. |
| `app_audit` | Audit and activity history | `id` | `entity`, `entity_id`. |
| `app_attribution` | Attribution snapshots | `id` | `lead_id`, `email`, `programme`. |
| `app_document_templates` | Binary document templates | `key` | Stores PDF content in `bytea`. |
| `app_notifications` | User notifications | `id` | `user_id`, entity references. |
| `app_saved_views` | Per-user saved filters/views | `id` | `user_id`, `entity_type`. |
| `app_zoho_records` | Durable Zoho record cache | `key` (`module:zoho_id`) | `module`, `zoho_id`, `modified_time`; source record in `data`. |
| `integration_jobs` | Durable async integration jobs, currently important for Zoho | `id` | `provider`, `type`, `status`, cursor/state JSON, lease columns. |
| `app_monitoring_snapshot` | Cached monitoring snapshot | feature-defined | Created by monitoring module SQL. |
| `app_automation_*` | Automation rules/events/jobs/runs | varies | Created by `sql/2026-10-12_automation_engine.sql`. |
| `app_data_quality_snapshot` | Data quality summary cache | varies | Created by `sql/2026-10-12_data_quality_snapshot.sql`. |
| `app_marketing_*` | Marketing settings/campaigns/recipients/subscribers | varies | Created by `sql/marketing_tables.sql`. |

## Important Indexes

Core indexes created by code/migrations include:

- `app_leads(stage)`, `app_leads(owner_id)`, `app_leads(created_at)`.
- `idx_app_leads_cursor` on `(created_at desc, id desc)` for keyset lead pages.
- `app_leads_captured_at_idx` using dashboard captured-at function.
- `app_leads_email_lower_idx` and `app_leads_zoho_record_id_idx` for Zoho lead matching.
- Unique expression indexes for `data->>'zoho_record_id'` and `data->>'eventbrite_attendee_id'` from `2026-09-30_lead_identity_constraints.sql`.
- `app_tasks(status, due_at, id)`, `app_tasks(owner_id, status, due_at)`, task recent expression index.
- `app_emails(received_at)`, unread dashboard index, unanswered page index.
- `app_events(start_at desc nulls last, id desc)`.
- `app_zoho_records(module, modified_time desc nulls last, key)`.
- `integration_jobs(provider, type, status, updated_at desc)` and retry index.

## External IDs

- Gmail: `app_emails.gmail_message_id`, plus `data.gmail_thread_id`, labels and label names.
- Eventbrite: event records use `eventbrite_event_id`; attendees use `eventbrite_attendee_id`.
- Zoom: events store `zoom_meeting_id`, `zoom_meeting_uuid`; calls live under `app_workspace.meta.zoom.calls`.
- Zoho: durable records in `app_zoho_records`; leads store `data.zoho_record_id`.
- Meta/Apollo: lead external IDs are stored in JSON fields and indexed by some data quality migrations.

## Data Safety Rules

- Never delete local historical provider records because an incremental provider response omitted them.
- Avoid `Storage.loadDb()` for large list pages when a paginated SQL path exists.
- Do not write secrets into `app_workspace` except provider tokens already handled by OAuth code.
- Do not expose `password_hash`, session IDs, token hashes, access tokens or refresh tokens in API responses.
