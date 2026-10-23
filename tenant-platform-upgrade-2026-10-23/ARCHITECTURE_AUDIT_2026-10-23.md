# CLOR Architecture Audit — 2026-10-23

Read-only audit of the whole platform before any further change (user instruction, 2026-10-23).
Baseline: `main` @ `1b8eaec` plus the GAP-002/003/013 working-tree changes.
Method: six parallel source audits (identity/sessions, authorization/routes, machine credentials, background workers, data boundary/RLS, front-end tenancy), each citing `file:line`. No HTTP calls, no database access, no production access.

`VERIFIED` = code read proves it. `SUSPECTED` = likely from code, needs runtime proof. `LIVE` = can only be proven against the deployed environment.

Each finding has an ID `A-nn`. `FIX_CHECKLIST.md` tracks the fix, test and evidence for each one. The research cross-reference (`AC-`, `INT-`, `OPS-`) is to `/Users/suresh/Desktop/Clor R&D/10_MIGRATION_AND_TEST_PLAN.md`.

## 1. What is already solid

- The access token is checked on every request: the user must be active and the session neither revoked nor expired (`middleware/auth.ts:65-83`).
- The refresh cookie is HttpOnly, SameSite=strict and scoped to `/api/auth`. It is stored hashed, rotated, and reuse revokes every session.
- Login has no enumeration or timing oracle, has lockout, and has a Postgres-backed rate limit. TOTP steps cannot be reused, and recovery codes are hashed.
- `requireTenantContext` takes the account from the membership, not from the token. Branches need explicit membership.
- No route takes its tenant scope from `orgId`/`accountId` in the body or query. No `findUnique({id: req.*})` lacks an org filter.
- **Every orgId table in all four databases has an RLS policy with FORCE** (accounting 49, platform 22, people 69, payroll 29). `set_config` is transaction-local, so the setting is safe under PgBouncer.
- Raw SQL is parameterised and filtered by org.
- In-memory caches are keyed by org or user. No cross-tenant cache leak was found.
- SSO uses PKCE, state, nonce, verified-domain gating and SAML replay protection.
- The SPA fallback (nginx, Caddy, Cloudflare Pages, Vite) already serves deep paths such as `/o/...`.

## 2. Findings

### Identity and sessions

| ID | Sev | Finding | Evidence | Research |
|---|---|---|---|---|
| A-01 | P1 | **Takeover of an owner in a sibling company.** An admin of company X, or anyone holding Users-EDIT in X, can change the email, password or global `isActive` of a user who is Owner of company Y in the same account. A SCIM token minted in X can do the same. Pointing the email at X's SSO domain then gives a global session reaching Y, and SSO skips TOTP. | `users.ts:145-218,491`; `scim.ts:206-227`; `sso.ts:213,237-246` | AC-02, AC-17 |
| A-02 | P1 | **Invitation pre-registration hijack.** Signup does not require a verified email. `POST /users` attaches the membership and role to any existing user with that email, so an attacker who registers `cfo@victim.com` first inherits the invite. | `auth.ts:139-228`; `users.ts:~584-606` | AC-18 |
| A-03 | P1 | **Six `/api/auth` routes check only the JWT signature.** A local `requireAuth` skips session liveness and `isActive`. Affected: `GET /sessions`, `POST /sessions/revoke-all`, `GET /me`, `PATCH /me`, `POST /setup-company`, `POST /resend-verification`. | `auth.ts:68-86` | OPS-04 |
| A-04 | P1 | **Any account member can create a company and become its ADMIN.** `setup-company` checks only the company limit. | `auth.ts:728-915` | AC-17 |
| A-05 | P1 | **Users-EDIT in one company changes memberships in every company of the account.** It runs `outsideTenant` with no admin-target rule. Branch and warehouse grants survive removal. | `users.ts:290-337` | AC-02 |
| A-06 | P2 | **Refresh rotation is not atomic**, so two concurrent refreshes fork the session. `/refresh` has no rate limit. Password-reset and verify tokens race the same way. | `services/auth.ts:94-141,253-297` | OPS-04 |
| A-07 | P1 | **All logged-in users share one rate-limit bucket.** The key is the first 24 characters of the bearer, which is the same JWT header for everyone. Machine-token buckets store secret characters. | `rateLimit.ts:72,85-88` | — |
| A-08 | P2 | **The 30-second access cache is per instance.** Revocation and deactivation lag up to 30s on other replicas. | `accessCache.ts:35-39,79-81` | AC-04, OPS-04 |
| A-09 | P3 | **Membership `accountId` is not checked against the org's owner.** The unique key allows two rows per (org, user). | `tenantContext.ts:91-98` | — |
| A-10 | P3 | **Small items.** Signup returns 409, an enumeration oracle. Disabling 2FA needs only the password. The admin-2FA policy checks enrolment, not use. One `JWT_SECRET` signs every token type, and SSO tokens carry no audience. `jwt.verify` does not pin the algorithm. A stale `activeOrgId` is echoed back by `/auth/me`. | `security.ts:466`; `twoFactorPolicy.ts:22`; `sso.ts:160,174,261`; `auth.ts:456,622` | — |

