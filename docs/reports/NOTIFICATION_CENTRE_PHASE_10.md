# Phase 10 - Notification Centre

Status: PASS

## Scope Completed

- Added a per-user notification model in `app_notifications`.
- Added cursor-paginated APIs:
  - `GET /api/notifications?limit=50&cursor=&filter=`
  - `GET /api/notifications/unread-count`
  - `PATCH /api/notifications/:id/read`
  - `POST /api/notifications/read-all`
- Added Notification Centre UI with All, Unread, High Priority and Today filters.
- Added read/unread state, read-all, deep links and top-bar unread badge.
- Generated notifications are deduped by deterministic ids, so repeated page loads do not create startup floods.

## Notification Sources

- Open tasks due within 24 hours.
- Overdue tasks.
- Applications with outstanding evidence actions.
- Integration failures for team users where `integration_jobs` exists.
- Automation failures for team users where automation tables exist.

## Security

- Routes require a signed-in session.
- Notifications are scoped by `user_id`.
- Member users only receive task/application notifications for records they own.
- API responses do not expose notification `user_id` or raw secret-bearing payloads.

## Performance

- Unread count is served by `app_notifications_user_read_created_idx`.
- Notification list is bounded and cursor-paginated.
- Generated notification refresh runs only on notification endpoints, not at startup.

## Tests

- `npm run test:notifications`
- Included in `npm run check`

## Known Limits

- Notifications are generated from current operational records; there is no real-time push channel yet.
- Data quality summary notifications are reserved for a later pass.
