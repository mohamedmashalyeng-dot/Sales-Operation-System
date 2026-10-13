-- Phase 7.1: Data Quality performance indexes.
-- Additive only. These indexes support read-only duplicate and Zoho mismatch
-- detection; they do not rewrite, delete, merge, or relink CRM records.

create index concurrently if not exists app_leads_dq_email_norm_idx
  on app_leads (lower(trim(email)))
  where coalesce(trim(email), '') <> ''
    and lower(trim(email)) not like '%.local';

create index concurrently if not exists app_leads_dq_phone_norm_idx
  on app_leads ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')))
  where length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7;

create index concurrently if not exists app_leads_dq_meta_id_idx
  on app_leads ((data->>'meta_lead_id'))
  where coalesce(data->>'meta_lead_id', '') <> '';

create index concurrently if not exists app_leads_dq_apollo_id_idx
  on app_leads ((data->>'apollo_person_id'))
  where coalesce(data->>'apollo_person_id', '') <> '';

create index concurrently if not exists app_leads_dq_zoho_mismatch_idx
  on app_leads ((data->>'zoho_record_id'), created_at desc, id desc)
  include (email)
  where coalesce(data->>'zoho_record_id', '') <> '';

create index concurrently if not exists app_zoho_records_dq_key_email_idx
  on app_zoho_records (key)
  include (email);
