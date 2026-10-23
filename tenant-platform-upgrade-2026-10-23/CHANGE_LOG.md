# Upgrade Change Log

## 2026-10-23 — TP-00 baseline started

Changed:

- Created this independent upgrade/evidence folder.
- Recorded the exact Git baseline and existing dirty worktree state.
- Added a reproducible source route inventory generator.
- Generated `evidence/route-inventory.csv` with 662 endpoint declarations.
- Documented current identity, tenant, authorization, entitlement, database, RLS, worker and trust-boundary evidence.
- Created a prioritized gap register, test plan and decision log.
- Ran server type checking successfully.
- Ran the focused tenant/platform baseline: 8 test files and 79 tests passed.
- Recorded a test-quality gap where one RLS insert case can be rejected by Prisma input validation before PostgreSQL RLS.
- Fixed that test gap by supplying a valid warehouse code and requiring an RLS-policy error; the focused RLS suite passes 9/9 and PostgreSQL reports SQLSTATE 42501.
- Completed GAP-002: Accounting plan features are intersected with subscription ownership, and the shared RBAC path blocks direct Accounting API access after app removal.
- Added regression tests for effective feature removal and direct API denial; typecheck and 19 targeted tests pass.
- Completed GAP-003: subscription provisioning is now explicit and fail-closed.
  - Platform migration `20261023100000_explicit_subscription_default` adds `Account.legacyUnrestrictedAt` and marks exactly the accounts that predate subscriptions, so their historical access survives the new rule.
  - `appAccess` fails closed for any unmarked account without a subscription; only the grandfather marker can open it.
  - `/signup` provisions the account, the user and an explicit bootstrap subscription (all four sellable apps) inside one transaction; there is exactly one account-creation path in production code.
  - `setup-company` switches the new organization's feature settings on for apps the account owns, because with bootstrap provisioning nothing "changes" the subscription after signup and `syncAppSwitches` would otherwise leave apps at the catalog default.
  - Required updates to 11 suites where tests modelled "app not bought" as the catalog default; those tests now turn the apps off explicitly, documenting that "off" is a customer choice under the new provisioning.
  - Added evidence tests: signup must carry an active subscription with exactly the four sellable app items and `legacyUnrestrictedAt` null; a grandfathered account without a subscription keeps all sellable apps; an unmarked account without a subscription fails closed.
  - Database schema changed: platform `Account` column + that migration applied locally. Application behavior changed: new signups get an explicit subscription row (previously none).

## 2026-10-23 — Architecture audit and Batch 1

- Read-only architecture audit (`ARCHITECTURE_AUDIT_2026-10-23.md`, 49 findings), research review (`RESEARCH_REVIEW.md`) and per-finding checklist (`FIX_CHECKLIST.md`).
- A-03 fixed: `/api/auth` `sessions`, `sessions/revoke-all`, `me` (GET/PATCH), `setup-company` and `resend-verification` now use the live-session middleware; a revoked session or deactivated user gets 401. Removed the unused local `signToken`/`requireAuth`. Application behavior changed: yes (those six routes). Schema: no.
- A-01 fixed: identity changes (email, password, active) to another person need Users EDIT in every company they work in and admin wherever they are admin; SCIM may change email/active only for single-company non-admins and now clears email verification on change. Application behavior changed: yes. Schema: no.
- A-02 fixed: adding a user attaches an existing login from another account only once its email is confirmed. Application behavior changed: yes (a CA or other outsider must confirm their email before being added). Schema: no.

Running totals for 2026-10-23:  
Application behavior changed: yes (GAP-002, GAP-003, A-03, A-01, A-02).  
Database schema changed: yes (platform `Account.legacyUnrestrictedAt`, applied locally only).  
Deployment or Cloudflare configuration changed: no.  
Customer data accessed: no (local test accounts only).

