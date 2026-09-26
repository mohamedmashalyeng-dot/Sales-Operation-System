-- Kent Business College CRM scalability foundation
-- Safe to run manually against PostgreSQL/Neon. All changes are additive.
-- Note: CREATE INDEX CONCURRENTLY must be run outside an explicit transaction.

create table if not exists integration_sync_state (
  id bigserial primary key,
  provider text not null,
  account_id text not null default 'default',
  cursor_token text,
  history_id text,
  last_successful_sync_at timestamptz,
  last_attempt_at timestamptz,
  status text not null default 'idle',
  last_error text,
  locked_until timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_id)
);

alter table app_sessions add column if not exists token_hash text;
alter table app_sessions add column if not exists last_used_at timestamptz;
alter table app_sessions add column if not exists ip_address text;
alter table app_sessions add column if not exists user_agent text;

create index concurrently if not exists app_leads_created_id_idx on app_leads (created_at desc nulls last, id);
create index concurrently if not exists app_leads_stage_idx on app_leads (stage);
create index concurrently if not exists app_leads_owner_id_idx on app_leads (owner_id);
create index concurrently if not exists app_leads_programme_id_idx on app_leads (programme_id);
create index concurrently if not exists app_leads_email_lower_idx on app_leads (lower(email));

create index concurrently if not exists app_tasks_status_due_idx on app_tasks (status, due_at nulls last, id);
create index concurrently if not exists app_tasks_owner_status_due_idx on app_tasks (owner_id, status, due_at nulls last);
create index concurrently if not exists app_tasks_lead_id_idx on app_tasks (lead_id);

create index concurrently if not exists app_emails_received_id_idx on app_emails (received_at desc nulls last, id);
create index concurrently if not exists app_emails_lead_received_idx on app_emails (lead_id, received_at desc nulls last);
create index concurrently if not exists app_emails_due_response_idx on app_emails (response_at, due_at nulls last);
create index concurrently if not exists app_emails_thread_idx on app_emails ((data->>'gmail_thread_id'));
create index concurrently if not exists app_emails_from_lower_idx on app_emails (lower(coalesce(email, data->>'from', data->>'email', '')));
create index concurrently if not exists app_emails_labels_gin_idx on app_emails using gin ((coalesce(data->'gmail_labels', '[]'::jsonb)));
create index concurrently if not exists app_emails_label_names_gin_idx on app_emails using gin ((coalesce(data->'gmail_label_names', '[]'::jsonb)));

create index concurrently if not exists app_applications_created_id_idx on app_applications (created_at desc nulls last, id);
create index concurrently if not exists app_applications_status_idx on app_applications (status);
create index concurrently if not exists app_applications_lead_id_idx on app_applications (lead_id);

create index concurrently if not exists app_events_start_id_idx on app_events (start_at desc nulls last, id);
create index concurrently if not exists app_events_zoom_meeting_id_idx on app_events ((data->>'zoom_meeting_id'));
create index concurrently if not exists app_events_zoom_meeting_uuid_idx on app_events ((data->>'zoom_meeting_uuid'));

create index concurrently if not exists app_audit_occurred_id_idx on app_audit (occurred_at desc nulls last, id);
create index concurrently if not exists app_audit_entity_idx on app_audit (entity, entity_id);

create index concurrently if not exists app_sessions_token_hash_idx on app_sessions (token_hash);
create index concurrently if not exists app_sessions_last_used_idx on app_sessions (last_used_at);
create index concurrently if not exists integration_sync_state_status_idx on integration_sync_state (provider, status, locked_until);
