# Fix Checklist

Every audit finding (`ARCHITECTURE_AUDIT_2026-10-23.md`) is tracked here. **A row is DONE only when all four columns hold:**
1. **Fixed** — the code change is in a named commit.
2. **Test** — an automated test that failed before the fix and passes after it (file and test name).
3. **Browser** — checked in the running app with a screenshot or network capture under `evidence/<ID>/`, or marked `n/a (server-only)` with the reason.
4. **Evidence** — an entry in `EVIDENCE_REGISTER.md`.

Status values: `TODO` · `IN PROGRESS` · `DONE` · `LIVE` (needs production access) · `DEFERRED` (with reason).

## Already done (before this audit)

| ID | Fix | Test | Browser | Evidence | Status |
|---|---|---|---|---|---|
| GAP-002 | Accounting plan intersected with ownership; RBAC returns 402 for unowned Accounting | `businessModel.test.ts`, `modules.test.ts` | n/a (server-only; API 402) | EV-015/016 | DONE (`5d24103`) |
| GAP-003 | Explicit subscription at signup; fail-closed `appAccess`; grandfather marker | `modules.test.ts` signup subscription; `businessModel.test.ts` fail-closed | pending: sign up in the browser and see 4 apps | EV-017/018 | DONE (server); browser pending |
| GAP-013 | RLS negative test asserts a policy error | `rowLevelSecurity.test.ts` | n/a (database-only) | EV-0xx | DONE |

## Batch 1 — Identity and sessions (P1 first)

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-03 | Six `/api/auth` routes use the live `requireAuth` middleware; dead `signToken` removed | `identityAndSessions.test.ts` › "is refused by the account routes too once its session is signed out" / "… once the person is deactivated" (fail before, pass after) | `evidence/A-03/`: signed in, second device revoke-all, kept token → 401 `session_ended` on all six; app signs out | DONE (EV-019) |
| A-01 | `identityBlockedIn` (roleGuards): changing another person's email, password or active flag needs Users EDIT in **every** company they work in, and admin wherever they are admin. SCIM may change email/active only for single-company non-admins; SCIM email change clears verification. SSO unchanged: with the email no longer movable, its match is safe, and refusing unverified users would lock out real SSO users | `identityAndSessions.test.ts` › "an administrator of a sibling company" (3 tests: fail before — owner's password reset by X admin signed him out; pass after) | `evidence/A-01/`: Mallory (admin of X only) edits owner's email in Settings > Users → 403 `identity_elsewhere` shown in the banner; owner still signs in | DONE (EV-021). Note: the banner sits above the scrolled form; minor UX follow-up |
| A-02 | `POST /users` refuses to attach a login from **another account** whose email is unconfirmed (409 `unverified_identity`); this account's own users unaffected | `globalIdentity.test.ts` › "is not attached while its owner has not confirmed the address" (fail before: 201; pass after). Existing invite tests now confirm the invitee first (globalIdentity, identityAndSessions, displayCodes) | `evidence/A-02/`: admin adds an address a squatter self-registered → banner shows refusal, users list unchanged | DONE (EV-022). UX follow-up: errors render behind the Create User drawer on narrow windows |
| A-04 | `setup-company` allowed only for the account's first company or an administrator of one of its companies (403 `NOT_ACCOUNT_ADMIN`) | `identityAndSessions.test.ts` › "adding a company" (fail before: clerk got 200; pass after) | `evidence/A-04/`: clerk (Sales User) has no Add company in UI; direct call with the clerk's session → 403, no company created | DONE (EV-023) |
| A-05 | `PUT /users/:id/companies` checks the caller's own Users EDIT in **each** company added or removed, and admin there when the person administers it (403 `not_your_company` / `admin_only`); removal also clears branch and warehouse grants | `userCompanies.test.ts` › "needs the caller's own right in every company it touches", "takes branch and warehouse grants away with the company" (fail before: 200 self-grant; branch grant survived) | `evidence/A-05/`: Mallory ticks the owner's other company for herself → 403 banner; she still has only her company | DONE (EV-024) |
| A-07 | Limiter keys for bearer, ingest and Hikvision tokens are a SHA-256 of the whole token: one bucket per credential, no secret characters in keys | `apiRateLimit.test.ts` › "gives every signed-in session its own bucket, though all JWTs share a header" (fail before: Bob got 429 from Alice's traffic) | n/a (server-only middleware; the browser sees only the per-address `RateLimit-*` headers, which the per-session bucket's headers are overwritten by — checked, `evidence/A-07/browser-headers.json`) | DONE (EV-025) |
| A-06 | Refresh claims the old session atomically (`updateMany … revokedAt:null`); a second presentation within 10 s of rotation is a tab race → 409 `refresh_raced` (cookie kept, nobody signed out), later → reuse, all sessions revoked; client retries once on 409; `/refresh` rate-limited; reset and verify links consumed atomically | `authHardening.test.ts` › "lets only one of two simultaneous refreshes through, and signs nobody out" (fail before ×3: [200, 401] — race taken as theft); reuse test now replays after the grace | `evidence/A-06/`: two simultaneous refreshes in the browser → [409, 200], retry 200, still signed in after reload | DONE (EV-026) |
| A-08 | Session-liveness answer cached at most 5 s per instance (`SESSION_LIVENESS_TTL_MS`); permission cache keeps its 30 s | `identityAndSessions.test.ts` › "stops working within seconds when another instance ends its session" (fail before: 200 after 5.5 s) | n/a (server-only: dev runs with no cache) | DONE (EV-027) |
| A-09 | Tenant context checks the membership's account owns the company | `tenantIsolation.test.ts` › "a membership row that names the wrong account" (fail before: forged rows read another company's invoices, 200) | n/a (server-only: no UI writes such a row) | DONE (EV-027) |
| A-10 | JWT verify pinned to HS256 everywhere; SSO state/relay get their own audiences; `/auth/me` echoes `activeOrgId` only for a member company; turning 2FA off needs password **and** a current or recovery code (server + Authenticator card) | `identityAndSessions.test.ts` › "token and echo hygiene"; `payrollStepUp.test.ts` / `twoFactorLogin.test.ts` disable steps (fail before: HS512 token 200; stranger org echoed; password-only disable 200) | `evidence/A-10/`: turn-off form needs a code; password-only call 400 `BAD_CODE`; recovery code turns it off | DONE (EV-027). Deferred: signup 409 enumeration (needs an email-based "already registered" flow) |

