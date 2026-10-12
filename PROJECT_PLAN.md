# Kent Business College Workspace Project Plan

Date: 2026-10-12

## 1. Project Overview

Kent Business College Workspace is a Node.js admissions and CRM workspace for managing leads, applications, email queues, events, meetings, tasks, reporting, and third-party integrations.

The current application combines:

- A Node.js backend started from `server.js`
- Modular backend code in `server/` and `server/routes/`
- A static production frontend built from `index.html`, `app.js`, `styles.css`, and `sw.js`
- Optional NestJS source modules in `src/`
- Local JSON storage for development and PostgreSQL or MongoDB support for production
- Integrations for Gmail, Zoom, Zoho, Eventbrite, and related admissions workflows

Recent UI work migrated the existing KBC interface to a Readdy-inspired visual system while preserving the real KBC data, routes, authentication, and backend behavior.

## 2. Project Goals

- Keep the KBC Workspace stable for daily admissions operations.
- Preserve real CRM, email, event, lead, and application workflows.
- Improve dashboard usability and visual consistency across pages.
- Keep startup performance and request counts under control.
- Maintain secure authentication, admin access, integrations, and deployment settings.
- Prepare the project for reliable Hostinger deployment using production database storage.

## 3. Current Status

Completed:

- Existing static frontend identified as the production UI layer.
- Readdy-inspired visual system applied to the current frontend.
- Dashboard, sidebar, topbar, cards, filters, tables, forms, and modals restyled.
- Real KBC navigation labels, routes, users, and API data preserved.
- Frontend and service-worker cache keys updated after UI changes.
- Security and frontend smoke tests documented as passing in the migration report.

Key files:

- `README.md`
- `server.js`
- `server/`
- `server/routes/`
- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `sql/`
- `scripts/`
- `READDY_UI_MIGRATION_REPORT.md`
- `PIXEL_PERFECT_READDY_PORT_REPORT.md`

## 4. Scope

### In Scope

- Admissions dashboard and monitoring views
- Leads, applications, inbox, tasks, events, meetings, and calls
- Admin dashboard and reporting surfaces
- Gmail, Zoom, Zoho, Eventbrite, and database integrations
- Local development setup
- Hostinger deployment readiness
- Frontend styling consistency and responsiveness
- Smoke tests, security tests, and deployment checks

### Out of Scope

- Replacing the current static frontend with a React or Tailwind runtime
- Importing mock Readdy data into production workflows
- Rewriting backend modules without a specific business or technical need
- Uploading local `.env`, `node_modules`, database backups, or private credentials

## 5. Delivery Phases

### Phase 1: Baseline Review

Objectives:

- Confirm current app structure and environment requirements.
- Verify local run instructions.
- Review existing reports and known differences from the Readdy reference.
- Confirm active storage mode for development and production.

Deliverables:

- Updated project documentation where needed
- Confirmed local startup path
- Confirmed test commands
- List of known production configuration requirements

Acceptance criteria:

- `npm install` and `npm start` are documented and usable.
- `/api/health` returns the expected storage mode.
- Required environment variables are clearly listed.

### Phase 2: UI Stabilization

Objectives:

- Keep the Readdy-inspired UI consistent across all major pages.
- Remove style drift and duplicate overrides.
- Validate responsive behavior on desktop, tablet, and mobile.
- Preserve existing workflows while improving page polish.

Deliverables:

- Stable `styles.css` token layer
- Consistent buttons, cards, tables, filters, modals, and badges
- Screenshot verification for dashboard and key workflows

Acceptance criteria:

- No visible layout breakage on common screen sizes.
- Tables remain usable on small screens.
- Existing routes and actions still work after style changes.

### Phase 3: Data And Workflow Validation

Objectives:

- Validate live data paths used by dashboards and workflow pages.
- Confirm leads, applications, tasks, inbox, events, and admin metrics still load correctly.
- Check pagination, search, filtering, sorting, forms, and notifications.

Deliverables:

- Workflow smoke test notes
- Any required bug fixes for broken API calls or stale UI states
- Confirmed no mock data is shown in production workflows

Acceptance criteria:

- Dashboard metrics load from existing APIs.
- Leads and applications can be viewed and updated.
- Inbox and task workflows remain functional.
- Admin monitoring pages show real operational data.

