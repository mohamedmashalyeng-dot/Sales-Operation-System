-- Phase 4 Automation Engine foundation.
-- Apply after the core CRM tables exist. This migration is additive only.

create table if not exists app_automation_rules (
  id text primary key,
  name text not null,
  description text not null default '',
  status text not null default 'draft',
  enabled boolean not null default false,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  condition_mode text not null default 'all',
  actions jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

create table if not exists app_automation_events (
  id text primary key,
  trigger_type text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  origin_run_id text,
  causation_id text,
  depth integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

create table if not exists app_automation_jobs (
  id text primary key,
  rule_id text not null references app_automation_rules(id),
  event_id text references app_automation_events(id),
  trigger_type text not null,
  entity_type text not null,
  entity_id text not null,
  status text not null default 'pending',
  run_after timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  error_code text,
  safe_error_message text,
  origin_run_id text,
  depth integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rule_id, event_id)
);

create table if not exists app_automation_runs (
  id text primary key,
  rule_id text not null references app_automation_rules(id),
  job_id text references app_automation_jobs(id),
  event_id text references app_automation_events(id),
  entity_type text not null,
  entity_id text not null,
  trigger_type text not null,
  status text not null,
  idempotency_key text not null unique,
  action_results jsonb not null default '[]'::jsonb,
  error_code text,
  safe_error_message text,
  duration_ms numeric,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

create index if not exists app_automation_rules_enabled_trigger_idx on app_automation_rules(trigger_type, enabled, status);
create index if not exists app_automation_jobs_claim_idx on app_automation_jobs(status, run_after, created_at) where status in ('pending', 'retry_wait', 'running');
create index if not exists app_automation_jobs_rule_status_idx on app_automation_jobs(rule_id, status, created_at desc);
create index if not exists app_automation_events_trigger_time_idx on app_automation_events(trigger_type, created_at desc);
create index if not exists app_automation_runs_rule_time_idx on app_automation_runs(rule_id, started_at desc);
