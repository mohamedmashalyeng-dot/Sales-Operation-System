# Final CRM Latency Audit

Date: 2026-09-27

Scope: production PostgreSQL path. Ordinary single-record CRM CRUD now returns before the legacy `loadDb()` point in `handleApi`, uses targeted SQL, and patches the frontend state without reloading `/api/bootstrap`.

| Action | API | SQL queries | Server duration | Calls loadDb? | Calls saveDb? | Calls recalculate? | External APIs? | Frontend reload bootstrap? | Optimistic UI? | Remaining bottleneck |
|---|---|---:|---|---|---|---|---|---|---|---|
| New lead | `POST /api/leads` | 5-6 | Single SQL transaction, normally sub-100ms plus DB RTT | No | No | No | No | No | Local patch after API | Duplicate email lookup and audit insert |
| Update opportunity dialog | `PATCH /api/leads/:id` | 3 | Single SQL transaction | No | No | No | No | No | Local patch after API | None material |
| Stage dropdown | `PATCH /api/leads/:id` | 3 | Single SQL transaction | No | No | No | No | No | Yes, rollback on failure | None material |
| Add programme opportunity | `POST /api/leads/:id/opportunities` | 4 | Single SQL transaction | No | No | No | No | No | Local patch after API | Programme lookup |
| Add note | `POST /api/leads/:id/notes` | 2 | Single SQL transaction | No | No | No | No | No | Local success toast | Audit insert only |
| Add task | `POST /api/tasks` | 3 | Single SQL transaction | No | No | No | No | No | Local patch after API | None material |
| Complete task | `POST /api/tasks/:id/complete` | 3 | Single SQL transaction | No | No | No | No | No | Yes, rollback on failure | None material |
| Log call + follow-up | `POST /api/calls` | 2-3 | Single SQL transaction | No | No | No | No | No | Local patch after API | Optional task insert |
| Check in event attendee | `POST /api/attendees/:id/checkin` | 2-5 | Single SQL transaction | No | No | No | No | No | Local patch after API | JSONB attendee lookup/update |
| Record inbound email | `POST /api/emails` | 3 | Single SQL transaction | No | No | No | No | No | Local patch after API | None material |
| Record email response | `POST /api/emails/:id/resolve` | 3 | Single SQL transaction | No | No | No | No | No | Local patch after API | None material |
| Send Gmail response | `POST /api/emails/:id/reply` | Legacy workspace path | External-call bound | Yes | Yes | Yes, via save | Gmail/SMTP | No | Local response stamp after API | Gmail/SMTP latency and legacy integration-token path |
| Manual application | `POST /api/applications` | 5 | Single SQL transaction | No | No | No | No | No | Local patch after API | Intake lookup |
| Start application from lead | `POST /api/applications` | 5 | Single SQL transaction | No | No | No | No | No | Local patch after API | Intake lookup |
| Upload evidence | `POST /api/applications/:id/evidence` | 2 | Single SQL transaction | No | No | No | No | No | Local patch after API | File base64 payload size |
| Review evidence | `POST /api/evidence/:id/review` | 2 | Single SQL transaction | No | No | No | No | No | Local patch after API | JSONB evidence lookup |
| Review eligibility | `POST /api/applications/:id/review` | 5 | Single SQL transaction | No | No | No | No | No | Local patch after API | None material |
| Verify agreement | `POST /api/applications/:id/contract` | 2 | Single SQL transaction | No | No | No | No | No | Local patch after API | None material |
| Confirm enrolment | `POST /api/applications/:id/enrol` | 6 | Single SQL transaction | No | No | No | No | No | Local patch after API | Attribution insert |
| Load more leads | `GET /api/leads` | 2 | Paged SQL read | No | No | No | No | No | Appends page | Page size/filters |
| Load more inbox emails | `GET /api/emails` | 2-3 | Paged SQL read | No | No | No | No | No | Appends page | Sort/filter query |
| Open email thread | `GET /api/emails/:id` | 2 | Targeted SQL read | No | No | No | No | No | Modal render | Thread candidate lookup |
| Applications list | `GET /api/applications` | 1 | Targeted SQL read | No | No | No | No | No | Page render | List size |
| Audit list | `GET /api/audit` | 1 | Targeted SQL read | No | No | No | No | No | Page render | Limit only |
| Attribution list | `GET /api/attribution` | 1 | Targeted SQL read | No | No | No | No | No | Page render | Limit only |
| Link imported data | `POST /api/leads/reconcile` | Legacy workspace path | Full-state maintenance job | Yes | Yes | Yes | No | Yes | No | Bulk reconciliation |
| Import events | `POST /api/events/import` | Legacy workspace path | File/import job | Yes | Yes | Yes | Optional Google Sheet/file parse | Yes, via dialog default | No | Spreadsheet parsing and reconciliation |
| Gmail newest sync | `POST /api/integrations/gmail/sync` | Legacy workspace path | External sync job | Yes | Yes | Yes | Gmail | Yes | No | Gmail quota/network |
| Eventbrite sync | `POST /api/integrations/eventbrite/sync` | Legacy workspace path | External sync job | Yes | Yes | Yes | Eventbrite | Yes | No | Eventbrite attendee API |
| Zoom meetings sync | `POST /api/integrations/zoom/sync` | Legacy workspace path | External sync job | Yes | Yes | Yes | Zoom | Yes | No | Zoom report/registrant APIs |
| Zoom calls sync | `POST /api/integrations/zoom/calls/sync` | Legacy workspace path | External sync job | Yes | Yes | Yes | Zoom Phone | Yes | No | Zoom call-history API |
| Meta sync | `POST /api/integrations/meta/sync` | Legacy workspace path | External sync job | Yes | Yes | Yes | Meta | Yes | No | Meta API |
| Apollo sync | `POST /api/integrations/apollo/sync` | Legacy workspace path | External sync job | Yes | Yes | Yes | Apollo | Yes | No | Apollo API |
| Navigation/filter/view toggles | None | 0 | Client-only | No | No | Client local only | No | No | Immediate | DOM render only |

Notes:

- A perf guard now logs a warning if `POST/PATCH` requests for `leads`, `tasks`, `applications`, `attendees`, `calls`, `emails`, or `evidence` fall through to the legacy `loadDb()` path.
- The ordinary CRUD rows above no longer call the legacy full-database save pipeline in production PostgreSQL mode.
- External sync/import jobs are intentionally still full-state jobs because they reconcile batches from providers.
