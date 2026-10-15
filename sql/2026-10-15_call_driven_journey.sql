-- Additive migration; existing Calls, Tasks, Planner and Notifications remain the source of truth.
create table if not exists app_call_results (
  event_id text primary key,
  evaluation_id text not null unique,
  call_id text not null,
  lead_id text not null,
  assignee_id text not null,
  review_status text not null default 'pending' check (review_status in ('pending','completed','dismissed')),
  received_at timestamptz not null default now(),
  payload_hash text not null,
  data jsonb not null
);
create index if not exists app_call_results_assignee_pending_idx on app_call_results(assignee_id, review_status, received_at, event_id);
create index if not exists app_call_results_lead_received_idx on app_call_results(lead_id, received_at desc, event_id);
create index if not exists app_call_results_call_received_idx on app_call_results(call_id, received_at desc, event_id);
create table if not exists app_lead_stage_history (
  id text primary key,
  lead_id text not null,
  from_stage text,
  to_stage text not null,
  source text not null,
  call_id text,
  reason text,
  suggested_by text,
  approved_by text,
  created_at timestamptz not null default now()
);
create index if not exists app_lead_stage_history_lead_idx on app_lead_stage_history(lead_id, created_at desc, id);
create or replace function kbc_record_lead_stage() returns trigger language plpgsql as $$
declare context jsonb;
begin
  if TG_OP = 'UPDATE' and OLD.stage is not distinct from NEW.stage then return NEW; end if;
  if NEW.stage is null then return NEW; end if;
  context := coalesce(nullif(current_setting('kbc.stage_context', true), ''), '{}')::jsonb;
  insert into app_lead_stage_history(id, lead_id, from_stage, to_stage, source, call_id, reason, suggested_by, approved_by)
  values ('SH-' || md5(random()::text || clock_timestamp()::text), NEW.id,
    case when TG_OP = 'INSERT' then null else OLD.stage end, NEW.stage,
    coalesce(context->>'source', 'system_rule'), context->>'call_id',
    coalesce(context->>'reason', 'KBC record updated'), context->>'suggested_by', context->>'approved_by');
  return NEW;
end $$;
drop trigger if exists kbc_lead_stage_history on app_leads;
create trigger kbc_lead_stage_history after insert or update of stage on app_leads
  for each row execute function kbc_record_lead_stage();
