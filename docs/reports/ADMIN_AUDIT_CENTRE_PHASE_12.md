# Phase 12 - Admin & Audit Centre

Status: PASS

## Scope Completed

- Added Admin & Audit Centre UI.
- Added APIs:
  - `GET /api/admin-audit/overview`
  - `GET /api/admin-audit/audit?limit=50&cursor=`
- Added bounded audit filters:
  - actor
  - action
  - entity
  - from/to date
- Added safe overview for automation job status and recent audit rows.
- Reused existing developer-only user management actions.

## Security

- Admin & Audit routes require team permission.
- User management remains developer-only.
- Existing self-escalation protections remain in `server/auth.js`.
- Role/password changes continue to clear target sessions.
- Audit API returns safe fields only and does not expose raw `data` payloads or secrets.

## Performance

- Audit list is cursor-paginated and limited to 100 rows maximum per request.
- Existing audit indexes on `occurred_at` and `entity_id` are reused.

## Tests

- `npm run test:admin-audit`
- Authorization regression covers member denial and monitor access.
- Included in `npm run check`

## Known Limits

- Security events are shown only where the existing infrastructure already records them.
- User management creation/deletion stays in the Developer panel and is surfaced here only as safe visibility plus allowed reset action for developer-visible users.