### Phase 4: Integration Readiness

Objectives:

- Confirm production configuration for Gmail, Zoom, Zoho, Eventbrite, and database storage.
- Ensure OAuth redirect URLs match deployment domain settings.
- Validate integration error handling and admin visibility.

Deliverables:

- Environment variable checklist
- Integration setup notes
- Health-check and diagnostic script results

Acceptance criteria:

- Required OAuth callback URLs are configured.
- Missing credentials fail clearly and safely.
- Integration status is visible to admins.

### Phase 5: Security And Reliability

Objectives:

- Keep authentication, admin access, password reset, and session behavior secure.
- Run existing frontend and security smoke tests.
- Review deployment settings for secrets and local files.

Deliverables:

- Security smoke test results
- Deployment checklist
- Any required hardening fixes

Acceptance criteria:

- `npm run test:frontend` passes.
- `npm run test:security` passes.
- Production secrets are stored outside the repository.
- `.env`, local databases, and `node_modules` are not deployed as public files.

### Phase 6: Deployment

Objectives:

- Deploy the Node.js app to Hostinger or the selected production host.
- Configure production environment variables.
- Verify database storage and health endpoint.
- Confirm cache refresh after frontend updates.

Deliverables:

- Live deployment
- Production health-check result
- Post-deployment smoke test result
- Rollback notes

Acceptance criteria:

- App starts with `npm start`.
- Node.js version is `20` or newer.
- `/api/health` returns healthy JSON.
- Admin login and core workflows work on the production domain.

## 6. Suggested Timeline

| Phase | Estimated Duration | Owner |
| --- | ---: | --- |
| Baseline review | 0.5 day | Developer |
| UI stabilization | 1-2 days | Developer |
| Data and workflow validation | 1 day | Developer / Admin user |
| Integration readiness | 1 day | Developer / Account owner |
| Security and reliability | 0.5-1 day | Developer |
| Deployment and verification | 0.5-1 day | Developer / Host owner |

## 7. Testing Plan

Run before release:

```bash
node --check app.js
node --check sw.js
npm run test:frontend
npm run test:security
```

Recommended manual checks:

- Login and logout
- Dashboard load
- Leads list, search, filter, and detail view
- Applications workflow
- Inbox workflow
- Tasks workflow
- Events and meetings pages
- Admin dashboard and monitoring pages
- Mobile navigation
- Offline/service-worker refresh behavior
- `/api/health`

## 8. Deployment Checklist

- Use Node.js `20` or newer.
- Set startup file to `server.js`.
- Set start command to `npm start`.
- Install production dependencies with `npm ci --omit=dev`.
- Configure production environment variables in the hosting panel.
- Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` before first start.
- Configure production `DATABASE_URL`.
- Configure OAuth redirect URLs for the production domain.
- Confirm `.env`, `node_modules`, local database files, and backups are not uploaded publicly.
- Visit `/api/health` after deployment.
- Run a short smoke test on the live domain.

## 9. Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Missing production environment variables | App or integrations fail at runtime | Use the deployment checklist before launch |
| OAuth redirect mismatch | Gmail, Zoom, or Eventbrite login fails | Match provider settings to production callback URLs |
| Browser serves old cached frontend | Users see stale UI or service worker behavior | Bump cache keys after frontend changes |
| Local JSON storage used in production | Data reliability and scaling issues | Configure PostgreSQL or MongoDB before launch |
| UI overrides drift over time | Inconsistent pages and hard-to-debug styling | Keep shared tokens and final scoped CSS layers documented |
| Uploading private files | Security exposure | Never deploy `.env`, backups, or local database files publicly |

## 10. Open Questions

- What is the final production domain?
- Which production database provider will be used?
- Who owns each OAuth provider account?
- Are there any additional admin roles or permission levels required?
- What reporting metrics matter most for admissions leadership?
- What is the expected launch date?

## 11. Next Actions

1. Confirm production domain and hosting account.
2. Confirm production database choice and connection string.
3. Review environment variables against `.env.example` and `hostinger.env.example`.
4. Run the frontend and security test suites.
5. Complete a manual smoke test on the main workflows.
6. Deploy to Hostinger.
7. Verify `/api/health` and admin workflows on production.
