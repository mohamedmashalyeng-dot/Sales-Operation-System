# Workspace access rules

The signed-in account supplies its identity and stored role. Email matching is normalized to lowercase. Roles cannot be changed through the browser profile, local storage, URL parameters or request headers.

| Account | Role | Record scope |
| --- | --- | --- |
| office@kentbusinesscollege.com | Manager | Team records |
| office@kentbusinesscollege.org | Staff Enrollment (`enrolment`) | Assigned records only |
| sales@kentbusinesscollege.com | Staff Sales (`sales`) | Assigned records only |

| Action | Manager | Staff Sales | Staff Enrollment |
| --- | --- | --- | --- |
| Leads, messages, documents, call history, follow-ups | Team | Own | Own |
| Create sales leads | Yes | Own | No |
| Prepare applications and upload evidence | Team | Own | Own |
| Review evidence, verify contracts, approve and enrol | Team | No | Own |
| Assign another owner | Yes | No | No |
| Team Events/People and Zoom directory/overview | Yes | No | No |
| View individual linked calls and meeting summaries | Team | Own lead | Own lead |
| Team reports and audit | Yes | No | No |
| Create accounts, change roles or reset other passwords | Developer only | No | No |
| Full workspace snapshot | Developer only | No | No |
| Change own password and sign out | Yes | Yes | Yes |

Staff ownership is enforced on the server before returning or changing individual records, including direct links, related records and evidence downloads. List and dashboard filters cannot broaden a staff account's owner scope. Applications, email and evidence inherit the linked lead's ownership; tasks may also be assigned directly to the user. A manager can hand work over by assigning its lead. New staff accounts receive no existing records automatically.

Staff cannot obtain other users through bootstrap, inspect all event participants, create themselves as manager, or bypass enrolment approval with an `already_enrolled` creation flag or a direct Enrolled stage change. Unclassified API routes deny staff by default. The configured developer remains the only account with developer/user-administration access.

Sign out revokes the backend session, clears browser workspace data and reloads the document. Login reloads the document to discard requests from the previous identity. Session expiry hides cached records; account changes are broadcast to other tabs, and restored browser-history pages refresh their session. Password changes invalidate the account's sessions. Role changes invalidate its existing sessions.

`node scripts/provision-workspace-accounts.js` previews the three requested accounts. `--apply` creates missing accounts with independent random passwords, updates requested roles without overwriting existing passwords or ownership, and invalidates sessions after a role change. New passwords are written to a private temporary file outside the repository and are never printed or emailed. Change them through Settings > Profile after signing in.

Validation: isolated HTTP authorization tests cover staff isolation, ownership override attempts, restricted routes, enrolment capabilities, account management, session revocation, password changes, and forged identity headers. Browser checks cover server-assigned roles, locked role display, direct URL restrictions, tampered local role preferences, actual sign out and login as a different role.

These rules take effect in a running server only after loading the updated backend and matching frontend. Account records in the configured database do not update code on an existing hosted deployment. Local implementation and verification do not publish the site.

## Activation and verification — 15 October 2026

All three requested accounts were absent and were created in the configured PostgreSQL workspace with separate random passwords and the roles above. Existing accounts and customer ownership were preserved. No email was sent. New staff initially have no assigned leads.

226 isolated authorization checks, 78 actual isolated call/Planner HTTP checks, the frontend type-check/build and the shell audit passed. Browser checks verified locked Sales/Enrollment roles, rejection of a tampered local role, restricted direct URLs, real logout and login as another role without retaining the earlier identity. Lead-related meeting previews omit participant arrays/provider secrets, and resolved merged lead details are authorized against their master before return.

31 checks against the running local server and configured database verified actual login for all three accounts, normalized email matching, stored roles despite a forged login role, manager visibility, staff owner-filter and direct-ID isolation, self-only bootstrap account lookups, denied team participant/Zoom endpoints and denied developer snapshots. Verification sessions were logged out afterwards; zero customer records were modified. The local server was restarted with the matching UI build. The hosted deployment was not changed.

## Local account login — 15 October 2026

Added a direct `/login` page and a Switch account action alongside Sign out. The login page explains Manager, Staff Sales and Staff Enrollment access, supports showing/hiding the entered password and reports connection failures with Retry. It submits only email/password; role and record scope always come from the authenticated account. Login validates the response identity and verifies the session cookie through bootstrap before opening the workspace. A missing/invalid session is shown as a sign-in error instead of a successful login followed by another login screen.

Successful account switches revoke the previous browser session. Incorrect passwords preserve the current session and other browser sessions remain valid. Stored unsupported roles are rejected before a new session is created. Existing passwords and account roles were preserved.

All three requested accounts authenticated successfully through the actual localhost:3000 API with their stored Manager, Enrollment and Sales roles. An independent service on localhost:3001 serves a different application and was not modified; the user confirmed localhost:3000 as the target. Isolated authorization tests passed 245 checks, including mixed-case emails, forged login roles, unsuccessful/successful account switching, old-session revocation and independent sessions. Frontend type-check/build, existing browser workflows and served-build verification passed. Changes remain local; no Hostinger deployment performed.

Real browser verification also passed for all three accounts on localhost:3000: the Manager opened Today, Enrollment opened Applications and Sales opened Leads. Each session retained the correct role after a full browser reload. Verification used a separate temporary browser profile and the existing private credentials file; no passwords, cookies or customer data were printed, and the verification session was logged out afterwards.
