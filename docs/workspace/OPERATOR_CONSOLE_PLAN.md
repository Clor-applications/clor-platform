# Operator console — what to add next

The console at ops.clor.in today: overview counts, accounts list and detail,
suspend / reinstate, extend trial, grant plan, operator log, operator roles.
It answers "who are our customers". It does not yet answer the three
questions support actually gets asked:

1. **What is wrong for this customer right now?** (troubleshooting)
2. **What can I do about it without seeing their books?** (support actions)
3. **Which customers need us before they ask?** (visibility)

Most of the data for all three is already stored; the console just does not
read it. This plan uses what exists first, and adds new tables only where
nothing exists.

## Ground rules (kept from the first version)

- **Metadata, not business data.** An operator sees companies, people, apps,
  plans, sign-ins, integrations, errors and counts. Never a customer's
  invoices, ledgers, employees' records or payslips. Seeing those needs the
  customer's consent (Phase 3).
- **Every change**: a role that allows it, a fresh authenticator code
  (step-up), a reason, a line in the operator log, and a line in the
  customer's own security log.
- **Read-only by default.** New pages are views; actions are few and explicit.

What others do, briefly. Practitioner guidance on support tooling says: keep
the support person's own identity instead of "logging in as" the customer,
scope and time-limit any deeper access, ask for a reason or ticket, and log
start and end ([Ory](https://www.ory.com/blog/identity-level-impersonation),
[cidaas](https://docs.cidaas.com/integration/best-practices/impersonation),
[AppMaster](https://appmaster.io/blog/secure-admin-impersonation-controls-audit-scope)).
Salesforce's *Grant Login Access* is the customer-side version: the customer
grants support a fixed period and can withdraw it
([Talkdesk help](https://support.talkdesk.com/hc/en-us/articles/360045100931-Granting-Login-Access-in-Salesforce)).
Stripe's Workbench shows request logs, events and errors per object, with
errors grouped by type ([Stripe docs](https://docs.stripe.com/workbench/overview)).
Health scores blend usage trend, support load and billing; a falling trend
matters more than a low level ([Basedash](https://www.basedash.com/blog/how-to-build-a-customer-health-score-signals-weighting-and-sql)).

---

## Phase 1 — Show what is already stored (no new tables)

### 1.1 Find anything
One search box, top of every page. Finds an account by:
- account, company or person name; email
- **any code**: company, account or user ID, including old ones (KAVE-C100)
- GSTIN, phone

Today search covers account name, account code, user email and company name only.

### 1.2 Account page becomes a customer 360

| Section | Source (exists) |
|---|---|
| Companies: code, GSTIN, state, apps on, created | `Org`, `FeatureSetting`, `subscriptions.appAccess` |
| People: user ID, email, role, last sign-in, authenticator on, **locked** | `User` (`lastLoginAt`, `totpEnabledAt`, `lockedUntil`), `UserOrgMembership` |
| Plan: subscription, trial end, items per app, entitlement limits | `Subscription`, `SubscriptionItem`, `AccountEntitlement` |
| Usage: invoices this month, employees, payroll runs, punches, last activity | counts as in `/account/overview`; `PayrollRun`, `Employee`, `DevicePunch` |
| Integrations per company (green / amber / red) | e-invoice `EInvoiceSetting.lastError`; readers `AttendanceDevice.lastSeenAt` + open `ReaderAlert`; SSO `AuthProvider.lastError`; HR `HrConnection.lastError`; site agent `SiteAgent.lastSeenAt`; webhooks `WebhookDelivery` failures; email `EmailSetting.lastError` |
| Email: last 50 sent / failed with error | `EmailOutbox` |
| Credentials: API keys, reader tokens, SCIM — status, last used, needs review | `Credential` |
| Security: full sign-in history with IP and device, active sessions | `AuthEvent`, `Session` |
| Closures and exports | `OrgClosure` (incl. purge errors), `AuditLog` EXPORT_ALL |
| Outside access (CAs) | `OutsideAccess` |

### 1.3 Support actions (step-up, reason, logged both sides)

| Action | Role | Uses |
|---|---|---|
| Unlock a locked user | SUPPORT | `clearFailedLogins` — **no unlock route exists today**; customers wait or reset |
| Sign a user out everywhere | SUPPORT | `revokeAllSessions` |
| Send password-reset / verification email | SUPPORT | existing reset and verify flows (operator never sees or sets a password) |
| Retry failed emails for a company | SUPPORT | `mailer.retryFailed` |
| Reset a user's authenticator (lost phone, no recovery codes) | SUPER_ADMIN | clears `totpSecretEnc`; user must set up again; customer owner notified |
| Resend a pending invite | SUPPORT | existing invite flow |

### 1.4 System health page

- Every background worker: last run, outcome, error, duration — `JobRun` via `lastJobRuns()` (written, never shown).
- Failure counts across all customers, last 24 h: emails FAILED, e-invoice errors, webhook deliveries failed, readers offline, closures stuck in purge.
- Click a count → the accounts affected.

### 1.5 Error lookup by request ID
Every 500 already returns an `X-Request-Id`. A box: paste the ID → open the
matching Google Cloud Logging query (deep link). No log storage needed.
Customers can be shown the ID on error screens so they can quote it.

---

## Phase 2 — Proactive visibility (small new tables)

### 2.1 Lists that need attention
Saved views on the accounts page:
- Trials ending in 7 days, with usage (worth a call vs. let lapse)
- **Going quiet**: active days down 40 %+ vs. their 90-day baseline
- Integration broken > 24 h (e-invoice failing, readers offline)
- Never finished setup (signed up, no first invoice / employee after 3 days)
- Locked users, failed emails piling up

### 2.2 Health score
Red / amber / green per account from: usage trend (35 %), apps adopted (25 %),
integration health (15 %), support load (15 %), billing (10 %). Starting
weights only; checked against real churn once there is some.

### 2.3 Account timeline
One stream per account: sign-ins, admin changes (`AccountAuditEvent`),
operator actions (`OperatorAuditEvent`), plan changes, closures, integration
failures — newest first, filterable.

### 2.4 Notes and tags *(new: `AccountNote`, `AccountTag`)*
Internal only. "Called owner 25 Oct, e-invoice creds wrong." Tags like
`CA-firm`, `pilot`, `VIP`. Optional ticket reference on every action.

### 2.5 Announcements *(new: `Announcement`)*
Clor → customers banner in the app: maintenance windows, GST rule changes,
new features. Target all, by app, by plan, or one account. Today there is no
way to tell customers anything inside the product.

### 2.6 Per-account feature switches
UI over `AccountEntitlement.extraFeatures` and limits: turn on a beta for one
customer, raise a company or user limit, with reason and expiry.

---

## Phase 3 — Deeper support, with consent

### 3.1 Customer-granted support access *(new: `SupportGrant`)*
Modelled on Salesforce *Grant Login Access* and Clor's own `OutsideAccess`:
- The customer's owner or admin clicks **Allow Clor support** → picks
  1 hour / 1 day / 7 days, which company, which apps.
- The operator opens the company **as themselves**, read-only by default,
  with a banner on both sides; writes need a second grant.
- Every screen opened is logged; access ends at expiry or when the customer
  withdraws it.
- Enforced in `tenantContext` like `OutsideAccess`.

This is the only way an operator sees an invoice or a payslip.

### 3.2 Two-person approval
Suspend, authenticator reset, cancel a closure, grant a paid plan free: one
operator asks, another approves.

### 3.3 When the pieces exist
- Billing (refunds, credits, invoices) once a payment gateway is live — today only `ManualGateway`.
- Email bounce / complaint tracking once the mail provider sends events.
- Error grouping (Sentry or stored errors) if Cloud Logging links are not enough.
- Storage per account once files move to R2.

---

## Suggested order

| # | Item | Size | Why first |
|---|---|---|---|
| 1 | Search by any code / GSTIN / phone | S | Every support call starts here |
| 2 | Account 360 (1.2) | M | Data exists; biggest jump in usefulness |
| 3 | Unlock, sign out, reset email, retry emails (1.3) | S | Commonest tickets; unlock has no route today |
| 4 | System health + request-ID lookup (1.4, 1.5) | S | `JobRun` already written, never read |
| 5 | Attention lists + timeline (2.1, 2.3) | M | Find trouble before the customer calls |
| 6 | Notes / tags, announcements (2.4, 2.5) | M | First new tables |
| 7 | Health score, feature switches (2.2, 2.6) | M | |
| 8 | Consented support access, two-person approval (3.1, 3.2) | L | Needs customer-side UI and careful review |

## Decisions needed

1. **Support access (3.1)**: build it, or never let operators into customer
   data at all?
2. **Helpdesk**: will support run in a ticketing tool (Zoho Desk, Freshdesk)?
   If so, link tickets to accounts both ways instead of building notes.
3. **Authenticator reset (1.3)**: allowed for SUPER_ADMIN alone, or two-person
   from day one?
