# Evidence Register

Updated: 2026-10-23

| Evidence ID | Claim supported | Source or command | Result |
|---|---|---|---|
| EV-001 | Baseline commit | `git rev-parse HEAD` | `1b8eaecbe6ed495547da718b12a39af1738140aa` |
| EV-002 | Baseline branch/remote | `git branch --show-current`; `git remote get-url origin` | `main`; `https://github.com/Clor-applications/clor-platform.git` |
| EV-003 | Current worktree is not clean | `git status --short` | Existing modified/untracked People, Attendance, Payroll, docs and skill files; preserved and not attributed to TP-00 |
| EV-004 | HTTP surface size | `node tenant-platform-upgrade-2026-10-23/scripts/inventory-routes.mjs` | 662 route declarations; CSV generated with source line and preliminary principal classification |
| EV-005 | Four logical Prisma clients exist | `server/src/utils/{prisma,platformPrisma,peoplePrisma,payrollPrisma}.ts` | Accounting, Platform, People and Payroll clients are distinct in source |
| EV-006 | Readiness probes all four clients | `server/src/app.ts:283-305` | `/ready` queries all four clients and fails readiness when any does not answer |
| EV-007 | Effective tenant account comes from membership | `server/src/middleware/tenantContext.ts:35-50` | Token account is treated as home; organization membership supplies working account |
| EV-008 | Global login identity | `server/prisma/platform/schema.prisma:145-213` | User email is globally unique; User has stable ID and home account ID |
| EV-009 | Organization access relation | `server/prisma/platform/schema.prisma:215-228` | Membership binds account, org and user with a composite unique constraint |
| EV-010 | Request database context | `server/src/utils/tenantScope.ts:61-136` | AsyncLocalStorage propagates org; Prisma wrapper sets `clor.org_id` transaction-locally |
| EV-011 | RLS artifacts exist | `rg 'ENABLE ROW LEVEL SECURITY|CREATE POLICY' server/prisma` | RLS migrations exist across Accounting, Platform, People and Payroll schemas |
| EV-012 | Subscription default is open | `server/src/services/subscriptions.ts:46-82` | An account without a subscription gets every sellable app |
| EV-013 | Accounting entitlement bridge can remain FULL | `server/src/services/subscriptions.ts:188-205` | Removing Accounting returns without closing the legacy entitlement row |
| EV-014 | Background processes share API process | `server/src/index.ts:40-65` | Recurring invoices, device sync, purges, HR sync, notifications, digest, reminders, webhooks and reports start in-process |
| EV-015 | Separate non-human surfaces exist | `server/src/app.ts:198-237` | Readers, ingest, Matrix, Hikvision, SCIM, public API, agent and pay pages use credentials other than normal user sessions |
| EV-016 | Focused platform tests | `evidence/test-results.txt` | Typecheck passed; 8 test files and 79 tests passed |
| EV-017 | Signup provisions an explicit subscription, never legacy access | `server/src/__tests__/modules.test.ts` (signup test), `server/src/routes/auth.ts` `/signup` transaction | Active subscription with exactly the 4 sellable app items (no `projects`); `Account.legacyUnrestrictedAt` is null for new accounts |
| EV-018 | Grandfather rule is explicit, not ambient | Migration `20261023100000_explicit_subscription_default`; `server/src/services/subscriptions.ts` `appAccess`; `server/src/__tests__/businessModel.test.ts` | Accounts without a subscription fail closed unless marked; a marked grandfathered account keeps all sellable apps; 162 files / 1509 tests pass after the 11 provisioning-model updates |
| EV-019 | A-03: the six `/api/auth` account routes refuse a revoked session and a deactivated user | `server/src/__tests__/identityAndSessions.test.ts` ("is refused by the account routes …"); `evidence/A-03/before-fix.txt`, `after-fix.txt`; browser: `evidence/A-03/1-…jpg`, `3-…jpg`, `5-browser-revoked-token-calls.json` | Before fix: `expected 200 to be 401` (2 tests fail). After fix: 13/13 pass. Browser: kept token after second-device revoke-all gets `401 session_ended` on all six routes; the app signs itself out |
| EV-020 | Full server suite after GAP-002/003/013 port | `npx vitest run` (server) | 160 files / 1505 tests pass; the only 2 failures were the A-03 tests run while the pre-fix code was swapped in for EV-019 |
| EV-021 | A-01: an admin of one company cannot take over the sign-in of someone who works in another company | `identityAndSessions.test.ts` › "an administrator of a sibling company"; `evidence/A-01/before-fix.txt`, `after-fix.txt`, `1-…jpg`, `2-browser-network.json`; 24 user/SCIM suites | Before: X admin's PATCH email / POST password returned 200 and signed the owner out (3 fail). After: 16/16 pass; 24 files / 239 tests pass; browser PATCH → 403 `identity_elsewhere`, owner login 200 |
| EV-022 | A-02: an unconfirmed self-registered login cannot inherit an invitation | `globalIdentity.test.ts`; `evidence/A-02/before-fix.txt` (expected 201 to be 409), `after-fix.txt` (12/12); regression: 140 files / 1258 tests, only failure the displayCodes CA invite (fixed by confirming the CA, 11/11); browser `1-…jpg`, `2-browser-network.json` | Before: squatter attached (201). After: 409 `unverified_identity`, no membership or role |
| EV-023 | A-04: only an account administrator (or the first-company signup) can create a company | `identityAndSessions.test.ts` › "adding a company"; `evidence/A-04/before-fix.txt` (expected 200 to be 403), `after-fix.txt` (18/18); browser `1-…jpg`, `2-browser-direct-call.json` | Before: clerk created a company and became its Administrator. After: 403 `NOT_ACCOUNT_ADMIN`; owner can still add companies; full server suite 161 files / 1513 tests pass |
| EV-024 | A-05: company access changes need the caller's rights in each company; removal clears branch/warehouse grants | `userCompanies.test.ts`; `evidence/A-05/before-fix.txt` (expected 200 to be 403; expected 1 to be 0), `after-fix.txt` (8/8); 138 files / 1255 tests; browser `1-…jpg`, `2-…jpg`, `3-browser-network.json` | Before: an admin of one company added herself to another. After: 403 `not_your_company`; `/auth/me` lists only her company |
| EV-025 | A-07: every session and machine credential has its own rate-limit bucket | `apiRateLimit.test.ts`; `evidence/A-07/before-fix.txt` (expected 429 not to be 429), `after-fix.txt` (limiter, store, auth-hardening, iclock, agent suites: 5 files / 58 tests) | Before: two different JWTs shared one bucket. After: separate buckets |
| EV-026 | A-06: concurrent refreshes cannot fork a session, and a tab race no longer signs the user out | `authHardening.test.ts`; `evidence/A-06/before-fix.txt` (3 runs: expected [200, 401] to equal [200, 409]), `after-fix.txt` (17/17); web platform/shell tests 19/19; full server suite 161 files / 1517 tests; browser `1-browser-race.json`, `2-…jpg` | Before: the losing tab revoked every session. After: one winner, loser retries and stays signed in |
| EV-027 | A-08/A-09/A-10 (full server suite 161 files / 1521 tests; web 50 files / 333 tests) | `evidence/A-08/`, `A-09/`, `A-10/` before-fix and after-fix files; browser `A-10/1-…jpg`, `2-…jpg`, `3-browser.json` | A-08 before: revoked session 200 after 5.5 s → 401. A-09 before: forged membership 200 → 403. A-10 before: HS512 token 200, stranger org echoed, password-only 2FA disable 200 → all refused |
| EV-028 | Company admin workspace (ADR-010, W-01..W-04) | `packages/shell/registry.test.js`, `appHosts.test.js`; web suite `evidence/W-01..04/web-suite-after.txt` (192 files / 1528 tests: 57 failing, all present on the untouched main checkout — `web-baseline-failures-main-checkout.txt`; 0 new); lint 0 errors; `vite build` ok; browser screenshots 1–5 | Workspace reachable from every app, holds the company administration, old Accounting links redirect, Accounting Settings trimmed |
| EV-029 | W-04b: app-level roles in one editor | browser `evidence/W-01..04/6-payroll-roles-access-filtered.jpg` (URL `?open=permissions&for=payroll&app=admin`, tabs All/Company/Accounting/People/Attendance/Payroll*, only the Payroll section); web suite: no failure outside the main-checkout baseline; build ok |
| EV-030 | W-05: one audit trail with per-app shares | `audit.test.ts`; `evidence/W-05/before-fix.txt` (old server rejects the new filter), `after-fix.txt`; browser `1-…jpg`, `2-…jpg`; web tests in touched areas: no failure outside the main-checkout baseline; build ok |
| EV-031 | A-11: no non-human path outlives the subscription or a scheduled closure | `principalAllowed.test.ts`; `evidence/A-11/before-fix.txt` (3 fail: 200 where 402/403 expected), `after-fix.txt`; full server suite 162 files / 1526 tests; browser `1-…`, `2-…`, `3-portal-refusal-in-plain-words.jpg`. Local dev DB: five People migrations already on main were applied (`prisma migrate deploy`, local only) so the dev server could create employees |
| EV-032 | A-12: an invoice is approved and posted once (full server suite 163 files / 1528 tests) | `approvalRace.test.ts`; `evidence/A-12/race-probe-before.txt` (DOUBLES 9 of 10) vs `race-probe-after.txt` (0); live `2-live-double-approve.json` (200, 409) and `2-live-journal-rows.json` (one POSTED entry); browser `1-…`, `1b-…`, `3-approved-once.jpg` |
| EV-033 | A-13: separation of duties, per company setting; never about oneself (full server suite 164 files / 1533 tests) | `makerChecker.test.ts`; `evidence/A-13/before-fix.txt` (5 fail), `after-fix.txt` (9 pass incl. integrationsV2); browser `1-policy-…jpg`, `2-preparer-refused.jpg`, `4-approved-by-second-admin.png`; live `3-live-two-approvers.json` (403 preparer, 200 second admin). Local dev DB: new platform migration applied |

## Evidence quality note

The initial RLS negative insert omitted `Warehouse.code` and could stop at Prisma validation. The test was corrected and strengthened. The focused rerun proves PostgreSQL rejected the valid-shaped cross-tenant insert with SQLSTATE `42501` and a row-level-security policy violation.

## Reproduction

```bash
node tenant-platform-upgrade-2026-10-23/scripts/inventory-routes.mjs
cd server
npm run typecheck
npx vitest run src/__tests__/tenantIsolation.test.ts src/__tests__/rowLevelSecurity.test.ts src/__tests__/tenantScope.test.ts src/__tests__/globalIdentity.test.ts src/__tests__/identityAndSessions.test.ts src/__tests__/permissions.test.ts src/__tests__/entitlements.test.ts src/__tests__/billingOperator.test.ts
```

Secrets, connection strings, raw tokens, customer data, and private endpoint values must never be copied into this folder.

