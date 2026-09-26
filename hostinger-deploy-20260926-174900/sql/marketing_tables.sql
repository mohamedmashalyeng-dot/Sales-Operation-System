create table if not exists app_marketing_settings (
  id text primary key,
  provider text not null default 'eventbrite',
  account_name text,
  account_email text,
  daily_limit integer not null default 10000,
  daily_used integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_marketing_campaigns (
  id text primary key,
  provider text not null default 'eventbrite',
  provider_campaign_id text,
  event_id text,
  eventbrite_event_id text,
  name text not null,
  subject text,
  status text not null default 'Draft',
  campaign_type text not null default 'Email campaign',
  source text not null default 'Eventbrite',
  audience_name text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  event_start_at timestamptz,
  thumbnail_url text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_campaign_id)
);

create index if not exists idx_app_marketing_campaigns_event_id on app_marketing_campaigns(event_id);
create index if not exists idx_app_marketing_campaigns_status on app_marketing_campaigns(status);
create index if not exists idx_app_marketing_campaigns_sent_at on app_marketing_campaigns(sent_at);

create table if not exists app_marketing_campaign_metrics (
  campaign_id text primary key references app_marketing_campaigns(id) on delete cascade,
  revenue numeric(12,2) not null default 0,
  ticket_sales integer not null default 0,
  delivered integer not null default 0,
  opened integer not null default 0,
  clicks integer not null default 0,
  unsubscribed integer not null default 0,
  bounced integer not null default 0,
  open_rate numeric(7,4) not null default 0,
  click_rate numeric(7,4) not null default 0,
  unsubscribe_rate numeric(7,4) not null default 0,
  bounce_rate numeric(7,4) not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists app_marketing_recipients (
  id text primary key,
  campaign_id text not null references app_marketing_campaigns(id) on delete cascade,
  lead_id text,
  attendee_id text,
  email text,
  first_name text,
  last_name text,
  phone text,
  job_title text,
  status text not null default 'Delivered',
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email),
  unique (campaign_id, attendee_id)
);

create index if not exists idx_app_marketing_recipients_campaign_id on app_marketing_recipients(campaign_id);
create index if not exists idx_app_marketing_recipients_email on app_marketing_recipients(email);
create index if not exists idx_app_marketing_recipients_status on app_marketing_recipients(status);

create table if not exists app_marketing_subscriber_lists (
  id text primary key,
  provider text not null default 'eventbrite',
  provider_list_id text,
  name text not null,
  description text,
  subscriber_count integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_list_id)
);

create table if not exists app_marketing_subscribers (
  id text primary key,
  email text not null,
  first_name text,
  last_name text,
  phone text,
  source text not null default 'Eventbrite',
  consent_status text not null default 'Unknown',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

create table if not exists app_marketing_subscriber_list_members (
  list_id text not null references app_marketing_subscriber_lists(id) on delete cascade,
  subscriber_id text not null references app_marketing_subscribers(id) on delete cascade,
  added_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  primary key (list_id, subscriber_id)
);

