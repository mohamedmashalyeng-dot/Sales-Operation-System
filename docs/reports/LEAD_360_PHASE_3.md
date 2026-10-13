# Lead 360 Phase 3

Date: 2026-10-12

## Scope

Implemented the Lead 360 profile on the existing `/leads/:id` route. The first render uses a compact `GET /api/leads/:id` payload, then loads related sections only when the user opens a tab.

## Endpoints

- `GET /api/leads/:id`: core lead profile, summary counts, next action, recent activity.
- `GET /api/leads/:id/timeline`
- `GET /api/leads/:id/emails`
- `GET /api/leads/:id/tasks`
- `GET /api/leads/:id/application`
- `GET /api/leads/:id/meetings`
- `GET /api/leads/:id/calls`
- `GET /api/leads/:id/notes`
- `GET /api/leads/:id/files`

Each related endpoint is bounded by `limit` and cursor pagination. No endpoint calls Gmail, Zoom, Zoho, Apollo, Meta, Eventbrite, or any external API.

## Relationships

- Tasks, emails, and applications use direct `lead_id`.
- Meetings use `app_events.attendees[].lead_id`.
- Notes use `app_audit` rows for the lead.
- Files are derived from application requirements and return metadata only. Downloads continue through the existing authorized evidence endpoint.
- Calls use stored Zoom call records that already carry `lead_id`; no phone or email fuzzy matching is used.

## Permissions

Every Lead 360 related route first checks `Authorization.requireRecord(user, 'lead', id)`. The authorization test suite now verifies that a member cannot read another member's Lead 360 emails, tasks, files, or timeline.

## Performance

The old lead detail path loaded up to 200 tasks, emails, applications, and audit rows at once. The new core route returns a small profile payload and summary counts. The heavier data is split into lazy tab endpoints so the page does not fetch emails, tasks, applications, meetings, calls, notes, or files until needed.

Added `npm run diagnose:lead-360` for local timing of the core and tab queries.
