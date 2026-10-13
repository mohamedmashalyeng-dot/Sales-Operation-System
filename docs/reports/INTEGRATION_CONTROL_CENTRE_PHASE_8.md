# Integration Control Centre - Phase 8

Date: 2026-10-12

## 1. Integrations Discovered

- Zoho CRM: OAuth, durable `integration_jobs`, local `app_zoho_records`.
- Gmail: OAuth, local `app_workspace.gmail`, synchronous/manual sync plus optional auto sync.
- Zoom: Server-to-server OAuth env configuration, local meetings/calls in events/workspace state.
- Eventbrite: OAuth or private token, local events/attendees.
- Meta Lead Ads: env access token/page id, local lead import metadata.
- Apollo: env API key/search filters, local prospect import metadata.
- Sheets / Excel: manual event import only; not represented as a connected account.

## 2. Architecture

The Integration Control Centre wraps existing providers. It does not replace OAuth, sync, or provider modules.

Added endpoints:

- `GET /api/integrations/overview`
- `GET /api/integrations/:id`
- `POST /api/integrations/control/:id/sync`

The Control Centre sync route is deliberately namespaced under `/control/` so it does not shadow the existing provider sync routes. Only Zoho currently supports the new Control Centre Sync Now action because Zoho already has durable async jobs and single-flight protection. Other providers still expose status and reconnect information, but no Control Centre sync button is offered until they have durable async jobs.

## 3. Safety

- All Integration Centre routes require `Authorization.requireTeam(user)`.
- Overview/detail never call external providers.
- Secret fields are recursively redacted.
- Stored/displayed errors are sanitized.
- No disconnect/cancel buttons were added for providers that do not safely support them from existing architecture.

## 4. Status Model

Health values:

- `healthy`
- `warning`
- `error`
- `disconnected`
- `unknown`

Sync values:

- `idle`
- `queued`
- `running`
- `completed`
- `failed`
- `retrying`

## 5. Background Jobs

Zoho uses existing `integration_jobs` with:

- `integration_jobs_active_zoho_idx`
- durable cursors/checkpoints
- row lease fields `locked_by` and `locked_until`
- resume after restart through `resumeZohoSyncJobs`

No second job queue was created.

## 6. Provider Limitations

- Gmail, Zoom, Eventbrite, Meta, and Apollo manual sync routes are currently synchronous. Control Centre intentionally does not expose Sync Now for them to avoid long request/504 regressions.
- Multiple Zoom account configuration is reflected as separate cards when multiple configured accounts are discovered.
- Sheets/Excel is manual import, not a persistent connected integration.

## 7. Tests / Diagnostics

Added:

- `npm run test:integration-centre`
- `npm run diagnose:integrations`

Completed verification:

- `node --check app.js`
- `node --check server/integration-centre.js`
- `node --check server/routes/integration-centre.js`
- `node --check scripts/integration-centre-test.js`
- `npm run test:integration-centre`
- `npm run diagnose:integrations`
- `npm run test:authorization`
- `npm run test:my-day`
- `npm run test:frontend`
- `npm run test:automations`
- `npm run test:admissions`
- `npm run test:data-quality`
- `npm run check`

Diagnostic snapshot: 8 integration cards were detected. Zoho is connected but currently reports a failed latest job from local job history; Gmail, Zoom, and Eventbrite report healthy local state; Meta and Apollo are unconfigured/unknown; Sheets/Excel is disconnected because it is manual import only.
