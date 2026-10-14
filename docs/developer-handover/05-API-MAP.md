# API Map

The router lives in `server/routes/index.js`. Public/open routes are tried first, then authenticated direct routes, then workspace-loaded fallback routes.

Most protected routes require a `sid` cookie. Record-level behavior depends on `server/authorization.js`.

| Method | Route | Handler | Purpose | Authorization | Frontend caller | DB/integration dependency |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/health` | `systemOpenRoutes` | Health ping | Open | Smoke/deploy checks | None |
| POST | `/api/login` | `accountOpenRoutes` | Sign in, create session | Open + throttle | `WorkspaceProvider.signInBackend`, legacy `login()` | `app_users`, `app_sessions` or local memory |
| POST | `/api/logout` | `accountRoutes` | End session | Signed in | legacy app | `app_sessions` |
| POST | `/api/password` | `accountRoutes` | Change own password | Signed in | legacy app | `app_users`, `app_sessions` |
| POST | `/api/password/forgot` | `accountOpenRoutes` | Request reset | Open + throttle | login screen | Gmail API/SMTP if configured |
| POST | `/api/password/reset` | `accountOpenRoutes` | Reset with token | Open + throttle | reset screen | `app_password_resets`, `app_users` |
| GET | `/api/bootstrap` | `bootstrapRoutes` | Slim startup payload | Signed in | `backendSync.loadBackendWorkspace` | `app_workspace`, users, programmes, intakes |
| GET | `/api/workspace/full` | `bootstrapRoutes` | Full workspace payload | Signed in | legacy/support | Full storage load |
| GET | `/api/developer/config` | `bootstrapRoutes` | Developer config panel | Developer account | developer/settings pages | Env names, users, integration status |
| GET | `/api/leads` | `leadsRoutes` | Paginated leads list | Owner scoped for members | `backendSync`, legacy app | `app_leads` |
| POST | `/api/leads` | `leadsRoutes` | Create/update lead | Signed in; member owner scoped | lead forms | `app_leads`, `app_tasks`, audit |
| GET | `/api/leads/:id` | `leadsRoutes` | Lead detail | `requireRecord('lead')` | lead detail | `app_leads` |
| PATCH | `/api/leads/:id` | `leadsRoutes` | Update stage/owner/priority etc. | `requireRecord('lead')`; owner rules | lead detail/list | `app_leads`, audit |
| DELETE | `/api/leads/:id` | `leadsRoutes` | Delete/soft-delete lead | Team + sales permission | admin/lead actions | `app_leads` |
| GET | `/api/leads/:id/:tab` | `leadsRoutes` | Lead 360 tabs | `requireRecord('lead')` | lead detail | related tables |
| POST | `/api/leads/:id/notes` | `leadsRoutes` | Add note | `requireRecord('lead')` | lead detail | audit |
| POST | `/api/leads/:id/opportunities` | `leadsRoutes` | Add programme opportunity | `requireRecord('lead')` | lead detail | `app_leads` |
| POST | `/api/calls` | `leadsRoutes` | Log manual call/follow-up | lead record access | legacy/current call flows | `app_tasks`, audit |
| GET | `/api/tasks` | `tasksRoutes` | Paginated tasks | Owner scoped for members | `backendSync`, planner | `app_tasks` |
| POST | `/api/tasks` | `tasksRoutes` | Create task | Lead record access; owner rules | task forms | `app_tasks` |
| POST | `/api/tasks/:id/complete` | `tasksRoutes` | Complete task | task record access | planner | `app_tasks`, audit |
| DELETE | `/api/tasks/:id` | `tasksRoutes` | Delete task | task access + sales permission | planner/admin | `app_tasks` |
| GET | `/api/emails` | `emailsRoutes` | Paginated inbox | Owner scoped for members | inbox page, `backendSync` | `app_emails`, Gmail state |
| GET | `/api/emails/:id` | `emailsRoutes` | Email detail | email record access | inbox detail | `app_emails` |
| POST | `/api/emails` | `emailsRoutes` | Record inbound email | lead record access | legacy forms | `app_emails` |
| POST | `/api/emails/:id/resolve` | `emailsRoutes` | Mark response resolved | email record access | inbox | `app_emails` |
| PATCH | `/api/emails/:id/read` | `emailsRoutes` | Read/unread state | email record access | inbox detail | `app_emails` |
| DELETE | `/api/emails/:id` | `emailsRoutes` | Delete email | email access + sales permission | inbox/admin | `app_emails` |
| POST | `/api/emails/:id/reply` | workspace email route | Send reply | email record access | legacy app | Gmail API or SMTP |
| GET | `/api/events` | `eventsRoutes` | Paginated events | Signed in | `backendSync`, events page | `app_events` |
| GET | `/api/events/:id` | `eventsRoutes` | Event detail | Signed in | event detail/prefetch | `app_events` |
| POST | `/api/events/import` | `eventsRoutes` | Import spreadsheet/configured sheet | Team | events import modal | XLSX/Google sheet URL |
| POST | `/api/attendees/:id/...` | `eventsRoutes` | attendee actions | attendee record access | events workflows | `app_events`, leads/tasks |
| GET | `/api/applications` | `applicationsRoutes` | Paginated applications | Owner scoped for members | `backendSync`, applications | `app_applications` |
| POST | `/api/applications` | `applicationsRoutes` | Create application | lead record access | applications forms | `app_applications`, `app_leads` |
| GET | `/api/applications/:id` | `applicationsRoutes` | Application detail | application access | applications detail | `app_applications` |
| DELETE | `/api/applications/:id` | `applicationsRoutes` | Delete application | Team + review/sales | admin/application actions | `app_applications`, attribution |
| POST | `/api/applications/:id/evidence` | `applicationsRoutes` | Upload evidence | application access | application detail | `app_applications` |
| GET | `/api/evidence/:id/file` | `applicationsRoutes` | Download evidence | evidence access | application/lead files | `app_applications` |
| POST | `/api/evidence/:id/review` | `applicationsRoutes` | Review evidence | Team | application review | `app_applications` |
| POST | `/api/applications/:id/review` | `applicationsRoutes` | Eligibility/application review | Team | application review | `app_applications`, `app_leads` |
| POST | `/api/applications/:id/contract` | `applicationsRoutes` | Verify contract | Team | application detail | `app_applications` |
| POST | `/api/applications/:id/enrol` | `applicationsRoutes` | Enrol learner | Team | application detail | `app_applications`, `app_leads`, attribution |
| PATCH | `/api/applications/:id/status` | `applicationsRoutes` | Status transition | application access + review/sales | applications | `app_applications` |
| GET | `/api/admissions/pipeline` | `applicationsRoutes` | Admissions pipeline | Owner scoped | admissions pages | `app_applications`, `app_leads` |
| GET | `/api/admissions/stage/:stage` | `applicationsRoutes` | Stage page | Owner scoped | admissions pages | `app_applications` |
| GET | `/api/meetings` | `zoomRoutes` | Zoom meeting events | Signed in | `backendSync`, zoom page | `app_events` |
| GET | `/api/zoom/events` | `zoomRoutes` | Zoom event list | Signed in | legacy/current | `app_events` |
| GET | `/api/zoom/calls` | `zoomRoutes` | Zoom Phone calls | Signed in | `backendSync`, zoom page | `app_workspace.meta.zoom.calls` |
| GET | `/api/zoom/numbers` | `zoomRoutes` | Zoom numbers | Signed in | zoom page | Zoom state |
| POST | `/api/integrations/zoom/sync` | `zoomRoutes` | Sync meetings | Team | events import/monitoring | Zoom Server-to-Server OAuth |
| POST | `/api/integrations/zoom/calls/sync` | `zoomRoutes` | Sync calls | Team | zoom/monitoring | Zoom API |
| GET | `/api/integrations/gmail/status` | `gmailRoutes` | Gmail status | Signed in/team context | settings/monitoring | Gmail config/state |
| GET | `/api/integrations/gmail/connect` | `gmailRoutes` | Start OAuth | Signed in | settings | Google OAuth |
| GET | `/api/integrations/gmail/callback` | `gmailRoutes` | OAuth callback | Public callback with state | provider redirect | Google OAuth/session state |
| POST | `/api/integrations/gmail/sync` | `gmailRoutes` | Import Gmail | Team | inbox sync button | Gmail API |
| GET | `/api/integrations/eventbrite/status` | `eventbriteRoutes` | Eventbrite status | Signed in | settings/monitoring | Eventbrite state |
| GET | `/api/integrations/eventbrite/connect` | `eventbriteRoutes` | Start OAuth | Signed in | settings | Eventbrite OAuth |
| GET | `/api/integrations/eventbrite/callback` | `eventbriteRoutes` | OAuth callback | Public callback with state | provider redirect | Eventbrite OAuth/session state |
| POST | `/api/integrations/eventbrite/sync` | `eventbriteRoutes` | Import events/attendees | Team | events import modal | Eventbrite API |
| GET | `/api/integrations/zoho/status` | `zohoRoutes` | Zoho status | Signed in/team | Zoho page/settings | Zoho state/jobs |
| GET | `/api/integrations/zoho/connect` | `zohoRoutes` | Start OAuth | Signed in | Zoho page/settings | Zoho OAuth |
| GET | `/api/integrations/zoho/callback` | `zohoRoutes` | OAuth callback | Public callback with state | provider redirect | Zoho OAuth/session state |
| POST | `/api/integrations/zoho/sync` | `zohoRoutes` | Queue/resume sync job | Team | Zoho page | `integration_jobs`, Zoho API |
| GET | `/api/integrations/zoho/sync-status` | `zohoRoutes` | Job status | Signed in/team | Zoho page | `integration_jobs` |
| GET | `/api/integrations/zoho/records/page` | `zohoRoutes` | Paginated Zoho records | Signed in/team | Zoho page | `app_zoho_records` |
| GET | `/api/integrations/overview` | `integrationCentreRoutes` | Integration overview | Team | `WorkspaceProvider` polling | integration state/jobs |
| GET | `/api/integrations/:provider` | `integrationCentreRoutes` | Integration detail | Team | integration centre | state/jobs/audit |
| POST | `/api/integrations/control/:provider/sync` | `integrationCentreRoutes` | Generic sync trigger | Team | integration centre | provider-specific |
| GET | `/api/dashboard/*` | `dashboardRoutes` | Dashboard widgets | Signed in, owner scoped where applicable | dashboard/today pages | app tables |
| GET | `/api/search` | `dashboardRoutes` | Global search | Signed in/owner scoped | search UI | app tables |
| GET/POST/PATCH/DELETE | `/api/saved-views*` | `savedViewsRoutes` | Saved filters/views | Signed in | list pages | `app_saved_views` |
| GET | `/api/data-quality/*` | `dataQualityRoutes` | Data quality summary/issues | Team/admin-style pages | data quality | app tables/snapshot |
| GET | `/api/analytics/overview` | `analyticsRoutes` | Analytics | Team | analytics page | app tables |
| GET/PATCH/POST | `/api/notifications*` | `notificationsRoutes` | Notifications | Signed in | topbar/drawer | `app_notifications` |
| GET | `/api/documents` | `documentsRoutes` | Document list | Signed in | documents page | templates/application files |
| GET | `/api/admin-audit/*` | `adminAuditRoutes` | Admin/audit views | Team/admin | admin audit page | audit/jobs/users |

This table covers major APIs, not every small diagnostic or fallback route.
