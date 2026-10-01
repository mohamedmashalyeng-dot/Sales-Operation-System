create table if not exists app_monitoring_snapshot (
  id text primary key,
  today_start timestamptz not null,
  tomorrow_start timestamptz not null,
  data jsonb not null,
  generated_at timestamptz not null,
  refreshed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_refresh_attempt_at timestamptz,
  last_refresh_error text,
  last_successful_refresh_at timestamptz,
  refresh_lock_until timestamptz
);

alter table app_monitoring_snapshot
  add column if not exists last_refresh_attempt_at timestamptz;

alter table app_monitoring_snapshot
  add column if not exists last_refresh_error text;

alter table app_monitoring_snapshot
  add column if not exists last_successful_refresh_at timestamptz;

alter table app_monitoring_snapshot
  add column if not exists refresh_lock_until timestamptz;

create index if not exists app_monitoring_snapshot_expires_idx
  on app_monitoring_snapshot(expires_at);
