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
- A-16 fixed: billing webhook mounted publicly ahead of the routers that require a session, with the raw body and a rate limit. Application behavior changed: yes. Schema: no.
- A-17 fixed: operator subscription changes need authenticator + step-up, are recorded as AuthEvents with before/after, and are written in one transaction. Application behavior changed: yes (operators must enrol an authenticator). Schema: no.
- A-18 fixed: company export carries People and Payroll only for someone holding their VIEW permissions (and a step-up when the company asks for one for payroll), names anything withheld, audits each personal-data export, and counts as the full export only when nothing was withheld. The Data export menu item is gated on the permission the server checks. Application behavior changed: yes. Schema: no.
- A-19 fixed: role grants, role and profile edits are bounded by what the caller holds where the grant applies (company-wide unless the assignment is for one branch); non-administrators cannot change their own roles or profiles. Application behavior changed: yes. Schema: no.
- A-20 fixed: non-administrators cannot change their own record restrictions or the own-documents-only flag of a role they hold, and cannot restrict an administrator. Application behavior changed: yes. Schema: no.
- A-21 fixed: closing a company (and cancelling it) needs a company-wide administrator rather than the creator, and asking to close needs a fresh authenticator code. Application behavior changed: yes (an administrator without an authenticator must set one up before closing). Schema: no.
- A-22 fixed: the subscription plan (with gateway ids removed) is shown only to whoever may view the company profile; the next-number preview needs the right to raise that document type and refuses unknown types; payment modes need a money-handling permission. Application behavior changed: yes. Schema: no.
- Batch 2 closed: full server suite 169 files / 1568 tests passed at 345865a (EV-043).
- A-24 fixed: a warehouse named in a document must belong to the company and be usable by the person; company-wide administrators (not the creator) reach every branch and warehouse without a grant. Application behavior changed: yes. Schema: no.
- A-26, A-25 fixed: the company is in the address (`/o/<CODE>/`), each tab keeps its own, an unknown code shows no-access, and links to other app hosts and the front-door forward carry it. Application behavior changed: yes (addresses now start with /o/<code>). Schema: no.
- A-23, A-27, A-28 fixed: branch and warehouse are chosen per company and per tab; Accounting's company menu switches through the shell; remaining remembered choices are per company; People install manifest. Application behavior changed: yes (a tab no longer picks up another tab's branch or warehouse). Schema: no.
- Batch 3 closed (EV-047). Follow-ups: `companyClosure.test.ts` purges every company past notice, so it collides with any suite sharing the database — scope it to its own companies (Batch 6 did the same for its purge test); `homeBoard.test.jsx` builds dates in UTC.
- Batch 7 (A-49 route manifest and CI gate) merged at da48eab; gate passes on this branch.
- A-29 fixed: an API key's punches are recorded under a reader of its own company and never under one another company claimed; reserved serial prefixes cannot be claimed by hand. Application behavior changed: yes. Schema: no.
- A-30, A-37 fixed: routes that learn their company from a token run as that company once it is known; queries made during an interactive transaction keep the company setting. Application behavior changed: no visible change; the database backstop now applies on these paths. Schema: no.
- A-38 fixed: the database copy script turns FORCE row-level security back on however it ends. Application behavior changed: no (operator script). Schema: no.
- Attendance services layer merged (`588f3f7`): ingestion, days, reader sync, vendor pulls, leave balances, punch photos, corrections and the permission catalogue seed moved from route files into services; no service imports a route; behaviour unchanged (EV-054).
- A-39 fixed: a person with any payroll history cannot be deleted (Payroll or People); their payroll setup goes with them; deletes and payroll writes for one person are serialised. Application behavior changed: yes. Schema: no.
- A-42 fixed: uploaded documents and compliance evidence are typed by their own bytes; a file whose bytes disagree with its stated type is refused. Application behavior changed: yes. Schema: no.
- A-35 fixed: row-level security fails closed. A query that has not named its company sees no company's rows; crossing companies is explicit (outsideTenant, acrossCompanies) and background work runs with a maintenance bypass. Application behavior changed: no visible change where every path is scoped; a missed path now returns nothing instead of everything. Database schema changed: yes — policy rewrite migration `20261024100000_rls_fail_closed` in all four schemas (applied to the local dev database only). Deployment: effective only once the runtime role is not the table owner or a superuser (A-36); `TENANT_STRICT=off` restores the old request behaviour without a rollback.
- A-40 fixed (with A-47): deleting an account's last company cancels its subscription at the gateway and closes its plan; company codes are never issued twice. Application behavior changed: yes. Database schema changed: yes — platform `OrgClosure.orgCode` (local dev only).
- Batch 4 closed (EV-057). A-36 (separate runtime database role) stays LIVE: it is a deployment change made with the owner.
- Batch 5 (GAP-004, A-31..A-34) — machine credentials registry, plan `2026-10-24-0342-feat-machine-credentials-registry-plan.md`:
  - U1–U2: platform `Credential`/`CredentialEvent`; API keys, agents and reader URLs checked through it with their own tables still having a say; a revoked key can no longer be revived by rotating it. Application behavior changed: yes. Schema: platform `Credential`, `CredentialEvent` (+RLS).
  - U3 (A-31): SCIM tokens can be paused, expire, are kept when revoked and follow their agent. Application behavior changed: yes. Schema: platform `ScimToken.revokedAt`.
  - U4 (A-32): share links hashed with an encrypted copy, expiring, made only with invoice edit, following their invoice; pay links close with a cancelled invoice; `/?share=` links open the invoice again (they had been showing the home page since the shell). Application behavior changed: yes. Schema: accounting `DocumentShareLink.tokenHash/tokenEnc` (plaintext still written for one release).
  - U5 (A-33): employee-app sign-ins are per-device sessions; suspension, sign-out, password change and HR end them. Application behavior changed: yes. Schema: people `PortalSession` (+RLS), `Employee.portalSessionsRevokedAt`.
  - U6: expiry warnings, review flags when a credential's maker leaves, orphans retired. Application behavior changed: yes (new bell notices). Schema: no.
  - U7: Company admin → Credentials; API keys move there (Attendance links to it); `SETTINGS::Credentials` granted to whoever managed integration keys. Application behavior changed: yes. Schema: platform permission rows + grants (migration `20261024120600`).
  - All migrations applied to the local dev database only.
