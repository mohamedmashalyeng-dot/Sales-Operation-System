-- Phase 6: personal saved views for repeatable list filters.
-- Stores only validated filter configuration, never duplicated CRM records.

create table if not exists app_saved_views (
  id text primary key,
  user_id text not null,
  entity_type text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create index if not exists app_saved_views_user_entity_idx
  on app_saved_views(user_id, entity_type, updated_at desc);
