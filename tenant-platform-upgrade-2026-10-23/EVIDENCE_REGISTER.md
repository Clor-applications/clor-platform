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