- Batch 5 closed (EV-065). Next release: U9 (drop share-link plaintext) and the separate portal signing secret.
- Batch 8 (A-50, A-51): every staff change is in the audit trail — who may do what under Company, Accounting and masters in words; the trail now shows what was sent instead of "[object Object]". Application behavior changed: yes (more audit rows). Schema: no. Closed (EV-067).
- Batch 9 follow-ups (EV-068): closure tests no longer purge other suites' companies; homeBoard test fixed for any timezone; Users table no longer overlaps at narrow width; Users errors show in the form saved. Application behavior changed: yes (Users screen layout). Schema: no.
- Batch 10 simplify (EV-069): Accounting's App.jsx split into feature files (15,157 → 4,507 lines); Sales and Purchase one file per screen; tests that read App.jsx source see the moved code too. Application behavior changed: no (one dark-mode fix: the GST export menu hover). Schema: no.
- Batches 9 and 10 closed (EV-070).
- Batch 11, GAP-012 (EV-071): every API answer is `Cache-Control: private, no-store` unless a route says otherwise; file boundary covered by tests (companies, people, managers, forced RLS). Cloudflare inspected read-only (R2 off; Worker is a passthrough). Application behavior changed: yes (response header only). Schema: no. Cloudflare configuration changed: no.
- Batch 11, A-34 rest (EV-072): path tokens redacted in logs; webhooks signed with the time (`X-Clor-Signature-256`) and their secret can be changed with a day of overlap ("New secret" on Integrations); stored secrets carry a key id and AAD and survive a key change via `MAIL_SECRET_KEY_PREVIOUS` (new shape written only with `SECRET_FORMAT=v2` this release). Application behavior changed: yes. **Schema:** people `Webhook.previousSecret`, `previousSecretUntil` (applied locally). Cloudflare configuration changed: no (read-only; owner actions listed in `edge-logs.md`).
- Batch 11, GAP-010 (EV-073): deletes, reversals and grants that would leave one database naming nothing in another now refuse or tidy up; Payroll checks Accounting ids before writing; Cost Centers can switch a centre off; a nightly cross-store check repairs access rows and orphaned credentials and reports Payroll history (`npm run integrity:cross-store`). Application behavior changed: yes (two new 409s, two new 400s, access rows removed on delete). Schema: no.
- Batch 11 closed: full server suite 1800/1800, web 57 failures all pre-existing (EV-074).
- GAP-011 (EV-075): `/auth/me` names `user.homeAccountId` and `activeAccountId`; audit found no data path using the home account. Application behavior changed: two added response fields. Schema: no.

Running totals for 2026-10-23:  
Application behavior changed: yes (GAP-002, GAP-003, A-03, A-01, A-02, A-04, A-05, A-07, A-06, A-08, A-09, A-10, A-11, A-12, A-13, A-14, A-15, A-16, A-17, A-18, A-19, A-20, A-21, A-22, A-24, A-23, A-25, A-26, A-27, A-28, A-29, A-30, A-37, A-38, A-35, A-39, A-40, A-42, A-31, A-32, A-33, A-34 (parts), GAP-004, A-50, A-51).  
Database schema changed: yes (platform `Account.legacyUnrestrictedAt`; platform `AuthPolicy.makerChecker`; `rls_fail_closed` policy rewrite in all four schemas; platform `OrgClosure.orgCode`; Batch 5 credential registry, `ScimToken.revokedAt`, share-link hash columns, `PortalSession`, credentials permission grant; applied locally only).  
Deployment or Cloudflare configuration changed: no.  
Customer data accessed: no (local test accounts only).

## 2026-10-23 — Batch 7: route manifest (GAP-008, A-49)

