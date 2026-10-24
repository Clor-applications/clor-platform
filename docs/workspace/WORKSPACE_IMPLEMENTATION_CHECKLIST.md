# Workspace implementation checklist

Tracks the Clor Workspace & Administration Portal spec (24 Oct 2026) against the
code. Statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED_UNVERIFIED`,
`TESTED`, `ACCEPTED`. "Evidence" is a file, test or commit; a screenshot alone is
never evidence of server-side authorization.

Audited on branch `claude/subscription-provisioning-gap-003-b84bad` (PR #23).

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
| W-8.2 | Clor Operator: separate boundary and console (today an env allowlist on customer auth) | All | NOT_STARTED | W-1.3 | High |
| W-9.1 | Two-account isolation tests through the production DB role and pooling (A-36) | Tests | NOT_STARTED | A-36 | High |

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