### Authorization, entitlements and maker-checker

| ID | Sev | Finding | Evidence | Research |
|---|---|---|---|---|
| A-11 | P1 | **Lapsed subscriptions keep working through some paths.** The employee portal, the public API, device paths (iclock/ingest/hikvision/matrix/agent), SCIM, share and pay links check only `isFeatureEnabled`, which tests owned apps rather than entitled ones, or nothing at all. | `portal.ts:110,178`; `publicApi.ts:~60`; `features.ts:34`; `entitlements.ts:88,96`; `subscriptions.ts:177` | AC-07, INT-05 |
| A-12 | P1 | **Document approval has no permission check and no 402.** Two approvers can both post the same journal, and posting is not in one transaction. | `governance.ts:380`; `services/approvals.ts:126-150` | AC-09 |
| A-13 | P1 | **Maker-checker is missing.** Salary revision, payroll run approve/lock, payroll adjustments, tax-declaration verify (only EDIT), staff leave self-approval, public-API leave approval (skips `hrMayDecide`) and bank-change self-approval after 24h are all affected. State changes update by `id` with no status guard. | `payrollRevisions.ts:370,384`; `payrollRuns.ts:660-664`; `payrollAdjustments.ts:274`; `payrollTaxDeclarations.ts:94`; `leave.ts:671`; `publicApi.ts:451-465`; `bankChanges.ts:22,115` | AC-09, AC-10 |
| A-14 | P2 | **The subscription ceiling in `authorize` covers Accounting modules only.** The recycle bin restores and deletes People and Attendance items with no app guard. `requireApp.ts` is dead code. | `rbac.ts:27,76`; `recycleBin.ts:88,112` | AC-06, AC-07 |
| A-15 | P2 | **Refusal order and codes differ by app (402 vs 403 `*_DISABLED`).** An Attendance-only account gets 402 on People routes (SUSPECTED). | `people/guards.ts:24-31` | AC-07 |
| A-16 | P1 | **The billing webhook is unreachable.** It is mounted after a router that applies `requireAuth` to everything under it. | `billing.ts:23`; `app.ts:344,384`; `branches.ts:14` | OPS-02 |
| A-17 | P1 | **The CLOR operator is an ordinary customer user** in an env list. Operator actions need no step-up and write no audit. `setSubscription` is not transactional, and `cancelled` keeps items owned. | `operator.ts`; `billing.ts:58`; `subscriptions.ts:131,150-163` | AC-05 (internal operator) |
| A-18 | P1 | **Full-company export dumps payroll PII to anyone with SETTINGS EXPORT.** That covers bank account, PAN, UAN, salaries and ID documents. The bank and PAN fields are plaintext at rest. | `dataExport.ts:63,80,213-215`; `payroll/schema.prisma:83,87,88,1064` | AC-08, OPS-05 |
| A-19 | P2 | **Users-EDIT scoped to one branch can grant company-wide roles,** including to the holder. | `users.ts:63-88`; `access.ts:39-52` | AC-02 |
| A-20 | P2 | **Users can edit their own record restrictions and can restrict admins.** | `governance.ts:472,502` | AC-02 |
| A-21 | P2 | **Company closure is tied to `createdByUserId`, not a role, and has no step-up.** | `companyClosure.ts:36,48`; `services/companyClosure.ts:48-98` | AC-17 |
| A-22 | P3 | **Some routes have no permission check:** `GET /billing/subscription` (shows prices), `number-series/next`, `payment-modes`. Share links are still served after Accounting is removed. | `items.ts:302`; `payments.ts:93`; `share.ts:95` | AC-07 |

### Front-end tenancy (GAP-014)