- `scripts/inventory-routes.mjs` rewritten. The regex version mounted publicApi under `/api/portal/punch` and SSO under `/api`, and could not see permission checks spelled as aliases (`VIEW`, `EDIT`, `ROLES_EDIT`), `can()` helpers, `authorize()` in a handler, `requireOperator`, the `*RouteOk` guards or `appLive`, so "HUMAN_TENANT" said nothing about permissions. The new one uses the TypeScript compiler to resolve every identifier, takes mounts from `app.use(...)` in app.ts in order, applies a router's `.use(...)` only to routes after it, and expands registration helpers (`transition(...)`, `register(kind)`, `[...].forEach(register)`, Matrix `handle(...)`). It writes method, path, file:line, principal, auth, tenant, permission, entitlement, makerChecker, audit and reviewed. 732 routes (helpers expanded; was 662).
- `route-allowlist.json`: the 89 manual-review routes and every other public, employee-token and machine-token route (137 entries), one reason each; known gaps carry their finding (A-21 closure).
- CI gate: `.github/workflows/ci.yml` step "Route manifest gate" runs the script with `--check`; it fails on a write with no permission and no entitlement check that is not allow-listed, on a public/token route without a reason, and on stale allow-list entries. `server/src/__tests__/routeManifest.test.ts` covers mounts, guard detection and the gate on a fixture.
- Findings: no unknown unguarded write. New A-50 (access-control changes write no audit row, 21 routes) and A-51 (112 other staff writes reach no audit trail), in `evidence/A-49/unguarded-routes.md`.
- Application behavior changed: no. Database schema changed: no. Deployment configuration changed: CI only (one new verify step). Customer data accessed: no. Server route files: not edited.
- After merging the Batch 2 branch (`345865a`, A-14..A-22): the script also reads routes declared on the app in app.ts (A-16 moved the billing webhook there, ahead of the JSON parser; `/health` and `/ready` are now listed and allow-listed as probes). It counts `requireAnyPermission`/`authorizeAny` (A-22) as permission checks, and `mayClose` (role check) plus `stepUpRefusal` for closure (A-21). A-21's two known-gap entries left the allow-list, because the gate failed on them as stale once closure was guarded. 734 routes, 0 violations. Application behavior changed: no.

## 2026-10-23 — Batch 6: background workers (GAP-007)

Branch `claude/batch6-workers-fb00cd`, one commit per finding. Evidence in `evidence/A-43` … `evidence/A-48` (before-fix with only the changed source files swapped back to HEAD, after-fix on the working tree); register EV-100 … EV-106.

- A-43 (`ca93087`): the job lease fails closed (only a missing table, P2021, lets an idempotent job run leaseless); a job never overlaps itself in one instance; fencing token + `assertHeld()`; heartbeat renews long runs; failure and SIGTERM free the lease (`stopJobs()` in `index.ts`), success keeps the period claim. Application behavior changed: yes (a lease error now skips the tick instead of running unguarded). **Schema: yes** — platform `JobLease.token`, `runningSince`, `heartbeatAt` (migration `20261023200000_job_lease_fencing`).
- A-44 (`88ea0c1`): a recurring-invoice period is one transaction; orphan claims are repaired; `maxOccurrences` holds under racing runs; gated on `recurringInvoices` and Accounting (`appLive`). Application behavior changed: yes (no drafts for companies with the feature off or Accounting lapsed/closing). Schema: no. `vitest.config.ts`: the worker's `PG_ADMIN_URL` is now the owner URL as intended (it was the app role by ordering accident).
- A-45 (`19a4468`): webhook deliveries always have a next-attempt time, are claimed before every send, and retry only while Attendance is live. Application behavior changed: yes. Schema: no.
- A-46 (`32d9ee2`): a failed scheduled-report e-mail is no longer recorded as sent; sends are idempotent per (schedule, slot, recipient); gated on Attendance. Application behavior changed: yes. Schema: no.
- A-47 (`7207fad`): the company purge checkpoints each store, resumes, refuses new steps after SIGTERM or lease loss, records and alerts failures; runs hourly. Application behavior changed: yes. **Schema: yes** — platform `OrgClosure.purgeProgress`, `purgeAttempts`, `purgeError`, `lastPurgeAt` (migration `20261023200100_closure_purge_checkpoint`).
- A-48 (`8007718`): punch selfies follow each company's `photoRetentionDays` only (the global 30-day purge is gone; notice, punch card and Data protection show the company's period — the notice version changes, so employees re-read it); biometric copies deleted only where a company has switched copying off on record; subscription gates on HR sync, books digest, document and licence reminders; `JobRun` history. Application behavior changed: yes. **Schema: yes** — platform `JobRun` (migration `20261023200200_job_runs`).

Full server suite: 170 files / 1564 tests pass (EV-106). Follow-up found, not fixed here: after a closure purge, the company code number is issued again while the old account still holds that code, so `setup-company` can fail with a unique-constraint 409 (`services/displayCodes.ts:63`).

Migrations are committed, not applied anywhere (tests push the schema to their own database). Production applies them through `scripts/cloudrun-start.sh` (`prisma:deploy`) before the API starts.

Running totals for Batch 6:  
Application behavior changed: yes (A-43 … A-48).  
Database schema changed: yes (three platform migrations above; not applied to any shared database).  
Deployment or Cloudflare configuration changed: no.  
Customer data accessed: no (test databases only).
