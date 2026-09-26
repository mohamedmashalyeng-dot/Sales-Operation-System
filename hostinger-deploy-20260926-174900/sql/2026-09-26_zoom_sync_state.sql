-- Zoom sync safety foundation.
-- Additive only. Do not wrap CONCURRENTLY statements in an explicit transaction.

create table if not exists zoom_sync_state (
  id bigserial primary key,
  zoom_account_id text not null,
  zoom_user_id text not null,
  initial_backfill_completed boolean not null default false,
  last_backfill_month text,
  last_successful_sync_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  status text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (zoom_account_id, zoom_user_id)
);

create index concurrently if not exists zoom_sync_state_status_idx
  on zoom_sync_state (status, last_attempt_at desc nulls last);

create index concurrently if not exists app_events_zoom_account_uuid_idx
  on app_events ((data->>'zoom_account_id'), (data->>'zoom_meeting_uuid'));

create index concurrently if not exists app_events_zoom_account_meeting_idx
  on app_events ((data->>'zoom_account_id'), (data->>'zoom_meeting_id'));

create index concurrently if not exists app_events_zoom_host_start_idx
  on app_events ((data->>'zoom_host_id'), start_at desc nulls last);