## Batch 1.5 — Company admin workspace (ADR-010, owner request 2026-10-23)

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| W-01 | `app.clor.in` opens the Company admin workspace (shell picks `admin` on the front door and does not forward to itself) instead of bouncing into the last app | `appHosts.test.js` › "opens Company admin on the front door, from any app address"; `registry.test.js` | localhost has no front-door host (Vite refuses `*.localhost`): verified through the switcher and `?app=admin`; front-door host logic by unit test | DONE (EV-028) |
| W-02 | `apps/admin` manifest (rail, permission filtering, phone tabs), `platform: true` → always present, never for sale, never the landing app; "Company admin" in every app's switcher; `requestOpenApp` lets an app open another | `registry.test.js` (4 tests) | `evidence/W-01..04/1-…`, `2-workspace-home.jpg`: switcher → Company admin → apps + 12 admin areas | DONE (EV-028) |
| W-03 | Moved to `apps/admin`: Users, Roles, Permissions, Login & security, SSO, Audit trail, Account & plan, Billing, Branches, Data export (+ Company profile and Close company from `@ui/company`); API clients to `@platform/admin/*` (Accounting keeps re-export shims) | moved tests `accountOverviewDate`, `dataBackup` pass; structural tests updated | `3-users-in-workspace-phone.jpg`: Users works in the workspace | DONE (EV-028) |
| W-04 | Accounting Settings keeps only its own (Company Profile, Warehouses, Financial Year, POS, GST, TDS, Approval Workflows) plus "Users, roles & security"; old keys (`settingsUsers` …) redirect to the same page in Company admin; People/Attendance "Users & Security" opens it; app switch drops the previous app's `#/screen` | settings registry/hub/workspace/feature-link tests updated | `4-old-accounting-link-redirects.jpg`, `5-accounting-settings-trimmed.jpg`; back to Accounting lands on its home (no loop) | DONE (EV-028, EV-029) |
| W-04b | Permissions grouped by app (Company, Accounting, People, Attendance, Payroll — only the apps the company uses); each app has "Roles & Access" opening Company admin's Permissions on that app (`?for=<app>`); filtering hides rows, saving always writes the whole role | settings/navigation tests updated; web suite 0 new failures vs baseline | `6-payroll-roles-access-filtered.jpg`: Payroll → Roles & Access → Permissions with Payroll selected, 48 Payroll permissions only | DONE (EV-029) |
| W-05 | One audit trail: server filter `app=` now sorts every entry to company / accounting / attendance (People & Attendance) / payroll; Company admin's Audit trail has those tabs (`?for=`), readable entity names, and the correct `SETTINGS::Audit trail::VIEW` gate; Attendance's and People's "Audit Logs" open it on their share (their separate screen removed). API keys: moved to Batch 5 — they are Attendance-scoped today and belong on the credential registry's one Credentials page | `audit.test.ts` › "gives each app its own share of the one trail" (fail before: `app=accounting` refused, 400) | `evidence/W-05/`: Attendance → Audit Logs → Company admin trail on People & Attendance; Company tab lists user changes | DONE (EV-030) |

