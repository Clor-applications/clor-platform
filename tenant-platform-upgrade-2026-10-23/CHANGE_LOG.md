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
- A-04 fixed: `setup-company` needs the account's first company or an administrator of one of its companies. Application behavior changed: yes. Schema: no.
- ADR-010 accepted: company administration moves to a platform workspace on `app.clor.in` (Batch 1.5, after Batch 1).
- A-05 fixed: changing a person's company access needs the caller's Users EDIT in every company touched (admin where the person is admin); removal also deletes branch and warehouse grants. Application behavior changed: yes. Schema: no.
- A-07 fixed: rate-limit buckets keyed by a hash of the whole credential instead of its first characters. Application behavior changed: yes (no shared 429s across tenants). Schema: no.
- A-06 fixed: atomic refresh rotation with a 10-second tab-race grace (409 `refresh_raced`, client retries once), `/refresh` rate limit, atomic reset/verify token use. Application behavior changed: yes (front-end `packages/platform/http.js` retry). Schema: no.
- A-08/A-09/A-10 fixed: 5 s session-liveness cache; membership account checked against the company; HS256 pinned, SSO token audiences, `/auth/me` echo only for member companies, 2FA turn-off needs a code (UI field added). Application behavior changed: yes. Schema: no. Batch 1 complete except the deferred signup enumeration item.
- Batch 1.5 (W-01..W-04): Company admin workspace (`apps/admin`). The front door opens it; every app's switcher reaches it; users, roles, permissions, sign-in, SSO, audit, branches, account, billing, data export and close-company moved out of Accounting (API clients to `@platform/admin`); Accounting/People/Attendance link to it and old keys redirect. Front-end only; no API change. Pre-existing web test failures recorded: 57 on the untouched main checkout, unchanged by this work.
- W-04b/W-05: permissions grouped by app with per-app "Roles & Access"; one audit trail with per-app shares (server `app=` filter extended), Attendance/People audit screens open it. API keys deferred to Batch 5 (credential registry). Application behavior changed: yes (front end; audit filter API gained values). Schema: no.
- A-11 fixed: one `appLive` check on every non-human entry point (portal, API keys, connectors, readers, SCIM, share and payment links). Application behavior changed: yes. Schema: no. Local dev DB brought up to the committed People migrations.
- A-12 fixed: atomic approval claim (409 for the loser), 402 without Accounting, failed posting reopens the request. Application behavior changed: yes. Schema: no.
- A-13 fixed: maker-checker with a company setting (AUTO/STRICT/ALLOW) on pay runs, salary revisions, adjustments, tax verify, bank changes and leave; never approving one's own pay; status-guarded transitions. Application behavior changed: yes. **Schema: yes** — platform `AuthPolicy.makerChecker` (migration `20261023180000_maker_checker_policy`, default `AUTO`; applied locally).
- A-14 fixed: subscription ceiling in `authorize()` for every app's modules; `requireApp.ts` removed. Application behavior changed: yes. Schema: no.
- Batches 6 (background jobs) and 7 (route manifest) run in parallel sessions on their own branches (evidence IDs EV-100..149 and EV-150..199).
- A-15 fixed: app guards answer 402 (not bought) before 403 (switched off). Application behavior changed: yes (status code for unowned apps). Schema: no.

Running totals for 2026-10-23:  
Application behavior changed: yes (GAP-002, GAP-003, A-03, A-01, A-02, A-04, A-05, A-07, A-06, A-08, A-09, A-10, A-11, A-12, A-13, A-14, A-15).  
Database schema changed: yes (platform `Account.legacyUnrestrictedAt`; platform `AuthPolicy.makerChecker`; applied locally only).  
Deployment or Cloudflare configuration changed: no.  
Customer data accessed: no (local test accounts only).

