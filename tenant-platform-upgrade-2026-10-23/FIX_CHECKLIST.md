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
| A-01 | Identity changes (email, password, isActive) need admin in **every** org of the target, or account owner. SCIM is limited to single-org users who are not admins. Email change clears verification. SSO ignores unverified email. | X-admin cannot change Y-owner's email; SCIM cannot touch an admin | Users screen: edit owner's email from another company and see refusal | TODO |
| A-02 | `POST /users` refuses to attach an existing unverified user | pre-registered unverified address gets no membership | add-user form shows the message | TODO |
| A-04 | `setup-company` limited to account owner / admin | member gets 403 | "Add company" hidden or refused for member | TODO |
| A-05 | `PUT /users/:id/companies` checks the caller in each target org; removal also clears branch and warehouse grants | cross-org removal refused | user companies editor | TODO |
| A-07 | Rate-limit key = user id after auth (hashed token before auth) | two users do not share a bucket | n/a (server-only) | TODO |
| A-06 | Atomic refresh rotation plus limiter; atomic token consumption | concurrent refresh: only one succeeds | n/a (server-only) | TODO |
| A-08..A-10 | Cache invalidation, membership/org check, small items | per item | n/a | TODO |

## Batch 2 — Authorization, entitlements, maker-checker

| ID | Fix | Test | Browser | Status |
|---|---|---|---|---|
| A-11 | One `principalAllowed` check (entitlement plus closure) on portal, public API, devices, SCIM, share, pay | lapsed attendance subscription: portal and API return 402 | employee portal shows the "subscription ended" state | TODO |
| A-12 | Approval decide: permission, 402, conditional update, one transaction | double approve posts once | approve an invoice in the approvals screen | TODO |
| A-13 | `assertNotMaker` on revisions, runs, adjustments, tax verify, leave (staff and API), bank changes; status-guarded updates | creator approving their own item gets 403 | payroll run approve by its preparer is refused | TODO |
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
