# Authorization Matrix

Project: Kent Business College Works CRM

## Runtime Path

`app.js` calls `/api/*`; `server.js` delegates API requests to `server/routes/index.js`; `Routes.handleApi` applies security headers, session cookie gating and route dispatch; route handlers call PostgreSQL-backed services or the legacy workspace store.

## Roles Found In Code

Roles are normalized in `server/auth.js`.

| Visible role | Stored role | Server permissions | Scope |
| --- | --- | --- | --- |
| Developer | `admin` for the configured developer email | `sales`, `review`, `admin`, `developer` | Full workspace and developer-only user/admin actions |
| Monitor | `manager` or non-developer `admin` | `sales`, `review` | Team-wide CRM/review/integration visibility |
| Member | `sales` | `sales` | Own leads and records attached to own leads |

## Central Policy

The shared policy lives in `server/authorization.js`.

| Helper | Purpose |
| --- | --- |
| `requireTeam(user)` | Team-wide actions: imports, syncs, admin dashboards, monitoring, bulk/reconcile, organisation reports |
| `requireRecord(user, entity, id, db?)` | Record-level IDOR guard for `lead`, `task`, `application`, `email`, `evidence`, `attendee` |
| `ownerFilter(user, requested)` | Forces Member list requests to the current user's owner id |
| `ownerForWrite(user, requested)` | Prevents Members assigning leads/tasks to another user |
| `rejectProtectedFields(body)` | Rejects mass assignment of sensitive fields such as `role`, `permissions`, `password_hash`, `deleted_at`, `deleted_by`, `created_by`, `zoho_record_id`, `crm_id` |

## Endpoint Matrix

| Area | Member | Monitor | Developer | Notes |
| --- | --- | --- | --- | --- |
| Leads list | Own leads only | Team, optional owner filter | Team, optional owner filter | `ownerFilter` |
| Lead detail/update | Own lead only | Any lead | Any lead | `requireRecord('lead')`; protected fields rejected |
| Lead create | Own owner only | Any allowed owner | Any allowed owner | duplicate email takeover blocked for Members |
| Lead delete/soft-delete | Denied | Allowed | Allowed | Team-only |
| Lead notes/opportunities/calls | Own lead only | Any lead | Any lead | calls inherit lead authorization |
| Tasks list/create/complete/delete | Own tasks or tasks on own leads | Team | Team | assignment to another owner blocked for Members |
| Applications list/create/evidence upload | Own lead/application only | Team | Team | review/enrol/delete are team-only |
| Evidence file download/delete | Own evidence only | Team | Team | protected by evidence-to-lead ownership |
| Emails list/detail/create/resolve/read/delete | Own lead emails only | Team | Team | inbox search remains scoped for Members |
| Event attendee check-in | Attendee linked to own lead only | Team | Team | unlinked attendees have no owner and are not Member-writable |
| Events read | Signed-in users | Signed-in users | Signed-in users | Event data is treated as shared calendar/marketing data |
| Meetings / Zoom calls / Zoom numbers | Denied | Allowed | Allowed | Team-only |
| Integrations connect/sync/import | Denied | Allowed | Allowed | OAuth callbacks still require session state |
| Contacts / audit / attribution / monitoring | Denied | Allowed | Allowed | Team-only |
| Dashboard summary/pipeline/my-work/priority/search/activity | Own scope for Members | Team scope | Team scope | dashboard filters clamp Member owner id |
| Dashboard admin overview/totals/monitoring | Denied | Allowed | Allowed | workspace-wide aggregates are team-only |
| User create/reset/role/delete/developer config | Denied | Denied | Allowed | configured developer account only |
| Static files | Public assets only | Public assets only | Public assets only | `.env`, server code, data, backups, SQL, logs blocked |

## Sensitive Data Rules

- Password hashes and temporary passwords are removed by `Auth.publicUser`.
- Integration secrets are masked or removed before developer/status payloads.
- Static serving only permits root browser assets and `assets/images/*` with public extensions.
- API responses are `Cache-Control: no-store`; static browser assets keep explicit cache rules.