## Batch 2 — Authorization, entitlements, maker-checker

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-11 | `appLive` / `anyAppLive` (services/principalAllowed.ts): switched on (where the app has a switch) **and** entitled **and** company not scheduled for closure — on the employee portal (sign-in and every request), API keys, connectors, ADMS/HTTP-push/Hikvision/Matrix readers, SCIM (closure), invoice share and payment links (Accounting). Portal says it in an employee's words | `principalAllowed.test.ts` (4 tests; fail before: API and portal 200 after lapse, API 200 while closing) | `evidence/A-11/`: employee signed in while paid → after lapse the portal refuses: "The employee app is paused for your company. Please ask HR." | DONE (EV-031) |
| A-12 | `decide()` claims the request with a conditional update (`status: PENDING`) — exactly one decision lands, the other gets 409; the decide route refuses with 402 when Accounting is not entitled; a journal posting that fails reopens the request; invoice lookup scoped by org | `approvalRace.test.ts` (10 simultaneous pairs, 0 doubles; old code: 9 of 10 doubled — `race-probe-before.txt`); `governance.test.ts` › "posts an invoice once when two approvers approve it at the same moment" | `evidence/A-12/`: inbox; owner without the approver role refused; live: two simultaneous approvals on the dev server → 200 + 409, one POSTED journal entry; Approved tab shows it once | DONE (EV-032) |
| A-13 | `services/makerChecker.ts`: **about yourself** (own salary revision/apply, adjustment, tax declaration, bank account) never allowed; **own work** follows the new company setting `AuthPolicy.makerChecker` (migration `20261023180000_maker_checker_policy`): AUTO (default — refused while somebody else could approve, otherwise allowed and audited `SELF_APPROVED`), STRICT, ALLOW (audited). Applied to salary revisions, pay runs, adjustments, tax verify, bank changes (24 h cooling-off kept), staff leave; API key cannot approve leave it raised (the approval chain already applied to API leave — audit item corrected). Every one of these transitions now updates only from the checked state. UI: Company admin → Login & security → Policy | `makerChecker.test.ts` (5 scenarios; all fail before); `integrationsV2.test.ts` updated (raising key 403, other key 200) | `evidence/A-13/`: policy control; owner's own Diwali-bonus approval refused in Payroll; second admin approves → Approved | DONE (EV-033). Not changed: Employee Payroll Profile has no APPROVE action, so tax verify stays on EDIT with the checks above |
| A-14/15 | Module-to-app ceiling in `authorize`; one refusal order and set of codes | recycle bin People restore with People unowned gets 402 | n/a | TODO |
| A-16 | Billing webhook on its own public router with raw body | unauthenticated webhook reaches the handler | n/a (server-only) | TODO |
| A-17 | Operator: TOTP in session plus step-up, audit row, transactional `setSubscription`; cancelled releases items | operator change writes audit; no TOTP gives 403 | operator billing screen | TODO |
| A-18 | Export: People/Payroll domains need module permissions plus step-up; audit per domain | Settings-only exporter gets no payroll data | export dialog | TODO |
| A-19..A-22 | Branch-scoped grant escalation, self restrictions, closure by role plus step-up, missing VIEW permissions | per item | closure screen | TODO |

