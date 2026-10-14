# Testing

Tests are script-based. There is no Jest/Vitest test runner configured in `package.json`.

## Commands That Actually Exist

Core:

```bash
npm run check
npm run build
npm run ui:build
npm run ui:type-check
npm run ui:lint
npm run test:frontend
npm run test:security
```

Backend/domain audits:

```bash
npm run test:authorization
npm run test:automations
npm run test:admissions
npm run test:global-search
npm run test:saved-views
npm run test:data-quality
npm run test:integration-centre
npm run test:sync-persistence
npm run test:analytics
npm run test:notifications
npm run test:documents
npm run test:admin-audit
npm run test:final-qa
npm run test:my-day
npm run test:leads
npm run test:bootstrap
npm run test:dedupe
```

Integration-specific:

```bash
npm run test:zoho
npm run test:zoho:lifecycle
npm run test:zoho:async
npm run test:dashboard:dedupe
npm run test:rocket
npm run test:readdy-ui
```

DB/live diagnostics:

```bash
npm run test:leads:db
npm run test:bootstrap:db
npm run diagnose:api-latency
npm run diagnose:query-explain
npm run diagnose:my-day
npm run diagnose:lead-360
npm run diagnose:automations
npm run diagnose:admissions
npm run diagnose:global-search
npm run diagnose:data-quality
npm run diagnose:integrations
npm run diagnose:sync-persistence
npm run diagnose:analytics
npm run diagnose:email-inbox
npm run diagnose:email-regression
npm run diagnose:chrome-inbox
npm run diagnose:inbox-events
npm run diagnose:monitoring
npm run diagnose:monitoring:benchmark
```

## What The Main Tests Validate

- `test:frontend`: frontend startup audit and route smoke.
- `test:security`: static security smoke checks.
- `test:zoho`: static Zoho sync/config audit.
- `test:zoho:lifecycle`: Zoho lifecycle regression.
- `test:zoho:async`: async Zoho sync audit.
- `test:authorization`: authorization route/policy checks.
- `test:sync-persistence`: provider state/checkpoint persistence checks.
- `test:integration-centre`: integration overview/control behavior.
- `test:admin-audit`: admin/audit route behavior.
- `check`: syntax checks for `server.js` and `app.js`, many audit scripts, frontend tests, dedupe tests and TypeScript build.

## Minimum Tests Before PR

For small backend/frontend changes:

```bash
npm run test:frontend
npm run test:security
npm run build
```

For auth/permission changes:

```bash
npm run test:authorization
npm run test:security
```

For frontend source changes:

```bash
npm run ui:type-check
npm run ui:lint
npm run ui:build
npm run test:frontend
```

For integration/sync changes:

```bash
npm run test:integration-centre
npm run test:sync-persistence
npm run test:zoho
npm run test:zoho:lifecycle
npm run test:zoho:async
```

## Full Regression Suite

```bash
npm run check
```

`check` is long but is the closest thing to a full repository regression command.
