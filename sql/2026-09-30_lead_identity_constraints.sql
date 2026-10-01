-- PROPOSED for Step 4. Not applied. Run only after sql/2026-09-30_lead_dedupe.sql and after
-- `npm run dedupe:report` shows 0 external-ID collisions (true on 2026-09-30).
-- Each statement fails without changing anything if existing active data would violate it.

-- A Zoho record ("Module:id", stored in data->>'zoho_record_id') belongs to one active lead.
-- There is no zoho_connection_id: the workspace has a single Zoho connection, and the key
-- already contains the module.
create unique index concurrently if not exists app_leads_zoho_record_unique
  on app_leads ((data->>'zoho_record_id'))
  where coalesce(data->>'zoho_record_id', '') <> '' and deleted_at is null;

-- An Eventbrite attendee registration belongs to one active lead.
create unique index concurrently if not exists app_leads_eventbrite_attendee_unique
  on app_leads ((data->>'eventbrite_attendee_id'))
  where coalesce(data->>'eventbrite_attendee_id', '') <> '' and deleted_at is null;

-- Email is NOT made unique. The application already keeps one active lead per normalized
-- email on every write path (manual create, Zoho import, Gmail/Event import), and the data is
-- clean, but a hard constraint would make those imports fail instead of merging. Detection by
-- lower(trim(email)) stays in the dedupe report; revisit once all write paths use SQL upserts.
