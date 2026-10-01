-- Lead de-duplication support (DATABASE_CLEANUP_STEP3.md).
-- Additive only: two nullable columns, two new tables, indexes. No existing row is changed.
-- NOT applied by the application. Apply manually in Step 4, after a Neon branch/snapshot:
--   psql "$DATABASE_URL" -f sql/2026-09-30_lead_dedupe.sql
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, so run this file without -1.

-- Soft delete: a merged duplicate keeps its row, points at its master and is hidden from lists.
alter table app_leads add column if not exists deleted_at timestamptz;
alter table app_leads add column if not exists merged_into_id text;

-- One row per merged duplicate: what moved, what was filled, what conflicted, and a full copy
-- of the duplicate as it was before the merge (enough to restore it by hand).
create table if not exists app_lead_merge_audit (
  id bigserial primary key,
  cleanup_run_id text,
  entity_type text not null default 'lead',
  master_id text not null,
  duplicate_id text not null,
  merge_reason text not null,
  confidence text not null,
  rule text,
  fields_merged jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  relationships_moved jsonb not null default '{}'::jsonb,
  external_ids jsonb not null default '[]'::jsonb,
  duplicate_snapshot jsonb not null,
  performed_by text not null,
  created_at timestamptz not null default now()
);
alter table app_lead_merge_audit add column if not exists cleanup_run_id text;
create index if not exists app_lead_merge_audit_cleanup_run_idx on app_lead_merge_audit (cleanup_run_id);
create index if not exists app_lead_merge_audit_master_idx on app_lead_merge_audit (master_id);
create index if not exists app_lead_merge_audit_duplicate_idx on app_lead_merge_audit (duplicate_id);

-- One row per bounded cleanup execution/report run. REPORT_ONLY and DRY_RUN rows may be
-- written by tooling only after backup targeting is reviewed; the cleanup itself never needs
-- this table for read-only reports.
create table if not exists app_database_cleanup_runs (
  cleanup_run_id text primary key,
  mode text not null,
  status text not null,
  backup_verified boolean not null default false,
  database_fingerprint jsonb not null default '{}'::jsonb,
  started_by text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

-- Every external identity of a person (Zoho Lead and Contact, Eventbrite registrations, Meta,
-- Apollo). An identifier belongs to exactly one lead.
create table if not exists app_lead_external_ids (
  lead_id text not null,
  provider text not null,
  module text not null default '',
  external_id text not null,
  source text,
  created_at timestamptz not null default now(),
  primary key (provider, module, external_id)
);
create index if not exists app_lead_external_ids_lead_idx on app_lead_external_ids (lead_id);

-- Lists and counts filter on deleted_at is null.
create index concurrently if not exists app_leads_merged_into_idx on app_leads (merged_into_id) where merged_into_id is not null;
-- Duplicate detection by normalized email (the existing index is on lower(email) only).
create index concurrently if not exists app_leads_email_norm_idx on app_leads (lower(trim(email)));
