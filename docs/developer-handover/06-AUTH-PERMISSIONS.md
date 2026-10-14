# Authentication And Permissions

## Authentication

Authentication is implemented in `server/auth.js`.

- Passwords are hashed with PBKDF2 SHA-256.
- Sessions use an HTTP-only `sid` cookie.
- PostgreSQL sessions are stored in `app_sessions`.
- Session rows include `token_hash`, expiry, OAuth state fields and timestamps.
- Local JSON/no-DB mode uses in-memory sessions.
- `SESSION_TTL` is 8 hours.
- Password reset tokens are stored hashed in `app_password_resets`.

## Login Flow

1. `POST /api/login` finds the user by normalized email.
2. Auth throttling guards repeated attempts.
3. Password is verified against `password_hash`.
4. A session is created and returned as a cookie from `Auth.sessionCookie`.
5. Later protected API routes call `Auth.currentSessionUser`.

## Roles

`Auth.permissionsForUser(user)` is the runtime permission source.

- Configured developer account: `{ sales: true, review: true, admin: true, developer: true }`.
- `manager`/`admin` canonical roles: sales + review, but not developer unless the email is configured as developer.
- `sales`/member: sales only.

Visible labels:

- `admin` canonical role appears as Developer.
- `manager` canonical role appears as Monitor.
- `sales` appears as Member.

Only the configured developer email can hold Developer/admin behavior in user management.

## Authorization

Record-level authorization is centralized in `server/authorization.js`.

Team users:

- Developer/Monitor-style users can access team records.
- `Authorization.requireTeam(user)` is required for imports, syncs, reviews, deletes, audit and org-wide reports.

Member users:

- Lists are forced through `Authorization.ownerFilter(user, requested)`.
- Writes are forced through `Authorization.ownerForWrite(user, requested)`.
- Individual records are checked through `Authorization.requireRecord(user, entity, id)`.
- `requireRecord` checks ownership directly in PostgreSQL when possible.

Protected fields rejected by route handlers:

- `deleted_at`
- `deleted_by`
- `created_by`
- `role`
- `permissions`
- `password_hash`
- `zoho_record_id`
- `crm_id`

## Record Ownership Rules

Owner checks cover:

- `lead`: `app_leads.owner_id`.
- `task`: task owner or linked lead owner.
- `application`: linked lead owner.
- `email`: linked lead owner.
- `attendee`: attendee's linked lead owner.
- `evidence`: application's linked lead owner.

## Admin/Developer Access

`Auth.requireDeveloperAccess(req, user)` is required for developer-only diagnostics such as debug timings and DB ping. Developer access depends on configured developer email, not just the role string.

## Rules New Developers Must Not Bypass

- Do not read or mutate a record route without `requireRecord` or an equivalent owner-scoped SQL filter.
- Do not trust `owner_id` from request bodies for members; pass it through `ownerForWrite`.
- Do not add new admin routes with only "signed in" checks.
- Do not return `password_hash`, session IDs, token hashes, access tokens, refresh tokens or OAuth state.
- Do not allow arbitrary role changes to Developer/admin; keep configured developer account constraints.
- Do not skip `Authorization.rejectProtectedFields` on create/update routes that accept user-provided record fields.
