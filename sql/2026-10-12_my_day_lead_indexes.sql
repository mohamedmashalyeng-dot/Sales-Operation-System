-- My Day targeted indexes.
-- These support the bounded "what should I do next?" lead buckets without changing
-- the wider dashboard, leads list, or monitoring query paths.

create index concurrently if not exists app_leads_my_day_followups_idx
  on app_leads (owner_id, next_action_at, id)
  where next_action_at is not null;

create index concurrently if not exists app_leads_my_day_priority_idx
  on app_leads (
    owner_id,
    (coalesce(priority, data->>'priority', '')),
    (coalesce(next_action_at, created_at)),
    id
  );

create index concurrently if not exists app_leads_my_day_action_order_idx
  on app_leads (
    owner_id,
    (coalesce(next_action_at, created_at)),
    id
  );
