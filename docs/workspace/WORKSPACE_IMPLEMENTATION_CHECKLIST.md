# Workspace implementation checklist

Tracks the Clor Workspace & Administration Portal spec (24 Oct 2026) against the
code. Statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED_UNVERIFIED`,
`TESTED`, `ACCEPTED`. "Evidence" is a file, test or commit; a screenshot alone is
never evidence of server-side authorization.

Audited on branch `claude/subscription-provisioning-gap-003-b84bad` (PR #23).

## What is left on the Workspace side (14 Nov 2026)

Checked against `origin/main` and the live app. The rest of this file is the
24 October audit and has not been kept up; these are the open items.

### 1. The Overview asks the server for figures it never shows — done 14 Nov 2026

`GET /account/overview` already returns **`entities`**, **`dataHealth`** and
**`runRate`** (`server/src/routes/account.ts`, `services/accountHealth.ts`), but
`apps/admin/src/screens/AccountOverview.jsx` reads none of them: it shows
Account name, Companies, Company addresses, People and Plan. The server work
landed with PR #200; the panels did not. PR #132 held the panels and was closed
on 14 Nov 2026 as stale (conflicting, untouched since 10 Nov). The panels were
then built from this table; only seats-in-use is still open.

| Figure | Where it comes from |
|---|---|
| **Entities** — companies, branches, GST registrations, cost centres | `Org`, active `Branch` (distinct GSTINs, so two branches under one GSTIN count once), active `CostCenter` |
| **Active seats**, and a seats-by-app panel | **Still open.** Seats bought come from `SubscriptionItem.seats`, but seats *in use* are counted per app from the directory and nothing computes that yet, server or screen. Left out rather than shown as a half-answer |
| **Data health**, and a panel naming each source | Open `ReaderAlert` rows as the reader-check job left them, Tally postings (`AgentJob`) failed this week or waiting over a day, `EmailOutbox` failures this week. "Nothing to sync" when the account has no such source |
| **Security** — share of active members signing in with an authenticator | Member directory `authenticator` (TOTP). Administrators without one belong under "Needs your attention" |
| **Monthly run rate** | Subscription items: `per_seat` x seats, `flat`/`per_app` as set, `free` adds nothing, yearly divided by 12, cancelled or paused 0. **If any item has no price it must read "Not priced yet" and name the app** — never a zero that looks like an answer |

### 2. Support grants are not built

The plan's "grant temporary CLOR access" (Workspace P2/P3, with Ops P3
`SupportGrant`). Nothing in the code matches `SupportGrant`. `OutsideAccess` is
the customer's own accountant, not CLOR staff. Until this exists, staff cannot
get time-boxed, audited access to a customer's data to investigate a problem.

### 3. P3 insights and recommendations

Not started.

### Done since the 24 October audit

Overview hierarchy and app cards (#200), the unified inbox across apps (#242),
the integration status page (#243), the support centre (Workspace `Support`, ops
`Tickets`), onboarding (`SetupGuide`), seats and subscription use (`PlanChange`,
`BillingPreview`). The audit's Workspace state-machine risks W1 and W7 were
fixed by #235 and #238.

## Decisions taken (24 Oct 2026)

| ID | Decision |
|---|---|
| D-1 | Merge PR #23 into main, then build each Workspace phase as its own PR off main. |
| D-2 | Account roles are an `AccountMembership` table (Owner, Admin, Billing Admin, Member) with a status; the paused `claude/account-owner-wip` logic (backfill, last-owner guard, step-up, audit) is reused, not shipped as is. |
| D-3 | The spec palette (porcelain #FAFAF7, Blaze Orange #F45A28) applies to the Workspace screens only; Accounting, Payroll, People and Attendance keep DESIGN.md. |
| D-4 | Accounts flagged `legacyUnrestrictedAt` keep every app until billing goes live; they are listed for the operator so each can be moved to a plan. |
| D-5 | Accounting and Payroll share one frontend layout; Attendance and People share another. Workspace changes must not merge the two. |
| D-6 | "Company admin" is named **Workspace**. |
| D-7 | The platform is light-only, and uses the clor.in logo. |

## Done

| Req | Feature | Layer | Status | Evidence |
|---|---|---|---|---|
| W-0.1 | "Company admin" renamed Workspace everywhere a person reads it | UI, server message | TESTED | commit 886896d; `packages/shell/registry.test.js`, `appHosts.test.js` |
| W-0.2 | Workspace home: welcome, company, every app with its state (Switched on / Not switched on / Not on your plan / Coming soon), administration grouped by permission | UI | TESTED | `apps/admin/src/screens/AdminHome.test.jsx` (3); browser check on local API, 24 Oct |
| W-0.3 | Timesheet listed as planned beside Projects | UI | TESTED | `packages/shell/registry.js` |
| W-0.4 | App opens on sign-in; `/signup` opens sign-up (clor.in Get started), `/forgot-password` the reset form; old app landing page removed | UI | TESTED | `packages/shell/publicPage.test.js`; live on app.clor.in via hotfix `claude/app-signup-door` |
| W-0.5 | clor.in Get started → app.clor.in/signup, Sign in → /signin | Website | ACCEPTED | live on clor.in |
| W-0.6 | One logo (clor.in mark + wordmark) across the platform and app icons | UI | IMPLEMENTED_UNVERIFIED | commit e5636e4; visual check on Workspace only |
| W-0.7 | Light theme only | UI | IMPLEMENTED_UNVERIFIED | commit e5636e4; `useTheme.js`, `index.html` |
| W-0.8 | Company switcher, company in the address (`/o/CODE`), denied code shows no-access | UI + server | TESTED | `packages/shell/orgUrl.test.js`, `NoCompanyAccess.jsx`, PR #23 |
| W-0.9 | Per-request chain: auth → company context → permission → app entitlement; RLS fails closed | Server | TESTED | `server/src/middleware/{auth,tenantContext,rbac}.ts`; `rlsFailClosed`, `tenantIsolation` tests |
| W-0.10 | Outside access (a person from another account, per company, time-bound) | Server + UI | TESTED | `outsideAccess.test.ts`, `OutsideAccess.test.jsx` |
| W-0.11 | Credentials registry (API keys, SCIM, devices) with pause / revoke | Server + UI | TESTED | `credentialsRoute.test.ts`, `Credentials.test.jsx` |
| W-0.13 | Workspace home redesigned on the spec palette (setup checklist, app cards, grouped administration) | UI | TESTED | commit 8826378; `AdminHome.test.jsx` (4); browser check |
| W-0.12 | Company closure with notice period and purge | Server + UI | TESTED | `companyClosure` tests |

## Next, in order

| Req | Feature | Layer | Status | Depends on | Risk |
|---|---|---|---|---|---|
| W-1.1 | `AccountMembership` (Owner / Admin / Billing Admin / Member, status) + migration backfilling today's accounts | DB, server | TESTED | D-2, PR #23 merged | High |
| W-1.2 | Last-owner protection; owner add/transfer with step-up and audit | Server | TESTED | W-1.1 | High |
| W-1.3 | Account-level audit events (AuditLog requires an orgId today) | DB, server | TESTED | W-1.1 | Medium |
| W-1.4 | Account powers from AccountMembership, not "admin of some company" (`auth.ts:764`) | Server | TESTED | W-1.1 | High |
| W-2.1 | Account switcher; company switcher grouped by account; context banner (account · company · app · delegated) | UI | TESTED | W-1.1 | Medium |
| W-2.2 | Workspace sidebar groups per spec (Main / Administration / Support), 404, access-denied with reason, global loading/error/empty states | UI | TESTED | — | Low |
| W-2.3 | Spec palette inside the Workspace only (D-3) | UI | IMPLEMENTED_UNVERIFIED | — | Low |
| W-3.1 | Invitations: hashed single-use token, expiry, resend, revoke, idempotent accept, audit, seat policy documented | DB, server, UI | TESTED | W-1.1 | High |
| W-3.2 | Invite wizard with access preview; no granting above own authority | UI, server | TESTED | W-3.1 | High |
| W-4.1 | Members directory with filters; member detail with effective access (accounts, companies, apps, roles, scopes, who granted, when) | UI, server | TESTED | W-1.1 | Medium |
| W-4.2 | Per-person app assignment (separate from subscription) | DB, server, UI | ACCEPTED (decided 25 Oct 2026: no separate assignment — what a person opens comes from their company roles; `appsOfPermissions`, Users › role, Setup guide step "Give everyone access") | W-1.1 | High |
| W-4.3 | Suspend / remove from company / revoke app / remove from account as separate actions | Server, UI | TESTED | W-4.1 | Medium |
| W-5.1 | Role catalogue grouped Workspace / Company / per app, from the existing permission catalogue | UI | TESTED | — | Low |
| W-5.2 | Step-up for role elevation, SSO change, payroll-sensitive grants | Server | TESTED | — | Medium |
| W-6.1 | Plan limits as data, not code (`planCatalog.ts`); atomic quota checks (today check-then-write) | DB, server | TESTED | — | High |
| W-6.2 | Products & subscriptions page; subscription detail; usage page by product | UI | IN_PROGRESS | W-6.1 | Medium |
| W-6.3 | Payment provider integration (webhook signature, idempotency) | Server | DEFERRED (decided 25 Oct 2026: no paid provider until every app is ready; `ManualGateway` in `server/src/billing/gateway.ts` runs free and hand-granted plans with no fees; Cashfree or Razorpay is one adapter later) | gateway not chosen | High |
| W-7.1 | Security centre: privileged members, own and admin session revoke, sign-in events | UI, server | TESTED | W-1.1 | Medium |
| W-7.2 | Audit page with filters and detail drawer, account-scoped | UI | TESTED | W-1.3 | Low |
| W-7.3 | Profile, account settings, notification preferences | UI, server | TESTED | W-1.1 | Low |
| W-8.1 | CA-firm client accounts with explicit delegation | All | NOT_STARTED | W-1 … W-7 | High |
| W-8.2 | Clor Operator: separate boundary and console | All | TESTED | live at ops.clor.in (PR #29); roles SUPER_ADMIN/SUPPORT/BILLING, authenticator required and set up in place (PR #31), step-up on every change, append-only operator log mirrored to the customer; `opsConsole.test.ts` (6), `opsConsole.test.jsx` (4); own sign-in page (PR #30); `docs/workspace/OPERATOR_CONSOLE.md` |
| W-9.1 | Two-account isolation tests through the production DB role and pooling (A-36) | Tests | IN_PROGRESS | Through the real stack on staging (Worker → Cloud Run → Postgres RLS, role `clor_app`): `test/staging/isolation-security.cjs` 53/55 — every cross-account read, edit, delete and export refused. Still to confirm `clor_app` is not BYPASSRLS in production (A-36). | High |

## Evidence for W-1 / W-2.1 (commit c0ccb12)

- `server/src/__tests__/accountMembership.test.ts` — 8 tests: owner on signup, member on add; company creation and account overview gated by account role; member/admin limits; owner changes need step-up; last owner kept; DENIED events audited; an account admin gets no ledger access; two-account isolation (unknown member, forged x-org-id); `/auth/me` accounts.
- `packages/shell/companyGroups.test.js` — picker grouping by account.
- Migration `20261025090000_account_membership` applied to the local dev database: every account has an owner.

## Evidence for W-3 (commits d6964b2, fc6b8a7, and the invite-link fix)

- `server/src/__tests__/accountInvitations.test.ts` — 7 tests, stable over 3 runs: invite → preview → accept with own password; two simultaneous accepts make one person; revoked, expired and resent (old link dead) links; never OWNER; only owners/admins invite; foreign company refused; role grants need company admin (ABOVE_AUTHORITY); another account's login sent to Outside access; wrong signed-in person refused; audit SENT → RESENT → ACCEPTED.
- `Invitations.test.jsx` (3), `InviteAccept.test.jsx` (4).
- Browser, local API: owner sent an invitation; the link stopped the owner (not the invited address); signed out, the invitee chose a password and landed in the company.
- Seat policy: pending invitations reserve no seat; the plan's user limit is enforced at acceptance (documented in `services/accountInvitations.ts`).

## Evidence for W-4 (commits 1ef8271 and the Members screen)

- `server/src/__tests__/accountMembers.test.ts` — 7 tests: directory with roles and apps; access detail with granter and sensitive permissions; suspend blocks a real ledger request with ACCOUNT_MEMBER_SUSPENDED, reinstate restores it; owners only by owners, not on oneself, members refused; remove-from-company keeps the login and account membership and deletes the company's roles; another account sees and changes nothing; /account/me apps.
- `Members.test.jsx` (3), `AdminHome.test.jsx` (5).
- Browser, local API: directory and drawer on real data.

## Evidence for W-2.2, W-5, W-6.1, W-7 (commits 0f1544e … 03e6a18)

- W-2.2: browser — `?open=nosuchpage` shows "This page isn't here"; a member with no role opening Members gets "You can't open Members… view Users (Settings)". Sign-in/out now forgets per-company branch choices (stale branch bug found in the check).
- W-5.1: `roleGroups.test.js`; browser shows the local roles grouped.
- W-5.2: `accountMembers.test.ts` — administrator grant refused without a fresh code when the granter has an authenticator, allowed with one.
- W-6.1: `quotaLock.test.ts` — bursts stay within the plan; with the lock disabled the users case fails (3 made, 2 allowed).
- W-7.1: privileged-access summary and no-authenticator filter on Members; sign out everywhere (token refused at once).
- W-7.2: `/account/audit` + Account activity; tests on order, filters, isolation.
- W-7.3: account rename, audited.
- W-2.3: the spec palette is on the Workspace screens built for it (home, Members, Invitations, Account activity); older Workspace screens (Company profile, Roles, Login & security) still use DESIGN.md.
- W-6.2: Account & plan shows companies and people against the plan's limits; no per-product usage page.
- Tracking documents (§23) written: REQUIREMENTS, ROUTE_MAP, UI_UX_SPEC, TENANCY_MODEL, PERMISSION_MATRIX, SUBSCRIPTION_ENTITLEMENTS, API_CONTRACTS, SECURITY_TEST_PLAN, CHANGELOG.

## Known issues outside this list

- W-4.2 is IN_PROGRESS: the Workspace now shows each person's own app access (from their roles) apart from the company's subscription, with "Access not assigned" and "No app access yet". A separate per-person assignment table (assignment independent of roles) is not built: today a role is what opens an app. Decide whether that extra layer is wanted before building it.

- Signup still switches every available app on (auth.ts signup creates a subscription with all apps). Spec rule 2.2.5 says creating an account must not activate products: W-6.

- zod 3 high advisory (GHSA-mrhx-c7xc-m3w5): fixed only in zod 4; server upgrade (69 files) pending.
- 8 tests fail on the branch before any Workspace change (`settingsRegistry.test.js` 5, `accountArea.test.jsx` 3).
- Production still needs A-36 (non-BYPASSRLS runtime role) before PR #23's server is deployed.

## 25 Oct 2026 — release audit fixes

- Company in use is named in the Workspace bar again (company selector), because half the Workspace's pages act on that company alone; pages that cover the whole account carry an "All companies" tag (Companies, Members, Invitations, Account activity, Subscription, Billing).
- Workspace ground moved to the shell's cool neutral (zinc) so bar, rail and page are one surface.

## 25 Oct 2026 — added to the tracker

Statuses as above. Sources: `docs/testing/STAGING_TEST_REPORT_2026-10-25.md`,
`docs/workspace/OPERATOR_CONSOLE_PLAN.md`.

### Shipped today

| Req | Feature | Status | Evidence |
|---|---|---|---|
| W-11.1 | Company, account and user IDs are ten random digits with a check digit (Zoho style), shown in the address as `/o/<id>/`; old KAVE-C100 codes still open the company, the employee portal and ops search | ACCEPTED | PR #32, #33 (RLS-safe repair migration); production: 2 companies renumbered, 0 orphan accounts |
| W-11.2 | Staging stack: staging.clor.in, app/accounting/payroll/attendance/people/ops.staging.clor.in, api.staging.clor.in, own Cloud SQL `clor-pg-staging`, own secrets, email captured not sent, noindex | TESTED | PR #34; report §"The staging stack" |
| W-11.3 | Concurrency fixes: ledger postings serialised per company+branch (entry number, hash chain); fiscal year insert-or-take; party and item auto-codes re-allotted on a race | ACCEPTED | PR #34; staging seed of 10 companies × 190 records, 0 errors |
| W-11.4 | Invoice save no longer shows raw database errors (logged, request id returned) | ACCEPTED | PR #34 |
| W-11.5 | Company setup ~7 s → ~1 s (batched chart of accounts, journals, owner role permissions) | ACCEPTED | PR #34; staging journey timings |
| W-11.6 | Staging test suites: journey, isolation & security, rate limits, CSP walk, load seed, load run | TESTED | `test/staging/` |

### People who leave, companies that stop (26 Oct 2026)

| Req | Feature | Status | Evidence |
|---|---|---|---|
| W-13.1 | "Mark as left": reason, last working day, note; sign-in and sessions end; seat freed; history keeps the name; audited | ACCEPTED | PR #37; `leaversAndArchive.test.ts`; staging browser check |
| W-13.2 | Hand-over of waiting approval steps, HR desk requests and attendance exceptions to a named successor | ACCEPTED | PR #37 |
| W-13.3 | Release a shared address (accounts@) for the next person; reactivate restores it when free | ACCEPTED | PR #37 |
| W-13.4 | Archive a company: read-only, machine access and mail off, off the plan count, reason required, reversible; last active company kept | ACCEPTED | PR #37; live revision clor-api-00168-hez |
| W-13.5 | Hand-over of accounting-side items (open approvals in Books) — Books approvals have no assignee today | NOT_STARTED | — |

### Small businesses first (decided 25 Oct 2026)

Go-to-market is businesses of one owner and one or two staff, often on a phone.
Enterprise role depth stays, but must never cost a small business a second
login or a roles lesson.

| Req | Feature | Status | Notes | Priority |
|---|---|---|---|---|
| W-10.1 | Owner uses every switched-on app with one sign-in (company Administrator role at setup) | TESTED | Already true on the web: staging journey and load users are owners working in every app. Keep as a rule. | High |
| W-10.2 | One Clor mobile app with an in-app switcher, replacing `mobile/accounting`, `mobile/attendance`, `mobile/payroll` (three icons, three sign-ins today) | NOT_STARTED | Employees keep attendance / self-service only | High |
| W-10.3 | Add a staff member in one step with plain presets (Accountant, Billing staff, Attendance only); the role matrix hidden unless opened | NOT_STARTED | — | High |
| W-10.4 | "Strict mode" opt-in for larger customers: separation of duties, approvals, custom roles | NOT_STARTED | Off by default | Medium |

### Operator console — next phases (plan: `OPERATOR_CONSOLE_PLAN.md`)

| Req | Feature | Status | Priority |
|---|---|---|---|
| W-8.3 | Search by any code (company/user/old), GSTIN, phone | IN_PROGRESS (codes done in PR #32; GSTIN, phone to do) | High |
| W-8.4 | Account 360: companies, people (last sign-in, authenticator, locked), plan, usage, integration health, email failures, credentials, security events, closures, outside access | NOT_STARTED | High |
| W-8.5 | Support actions with step-up and reason: unlock user (no route exists today), sign out everywhere, send reset/verification email, retry failed emails, reset authenticator | NOT_STARTED | High |
| W-8.6 | System health page (`JobRun` via `lastJobRuns()`) and request-ID → Cloud Logging lookup | NOT_STARTED | Medium |
| W-8.7 | Attention lists, account timeline, notes/tags, Clor → customer announcements, per-account feature switches, health score | NOT_STARTED | Medium |
| W-8.8 | Customer-granted, time-limited, read-only support access; two-person approval for risky actions | NOT_STARTED | Low |

Decisions still needed: (1) may operators ever see customer business data with
consent (W-8.8)? (2) helpdesk tool (Zoho Desk / Freshdesk) or own notes?
(3) authenticator reset by a super admin alone or two-person?

### Open findings from staging testing

| Req | Finding | Status | Next step | Priority |
|---|---|---|---|---|
| W-12.1 | **Database capacity**: production `clor-pg` is db-f1-micro (~0.6 GB) and at 100 % memory while nearly idle. Measured: ~5 people at once fine, 10 → 2–10 s per request (invoice save 10 s, invoices screen 18 s); bigger pools fix 10 users but exhaust memory beyond that | BLOCKED (decided 25 Oct: no paid upgrade now) | Free path: cut queries per request and cache per-click lookups (W-12.2); apply for Google for Startups credits; add memory/latency alerts (W-12.3). Fallback: Oracle Always Free Arm (now 2 OCPU / 12 GB, idle-reclaim rule) on staging first. Paid path when funded: db-custom-1-3840 (~$50/month) + pools 6/3 | High |
| W-12.2 | Fewer database round trips per request (RLS wrapper transaction per query; `/auth/me`, membership and permission lookups on every click) | NOT_STARTED | Re-measure with the 10-user load run | High |
| W-12.3 | Cloud Monitoring alerts on Cloud SQL memory and API latency | NOT_STARTED | Free | Medium |
| W-12.4 | Content-Security-Policy is report-only | NOT_STARTED | Enforced on staging it blocks only Cloudflare's analytics beacon: allow `static.cloudflareinsights.com` / `cloudflareinsights.com` (or turn the beacon off), then rename the header | Medium |
| W-12.5 | Account enumeration through lockout (locked: 429 "Too many failed attempts"; unknown address: 401) | NOT_STARTED | Answer both alike | Low |
| W-12.6 | Party and item codes have no unique index; a tight race can still store a duplicate | NOT_STARTED | Check existing data for duplicates, then add the index | Medium |
| W-12.7 | 50- and 100-user load steps not run | BLOCKED on W-12.1 | `test/staging/load-run.cjs` | Medium |
| W-12.8 | Recurring `Unique constraint failed on the fields: (name)` in production logs (seen before 25 Oct) | NOT_STARTED | Find the writer (likely a job lease) | Low |
| W-12.9 | Unused `*_staging` databases on production `clor-pg` | NOT_STARTED | Drop only with the owner's approval (permanent) | Low |
| W-12.10 | `clor-pg-staging` costs ~$10/month | NOT_STARTED | Stop it between test rounds if needed | Low |
| W-12.11 | `.claude/launch.json` (a local dev-server entry) slipped into main with PR #32 | NOT_STARTED | Remove in a cleanup PR | Low |

Paused here on 25 Oct 2026 at the owner's request.