| ID | Sev | Finding | Evidence | Research |
|---|---|---|---|---|
| A-23 | P1 | **Cross-tab bleed of branch and warehouse.** The org is per tab (React state), but `activeBranchId`/`activeWarehouseId` live in shared localStorage. When another tab switches company, this tab sends the other company's warehouse in the header and body (POS, delivery challan, sales order, item, import) and numbers documents with the other company's branch series. | `App.jsx:11597-11612,12495-12579,15170`; `PosScreen.jsx:290,358`; `DeliveryChallans.jsx:219`; `SalesOrders.jsx:179`; `ItemForm.jsx:119`; `sales/index.jsx:5417`; `context.js:61`; `http.js:84` | AC-11 |
| A-24 | P1 | **The server stores a `warehouseId` from the body without checking org or warehouse access**, on invoices, purchases, quotes and POS. | `invoices.ts:418-425`; `purchaseDocs.ts:309-315,466`; `quoteDocs.ts:202`; `posCheckout.ts:82`; `stockLedger.ts:31,110` | AC-02, AC-14 |
| A-25 | P1 | **Crossing app hosts loses the company.** localStorage is per origin, so `openApp` and notification clicks open the wrong company or the first one. The front-door redirect drops path and query. | `Shell.jsx:312,408-416,709-716`; `notifications.ts:15` | AC-11 |
| A-26 | P1 | **Links do not carry the company** (the Zoho comparison). A new tab, reload or shared link opens whichever company any tab used last. | `session.jsx:83,139-141` | AC-11, OPS-10 |
| A-27 | P2 | **Two company switchers backed by two stores.** Accounting's "Switch company" does nothing once the shell picker has been used. | `App.jsx:11540-11555`; `session.jsx:139` | OPS-10 |
| A-28 | P3 | **Some localStorage keys are not per company:** `lastSelection:v1`, `dashboardBranchIds`. `index.html` has no People manifest. | `lastSelection.js:16`; `index.html:18` | AC-16 |

### Machine credentials (GAP-004)

There are 13 credential types; the full table is in the evidence notes.

| ID | Sev | Finding | Evidence | Research |
|---|---|---|---|---|
| A-29 | P1 | **Cross-tenant punch routing.** A public-API key creates a synthetic reader with a *global* serial `API-<7 hex>` and `update:{}`. Ingest then writes under `device.orgId`, not `client.orgId`, and an admin of another org can squat that serial. | `publicApi.ts:325-332`; `devices.ts:43,266` | AC-01, INT-11 |
| A-30 | P1 | **Token routes skip `runInTenant`**: SCIM, ingest, hikvision, matrix, iclock, share and pay. Combined with A-35 this means no database backstop. | `scim.ts`; `ingest.ts`; `hikvisionPush.ts`; `matrix.ts`; `iclock.ts`; `share.ts`; `payRequests.ts` | AC-12 |
| A-31 | P2 | **SCIM tokens have no suspend, expiry or audit**, and revoking one is a hard delete. Disabling a site agent leaves its SCIM token live. | `security.ts:179-194`; `integrations.ts:287-337` | AC-04 |
| A-32 | P2 | **Invoice share tokens are plaintext.** `expiresAt` is never set, VIEW permission can create them, and creation is not audited. | `share.ts:56-63,100` | AC-15 |
| A-33 | P2 | **Portal JWTs live 30 days, cannot be revoked per device, and share `JWT_SECRET`.** A SUSPENDED employee keeps access. | `portal.ts:90-95,160-181` | OPS-04 |
| A-34 | P3 | **Smaller credential issues.** Tokens appear in URL paths and edge logs. Webhook signatures carry no timestamp and secrets have no rotation. AES-GCM secrets have no key id or AAD, and the key falls back to `JWT_SECRET`. Machine credentials have no expiry and no tie to the creator's lifecycle. Credentials stay live during the closure notice. | `safeUrl.ts:9`; `webhooks.ts:82`; `mailer.ts:38-58` | — |

### Data boundary and RLS (GAP-001/009/010)