## Batch 3 — Company in the URL (GAP-014, the Zoho fix)

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-26 | `/o/<ORG-CODE>/…` in every app URL; session resolves URL code, then this tab's company, then last used; a code that is not the user's shows a no-access screen, never a silent switch | `orgUrl.test.js`; session resolution tests | open `/o/<code>` in two tabs with different companies; screenshots | TODO |
| A-23 | Branch and warehouse per company **per tab** (sessionStorage via platform context); remove direct localStorage reads | context tests | tab A company X, tab B company Y; save in A; network shows X headers and body | TODO |
| A-24 | Server checks `warehouseId` belongs to the org and the user may use it | foreign warehouse gets 400/403 | n/a (server-only) | TODO |
| A-25 | `openApp`, notifications and the front-door redirect carry `/o/<code>` | link builder tests | Accounting → Payroll hop keeps the company | TODO |
| A-27 | One company switcher (Accounting menu routes through the shell) | — | switch from the Accounting menu changes the URL code | TODO |
| A-28 | Per-company storage keys; People manifest | — | — | TODO |

## Batch 4 — Data boundary

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-29 | Synthetic API reader keyed `(orgId, apiClientId)`; ingest asserts the device org equals the client org | squatted serial gets no cross-org write | n/a | TODO |
| A-30 | Token routes run inside `runInTenant` | per route | n/a | TODO |
| A-37 | Per-client in-transaction flag | cross-client write inside a transaction carries the org | n/a | TODO |
| A-35 | Fail-closed RLS policies plus explicit maintenance bypass for global jobs (**needs A-30 and the worker changes first**) | unset org returns 0 rows | full regression suite plus browser smoke of all apps | TODO |
| A-36 | Separate migrate and runtime roles; boot refuses if the runtime role is owner or bypass | boot check test | — | LIVE (deploy change) |
| A-38..A-42 | copy_db trap, employee-delete orphans, purge checkpoints, retention per org, MIME sniff | per item | — | TODO |

## Batch 5 — Machine credentials registry (GAP-004)

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-31..A-34 | `Principal` / `Credential` / `CredentialEvent` (platform DB), dual-read; SCIM suspend and audit; agent disable cascades; share tokens hashed with expiry; portal session revoke | disable/rotate/cross-tenant matrix | integrations screen | TODO |

## Batch 6 — Workers (GAP-007)

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-43 | Lease fails closed, fencing token, heartbeat, in-process guard | two runners plus long run gives one effect | n/a | TODO |
| A-44..A-48 | Atomic recurring invoice, webhook `nextAttemptAt`, report status, purge checkpoint, gates, `job_run` | crash/replay tests | n/a | TODO |

## Batch 7 — Route manifest (GAP-008)

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-49 | Script resolves real mounts and detects all guards; adds permission, entitlement, maker-checker and audit columns; CI gate | CI fails on an unguarded mutating route | n/a | TODO |

## Live-only

GAP-001 (applied policies, runtime role), GAP-009 (four distinct databases), Cloud Run CPU and min instances, backups and restore drill. Each needs read access to the production console. Status: `LIVE`.
