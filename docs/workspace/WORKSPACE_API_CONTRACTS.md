# Workspace API contracts

All under `/api`, with `Authorization: Bearer`, `x-org-id` (the account is the one owning that company) unless marked public. Errors are `{ error, code }`.

| Method & path | Body / query | Returns | Codes |
|---|---|---|---|
| GET `/account/me` | | `{ accountId, role, companyAdmin, apps[] }` | |
| GET `/account/members` | | `{ members[] }` (account roles) | ACCOUNT_ROLE_REQUIRED |
| GET `/account/members/directory` | | `{ companies[], members[{ userId, name, email, accountRole, status, authenticator, companies[{ orgId, name, isAdmin, roles[], apps[] }] }] }` | ACCOUNT_ROLE_REQUIRED |
| GET `/account/members/:userId/access` | | effective access per company (roles with via/grantedBy/grantedAt, apps, branches, sensitive) | NOT_A_MEMBER |
| PUT `/account/members/:userId/role` | `{ role }` (+ `x-step-up` for owner changes) | `{ changed, role }` | BAD_ROLE, ACCOUNT_OWNER_ONLY, LAST_ACCOUNT_OWNER, STEP_UP_REQUIRED, TWO_FACTOR_SETUP_REQUIRED |
| POST `/account/members/:userId/suspend` \| `/reinstate` | | `{ changed, status }` | SELF, ACCOUNT_OWNER_ONLY, LAST_ACCOUNT_OWNER |
| DELETE `/account/members/:userId/companies/:orgId` | | `{ removed }` | NOT_IN_COMPANY, LAST_COMPANY_ADMIN |
| POST `/account/members/:userId/sign-out` | | `{ revoked }` | SELF, ACCOUNT_OWNER_ONLY |
| GET `/account/invitations` | | `{ invitations[] }` (never the token) | |
| POST `/account/invitations` | `{ email, accountRole, grants[{ orgId, branchIds?, roleIds? }] }` | `{ invitation, seatWarning }` | BAD_EMAIL, BAD_ROLE, OTHER_ACCOUNT, ALREADY_MEMBER, FOREIGN_COMPANY, FOREIGN_BRANCH, FOREIGN_ROLE, ABOVE_AUTHORITY |
| POST `/account/invitations/:id/resend` \| `/revoke` | | | NOT_FOUND, NOT_PENDING |
| POST `/invitations/preview` (public) | `{ token }` | `{ email, accountName, companies[], accountRole, invitedBy, expiresAt, hasLogin }` | INVALID_TOKEN, EXPIRED, REVOKED, ALREADY_ACCEPTED |
| POST `/invitations/accept` (public, rate-limited) | `{ token, fullName, password }` | `{ accepted, email, created }` | SIGN_IN_REQUIRED, USER_LIMIT, QUOTA_BUSY, ALREADY_ACCEPTED |
| POST `/invitations/accept-signed-in` | `{ token }` | | WRONG_PERSON, OTHER_ACCOUNT |
| GET `/account/audit` | `action, result, actor, from, to, cursor, limit` | `{ events[], next }` | |
| PATCH `/account` | `{ name }` | `{ account }` | BAD_NAME |
| GET `/auth/me` | | adds `accountRole`, `accounts[{ id, name, code, home, role }]` | |
