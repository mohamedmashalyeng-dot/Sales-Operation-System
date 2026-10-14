# Integrations

## Gmail

- Provider: Google Gmail API and optional Gmail SMTP.
- OAuth start: `GET /api/integrations/gmail/connect`.
- OAuth callback: `GET /api/integrations/gmail/callback`.
- Scopes: `openid`, `email`, `gmail.readonly`, `gmail.send`.
- Local storage: `app_workspace.gmail` JSON, plus imported messages in `app_emails`.
- Sync trigger: `POST /api/integrations/gmail/sync`, background `Gmail.scheduleGmailAutoSync`.
- External ID: `gmail_message_id`, `gmail_thread_id`, label IDs/names.
- Checkpoints: full page tokens (`sync_2026_page_token`, `sent_sync_2026_page_token`), incremental page tokens, `history_id`, trash sync timestamp, `incremental_started_at`.
- Error/rate limit handling: quota/rate errors return `quota_limited` and retry metadata; auto sync backs off.
- Sending: first tries Gmail API; SMTP fallback uses `GMAIL_SMTP_*`.

## Zoho CRM

- Provider: Zoho CRM OAuth/API.
- OAuth start: `GET /api/integrations/zoho/connect` or `/authorize`.
- OAuth callback: `GET /api/integrations/zoho/callback`.
- Local storage: connection state in `app_workspace.meta.zoho`; durable records in `app_zoho_records`; async jobs in `integration_jobs`.
- Sync trigger: `POST /api/integrations/zoho/sync`, generic integration centre sync, auto sync scheduler.
- External ID: `app_zoho_records.key` and `zoho_id`; lead copy in `app_leads.data.zoho_record_id`.
- Checkpoints: per-module job cursors and module sync marks.
- Error/rate limit handling: retries on 429/5xx, waits longer for 429, writes job status/error and reauthorization state when token failures occur.
- Reconnect behavior: diagnostics mark reauthorization required when refresh token is missing/revoked; reconnect queues sync automatically in current implementation.

## Zoom

- Provider: Zoom Server-to-Server OAuth.
- OAuth flow: no browser OAuth route; uses account/client credentials from env.
- Local storage: Zoom meeting-backed events in `app_events`; Zoom calls and number state in `app_workspace.meta.zoom`.
- Sync trigger: `POST /api/integrations/zoom/sync` for meetings, `POST /api/integrations/zoom/calls/sync` for calls, scheduled job when enabled.
- External IDs: `zoom_meeting_id`, `zoom_meeting_uuid`, Zoom call IDs and phone numbers.
- Checkpoints: `zoom_sync_state` migration exists; code also stores last sync times in Zoom state and applies report overlap windows.
- Error/rate limit handling: provider requests retry for 429/502/503/504 with waits; `ZOOM_REQUEST_DELAY_MS` spaces calls.

## Eventbrite

- Provider: Eventbrite API.
- OAuth start: `GET /api/integrations/eventbrite/connect`.
- OAuth callback: `GET /api/integrations/eventbrite/callback`.
- Optional credential mode: `EVENTBRITE_PRIVATE_TOKEN`.
- Local storage: connection state in `app_workspace.eventbrite`; events/attendees in `app_events`.
- Sync trigger: `POST /api/integrations/eventbrite/sync`, event auto sync.
- External IDs: `eventbrite_event_id`, `eventbrite_attendee_id`.
- Checkpoints: imported event/attendee ID lists, `last_sync_at`, optional `events_incremental_started_at`.
- Error/rate limit handling: attendee fetch errors are counted as warnings per event; no durable job queue.

## Meta Lead Ads

- Provider: Meta Graph API.
- OAuth flow: none in current code; uses `META_ACCESS_TOKEN`, `META_PAGE_ID`, optional `META_FORM_IDS`.
- Local storage: `app_workspace.meta`.
- Sync trigger: `POST /api/integrations/meta/sync`, generic integration centre sync.
- External IDs: Meta lead/form IDs in lead JSON.

## Apollo

- Provider: Apollo API.
- OAuth flow: none; uses `APOLLO_API_KEY`.
- Local storage: Apollo state in `app_workspace.meta.apollo`; leads in `app_leads`.
- Sync trigger: `POST /api/integrations/apollo/sync`, generic integration centre sync.
- External IDs: Apollo person IDs in lead JSON.

## Integration Centre

`server/integration-centre.js` builds safe overview/detail payloads and redacts secrets recursively. It reads `app_workspace`, `integration_jobs`, `app_zoho_records`, and integration audit rows.

Access requires team permission for overview, details and sync trigger routes.
