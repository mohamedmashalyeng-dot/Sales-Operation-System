# Current Roadmap

This is derived from `PROJECT_PLAN.md` plus current repository inspection.

## Status

Completed / monitor:

- Readdy-style React frontend exists under `frontend/` and builds to `frontend/out`.
- Node backend starts from `server.js`.
- Hostinger deployment path is documented as `server.js` + `npm start`.
- PostgreSQL/Neon is the intended production database path.
- Core smoke/security/frontend test commands exist.
- Zoho sync has durable async job architecture and throttle-related tests.

Ongoing:

- Security and reliability.
- Sync monitoring and rate-limit tuning.
- Frontend/request-count discipline.
- Hostinger env and callback verification after changes.

## Recommended First Developer Task

Add a small, read-only "data freshness" line to the integrations overview UI.

Why this is a good first task:

- Frontend: touches an existing integration/status component or page.
- API: uses existing `/api/integrations/overview`; no new provider calls.
- Database: reads existing integration state/job timestamps only.
- Tests: can run `test:frontend`, `test:integration-centre`, `test:security`.
- Risk: low; does not modify sync, auth or provider token logic.

Acceptance criteria:

- Shows last successful sync time per provider when available.
- Shows a neutral fallback when unknown.
- Does not trigger any sync.
- Does not add a new polling loop.
- Does not expose secrets or raw provider errors.

## Near-Term Work

1. Keep `.env.example`, `hostinger.env.example` and `server/config.js` aligned.
2. Confirm production `frontend/out` build/deploy ownership.
3. Add or update smoke checks for integration overview polling and no page-open full sync.
4. Audit Eventbrite/Zoom deletion behavior and document policy.
5. Normalize or further page large Zoom call storage if call volume grows.
6. Continue moving high-traffic workspace fallback routes to direct paginated SQL paths.

## Open Questions

- Is `sales.kentbusinesscollege.com` the permanent production OAuth domain?
- Who owns each provider account?
- Which env source does Hostinger actually use in production?
- Should Eventbrite and Zoom move to durable `integration_jobs` like Zoho?
- Is MongoDB support still required, or can docs/code narrow around PostgreSQL?
