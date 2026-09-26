begin;

create table if not exists crm_users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null,
  password_hash text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists programmes (
  id text primary key,
  name text not null,
  level text
);

create table if not exists intakes (
  id text primary key,
  programme_id text references programmes(id) on delete set null,
  name text not null
);

create table if not exists leads (
  id text primary key,
  person_id text,
  first_name text not null,
  last_name text not null,
  full_name text,
  email text,
  phone text,
  employer text,
  city text,
  programme_id text references programmes(id) on delete set null,
  programme text,
  level text,
  owner_id text references crm_users(id) on delete set null,
  owner text,
  stage text,
  priority text,
  source_first_touch text,
  source_lead_capture text,
  contact_permission text,
  next_action_at timestamptz,
  created_at timestamptz,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists tasks (
  id text primary key,
  lead_id text references leads(id) on delete cascade,
  title text not null,
  kind text,
  status text,
  due_at timestamptz,
  completed_at timestamptz,
  priority text,
  owner_id text references crm_users(id) on delete set null,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists emails (
  id text primary key,
  lead_id text references leads(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  subject text,
  body text,
  owner text,
  received_at timestamptz,
  due_at timestamptz,
  response_at timestamptz,
  response_note text,
  gmail_message_id text,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists applications (
  id text primary key,
  lead_id text references leads(id) on delete cascade,
  first_name text,
  last_name text,
  programme text,
  intake text,
  status text,
  manager text,
  member text,
  created_at timestamptz,
  contract jsonb not null default '{}'::jsonb,
  learner jsonb,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists application_requirements (
  id text primary key,
  application_id text not null references applications(id) on delete cascade,
  title text not null,
  latest jsonb,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists events (
  id text primary key,
  eventbrite_event_id text unique,
  name text not null,
  location text,
  start_at timestamptz,
  campaign text,
  capacity integer,
  registrations integer,
  attendance integer,
  sync_warning text,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists event_attendees (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  eventbrite_attendee_id text,
  lead_id text references leads(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  attended_at timestamptz,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists integrations (
  name text primary key,
  status text,
  detail text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists audit_log (
  id text primary key,
  occurred_at timestamptz,
  actor text,
  action text,
  entity text,
  entity_id text,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists attribution_snapshots (
  id bigserial primary key,
  lead_id text,
  programme text,
  snapshot jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_leads_email on leads(lower(email));
create index if not exists idx_leads_stage on leads(stage);
create index if not exists idx_leads_owner_id on leads(owner_id);
create index if not exists idx_tasks_lead_id on tasks(lead_id);
create index if not exists idx_tasks_due_at on tasks(due_at);
create index if not exists idx_emails_lead_id on emails(lead_id);
create index if not exists idx_emails_received_at on emails(received_at desc);
create index if not exists idx_events_start_at on events(start_at desc);
create index if not exists idx_event_attendees_event_id on event_attendees(event_id);

-- Copy current app_state JSON into normalized reporting tables.
-- Safe to rerun: rows are upserted by primary key.

insert into crm_users (id, name, email, role, password_hash)
select x.id, x.name, x.email, x.role, x.password_hash
from app_state s,
jsonb_to_recordset(s.data->'users') as x(id text, name text, email text, role text, password_hash text)
where s.id = 'main'
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  password_hash = excluded.password_hash,
  updated_at = now();

insert into programmes (id, name, level)
select x.id, x.name, x.level
from app_state s,
jsonb_to_recordset(s.data->'programmes') as x(id text, name text, level text)
where s.id = 'main'
on conflict (id) do update set
  name = excluded.name,
  level = excluded.level;

insert into intakes (id, programme_id, name)
select x.id, x.programme_id, x.name
from app_state s,
jsonb_to_recordset(s.data->'intakes') as x(id text, programme_id text, name text)
where s.id = 'main'
on conflict (id) do update set
  programme_id = excluded.programme_id,
  name = excluded.name;

insert into leads (
  id, person_id, first_name, last_name, full_name, email, phone, employer, city,
  programme_id, programme, level, owner_id, owner, stage, priority,
  source_first_touch, source_lead_capture, contact_permission, next_action_at, created_at, raw
)
select
  x.id, x.person_id, x.first_name, x.last_name, x.full_name, x.email, x.phone, x.employer, x.city,
  x.programme_id, x.programme, x.level, x.owner_id, x.owner, x.stage, x.priority,
  x.source_first_touch, x.source_lead_capture, x.contact_permission,
  nullif(x.next_action_at, '')::timestamptz,
  nullif(x.created_at, '')::timestamptz,
  coalesce(x.raw, '{}'::jsonb)
from app_state s,
jsonb_to_recordset(s.data->'leads') as x(
  id text, person_id text, first_name text, last_name text, full_name text,
  email text, phone text, employer text, city text, programme_id text,
  programme text, level text, owner_id text, owner text, stage text, priority text,
  source_first_touch text, source_lead_capture text, contact_permission text,
  next_action_at text, created_at text, raw jsonb
)
where s.id = 'main'
on conflict (id) do update set
  person_id = excluded.person_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  full_name = excluded.full_name,
  email = excluded.email,
  phone = excluded.phone,
  employer = excluded.employer,
  city = excluded.city,
  programme_id = excluded.programme_id,
  programme = excluded.programme,
  level = excluded.level,
  owner_id = excluded.owner_id,
  owner = excluded.owner,
  stage = excluded.stage,
  priority = excluded.priority,
  source_first_touch = excluded.source_first_touch,
  source_lead_capture = excluded.source_lead_capture,
  contact_permission = excluded.contact_permission,
  next_action_at = excluded.next_action_at,
  created_at = excluded.created_at,
  raw = excluded.raw;

insert into tasks (id, lead_id, title, kind, status, due_at, completed_at, priority, owner_id, raw)
select x.id, x.lead_id, x.title, x.kind, x.status, nullif(x.due_at, '')::timestamptz, nullif(x.completed_at, '')::timestamptz, x.priority, x.owner_id, coalesce(x.raw, '{}'::jsonb)
from app_state s,
jsonb_to_recordset(s.data->'tasks') as x(id text, lead_id text, title text, kind text, status text, due_at text, completed_at text, priority text, owner_id text, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  lead_id = excluded.lead_id,
  title = excluded.title,
  kind = excluded.kind,
  status = excluded.status,
  due_at = excluded.due_at,
  completed_at = excluded.completed_at,
  priority = excluded.priority,
  owner_id = excluded.owner_id,
  raw = excluded.raw;

insert into emails (id, lead_id, first_name, last_name, email, subject, body, owner, received_at, due_at, response_at, response_note, gmail_message_id, raw)
select x.id, nullif(x.lead_id, ''), x.first_name, x.last_name, x.email, x.subject, x.body, x.owner,
  nullif(x.received_at, '')::timestamptz,
  nullif(x.due_at, '')::timestamptz,
  nullif(x.response_at, '')::timestamptz,
  x.response_note,
  x.gmail_message_id,
  coalesce(x.raw, '{}'::jsonb)
from app_state s,
jsonb_to_recordset(s.data->'emails') as x(id text, lead_id text, first_name text, last_name text, email text, subject text, body text, owner text, received_at text, due_at text, response_at text, response_note text, gmail_message_id text, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  lead_id = excluded.lead_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  subject = excluded.subject,
  body = excluded.body,
  owner = excluded.owner,
  received_at = excluded.received_at,
  due_at = excluded.due_at,
  response_at = excluded.response_at,
  response_note = excluded.response_note,
  gmail_message_id = excluded.gmail_message_id,
  raw = excluded.raw;

insert into applications (id, lead_id, first_name, last_name, programme, intake, status, manager, member, created_at, contract, learner, raw)
select x.id, x.lead_id, x.first_name, x.last_name, x.programme, x.intake, x.status, x.manager, x.member,
  nullif(x.created_at, '')::timestamptz,
  coalesce(x.contract, '{}'::jsonb),
  x.learner,
  coalesce(x.raw, '{}'::jsonb)
from app_state s,
jsonb_to_recordset(s.data->'applications') as x(id text, lead_id text, first_name text, last_name text, programme text, intake text, status text, manager text, member text, created_at text, contract jsonb, learner jsonb, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  lead_id = excluded.lead_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  programme = excluded.programme,
  intake = excluded.intake,
  status = excluded.status,
  manager = excluded.manager,
  member = excluded.member,
  created_at = excluded.created_at,
  contract = excluded.contract,
  learner = excluded.learner,
  raw = excluded.raw;

insert into application_requirements (id, application_id, title, latest, raw)
select req.id, app.id, req.title, req.latest, coalesce(req.raw, '{}'::jsonb)
from app_state s
cross join lateral jsonb_to_recordset(s.data->'applications') as app(id text, requirements jsonb)
cross join lateral jsonb_to_recordset(app.requirements) as req(id text, title text, latest jsonb, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  application_id = excluded.application_id,
  title = excluded.title,
  latest = excluded.latest,
  raw = excluded.raw;

insert into events (id, eventbrite_event_id, name, location, start_at, campaign, capacity, registrations, attendance, sync_warning, raw)
select x.id, x.eventbrite_event_id, x.name, x.location, nullif(x.start_at, '')::timestamptz, x.campaign, x.capacity, x.registrations, x.attendance, x.sync_warning, coalesce(x.raw, '{}'::jsonb)
from app_state s,
jsonb_to_recordset(s.data->'events') as x(id text, eventbrite_event_id text, name text, location text, start_at text, campaign text, capacity integer, registrations integer, attendance integer, sync_warning text, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  eventbrite_event_id = excluded.eventbrite_event_id,
  name = excluded.name,
  location = excluded.location,
  start_at = excluded.start_at,
  campaign = excluded.campaign,
  capacity = excluded.capacity,
  registrations = excluded.registrations,
  attendance = excluded.attendance,
  sync_warning = excluded.sync_warning,
  raw = excluded.raw;

insert into event_attendees (id, event_id, eventbrite_attendee_id, lead_id, first_name, last_name, email, attended_at, raw)
select attendee.id, ev.id, attendee.eventbrite_attendee_id, nullif(attendee.lead_id, ''), attendee.first_name, attendee.last_name, attendee.email, nullif(attendee.attended_at, '')::timestamptz, coalesce(attendee.raw, '{}'::jsonb)
from app_state s
cross join lateral jsonb_to_recordset(s.data->'events') as ev(id text, attendees jsonb)
cross join lateral jsonb_to_recordset(ev.attendees) as attendee(id text, eventbrite_attendee_id text, lead_id text, first_name text, last_name text, email text, attended_at text, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  event_id = excluded.event_id,
  eventbrite_attendee_id = excluded.eventbrite_attendee_id,
  lead_id = excluded.lead_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  attended_at = excluded.attended_at,
  raw = excluded.raw;

insert into integrations (name, status, detail, raw, updated_at)
select x.name, x.status, x.detail, coalesce(x.raw, '{}'::jsonb), now()
from app_state s,
jsonb_to_recordset(s.data->'integrations') as x(name text, status text, detail text, raw jsonb)
where s.id = 'main'
on conflict (name) do update set
  status = excluded.status,
  detail = excluded.detail,
  raw = excluded.raw,
  updated_at = now();

insert into audit_log (id, occurred_at, actor, action, entity, entity_id, raw)
select x.id, nullif(x.occurred_at, '')::timestamptz, x.actor, x.action, x.entity, x.entity_id, coalesce(x.raw, '{}'::jsonb)
from app_state s,
jsonb_to_recordset(s.data->'audit') as x(id text, occurred_at text, actor text, action text, entity text, entity_id text, raw jsonb)
where s.id = 'main'
on conflict (id) do update set
  occurred_at = excluded.occurred_at,
  actor = excluded.actor,
  action = excluded.action,
  entity = excluded.entity,
  entity_id = excluded.entity_id,
  raw = excluded.raw;

commit;


