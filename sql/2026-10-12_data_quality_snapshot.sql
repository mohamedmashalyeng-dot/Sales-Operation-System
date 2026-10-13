-- Phase 7: Data Quality Centre snapshot cache.
-- Stores aggregate detection metrics only. It does not delete, merge, reassign,
-- relink, or overwrite CRM records.

create table if not exists app_data_quality_snapshot (
  id text primary key,
  generated_at timestamptz not null default now(),
  status text not null default 'ready',
  stale_days int not null default 90,
  metrics jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb
);