| ID | Sev | Finding | Evidence | Research |
|---|---|---|---|---|
| A-35 | P1 | **RLS fails open.** Every policy returns all rows when `clor.org_id` is NULL or `''`. Only `requireTenantContext`, agent, portal, publicApi and the closure purge set it. Auth, devices, SCIM, share, pay and all ten workers run with no backstop. The comment in `tenantDb.ts` says the opposite. | `prisma/migrations/20260924120000_row_level_security/migration.sql:19-39` (and every `*_rls`); `tenantDb.ts:16-19` | AC-12, AC-13 |
| A-36 | P1 | **The app likely connects as the table owner on Cloud Run** (SUSPECTED, LIVE). One `DB_USER` runs the migrations and then the app, and an owner can turn off FORCE. `provisionAppRole.mjs` defaults do not match the four-database Cloud Run layout. | `cloudrun-start.sh:23-35`; `provisionAppRole.mjs:54,62` | AC-13 |
| A-37 | P2 | **Inside an interactive transaction, the other three clients run with no tenant.** `inTx` is a single global flag. Example: `payrollAdjustments.ts:214` writes to payroll unscoped. | `tenantScope.ts:68-71,84` | AC-12 |
| A-38 | P2 | **`copy_db.sh` turns FORCE off and does not restore it on failure.** | `platform/rollout/copy_db.sh:20,33` | — |
| A-39 | P2 | **Deleting an employee orphans 11 payroll tables.** Cross-store validation is check-then-write. | `payrollEmployees.ts:446-465` | INT-06, INT-12 |
| A-40 | P2 | **Company purge is non-atomic across four stores.** Errors are swallowed and account-level rows are ignored. | `services/companyClosure.ts:115-155` | OPS-06 |
| A-41 | P2 | **The retention job deletes biometric templates for every org without a settings row**, across all tenants. Its 30-day photo purge overrides each org's `photoRetentionDays`. | `retention.ts:66-72,85-86`; `portalAdmin.ts:307` | OPS-06 |
| A-42 | P3 | **Upload MIME types come from the client** (no magic-byte check). There is no object storage: files are bytea in Postgres, contrary to the research's R2 assumption. Dead tenant helpers remain in `tenantDb.ts`. | `people.ts:947-964` | AC-15 |

### Background workers (GAP-007)

There are 13 in-process jobs, started from `index.ts:45-65`. The only lock is `jobLease.ts`.

| ID | Sev | Finding | Evidence | Research |
|---|---|---|---|---|
| A-43 | P1 | **The lease fails open on any error, has no fencing, and the holder re-takes its own lease**, so runs can overlap. HR sync and report e-mails have no in-process guard and can double-push. | `jobLease.ts:24-25,44-48`; `hr/sync.ts:152`; `reportSchedules.ts:120` | INT-10 |
| A-44 | P1 | **A recurring invoice can be lost for good.** The claim, the invoice and the link between them are three separate writes, so a crash makes the period skip forever. The job has no `recurringInvoices` gate. | `recurring.ts:118-176` | INT-10 |
| A-45 | P1 | **Some webhook deliveries are never retried**, because rows start with `nextAttemptAt` null. Retries can double-send across instances and have no feature gate. | `attendance/webhooks.ts:130-136` | INT-10 |
| A-46 | P2 | **A failed report e-mail is marked sent.** | `reportSchedules.ts:97-101` | INT-10 |
| A-47 | P1 | **Destructive closure purge** can be cut by SIGTERM (8s) and has no checkpoint. Cloud Run CPU throttling likely starves timers (SUSPECTED, LIVE). | `companyClosure.ts:145-155`; `index.ts:37` | OPS-01 |
| A-48 | P2 | **Jobs have no tenant boundary, service principal, audit or run history.** Several ignore the subscription: HR sync, books digest, report e-mails, webhook retries, licence reminders. | `index.ts:45-65` | AC-16 |

### Route manifest (GAP-008)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| A-49 | P2 | **The inventory script mis-mounts routes:** publicApi is really `/v1` and SSO is `/api/auth/sso`. It misses `requirePermission` aliases, `authorize()` and `*RouteOk`. "HUMAN_TENANT" does not mean permission-checked. | `scripts/inventory-routes.mjs` |

The 89 routes the script marked for manual review are now resolved:

| File | Routes | Resolution |
|---|---|---|
| auth.ts (15) | 8 | public |
| auth.ts | 6 | needs-fix (A-03) |
| auth.ts | `me/export` | ok |
| billing.ts (4) | webhook | needs-fix (A-16) |
| billing.ts | 3 | tenant-human |
| portal.ts (45) | 3 | public |
| portal.ts | 42 | employee-token, needs a subscription check (A-11) |
| publicApi.ts (19) | 2 | public |
| publicApi.ts | 17 | machine-token, needs a subscription check (A-11, A-13) |
| share.ts (1) | 1 | token (A-32) |
| sso.ts (5) | 5 | public / protocol |

These routes are classed HUMAN_TENANT but still need fixes: `governance.ts:380`, `users.ts:290`, `companyClosure.ts:36,48`, `recycleBin.ts:88,112`, and the payroll and leave transitions.

## 3. Live-only items (cannot close from source)

These need Cloud Run, Cloud SQL or Cloudflare access:

- Production `current_user`, `rolbypassrls` and table ownership (A-36, GAP-001).
- `pg_policies` and `relforcerowsecurity` as actually applied in each database (GAP-001).
- Whether the four URLs point at four distinct databases (GAP-009).
- Cloud Run min instances and CPU allocation (A-47).
- Cloud SQL backups and a restore drill (OPS-01).
- Edge log redaction (A-34).
