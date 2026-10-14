# Compliance audit — Clor

Date: 2 October 2026. Branch: `claude/compliance-audit` (stacked on `claude/recon-and-stock-ledger`).

This is an engineering audit. It finds what the code does and fixes what can safely be fixed in code. It does **not** establish legal compliance with any law. The policy drafts it adds need review by a lawyer before they are relied on. Owner decisions are listed in [OWNER_INPUT_REQUIRED.md](./OWNER_INPUT_REQUIRED.md).

Severity: CRITICAL, HIGH, MEDIUM, LOW, INFO.

---

## 1. What the application is

| Question | Finding | Evidence |
|---|---|---|
| What it does | Multi-company GST accounting SaaS for Indian businesses: invoicing, purchases, inventory, POS, GST returns, e-invoicing, bank reconciliation, payroll. | `apps/accounting`, `apps/payroll`, `server/src/routes` |
| Stack | React 19 + Vite SPA; Express + Prisma 5 + PostgreSQL (three databases: accounting, payroll, people). | `package.json`, `server/package.json`, `server/prisma/*` |
| Accounts | Yes. Email + password sign-up and sign-in. No MFA, no social sign-in. SSO config can be saved but is not active. | `server/src/routes/auth.ts`, `server/src/routes/security.ts:130` |
| Authentication | Short-lived JWT access token (localStorage) + HttpOnly refresh cookie `neev_rt` (30 days, rotated, reuse-detected). | `packages/platform/http.js`, `server/src/utils/refreshCookie.ts` |
| Payments to the operator | **None.** No billing, checkout, gateway or subscription. A plan layer exists but nothing writes it. | `server/src/constants/planCatalog.ts`, `apps/accounting/src/features/account/BillingPreview.jsx` (labelled sample) |
| Payments recorded | Yes — the customer's own business payments, POS tenders. | `server/prisma/schema.prisma` `Payment`, `PosDayClose` |
| Refunds / cancellations | Not applicable to the operator (nothing is sold). | — |
| Cookies | One first-party HttpOnly cookie, strictly necessary. | `server/src/utils/refreshCookie.ts:29-46` |
| Analytics / tracking | **None found.** | see §8 |
| Third-party embeds | None. Before this audit, Google Fonts (removed). | see §9 |
| Personal data in forms | Sign-up, profile, company set-up, customers/vendors, payroll employees (PAN, UAN, bank details, salary). | see §6, §7 |
| Uploads | Avatar (data URL, ≤96 KB) and CSV/JSON imports; no file storage. | `server/src/routes/auth.ts:900-922`, `server/src/routes/imports.ts` |
| Marketing claims | Landing and sign-in pages. | see §16 |
| Jurisdiction | India: GST, INR, Indian states, GSTIN/PAN/UAN. The Digital Personal Data Protection Act 2023 (DPDP) is relevant. | throughout |

---

## 2. Findings

Each finding: issue, location, evidence, risk, fix, whether the change is safe, whether owner/legal input is needed, and status.

### CRITICAL

**C1. Another company's admin could take over an invited user's account.** FIXED
- **Location:** `server/src/routes/users.ts` — `PATCH /orgs/:orgId/users/:userId` and `POST /orgs/:orgId/users/:userId/password`.
- **Evidence:** both routes checked only that the target was a member of the caller's company, then changed the person's *global* email or password. Inviting an existing person gives them a membership in the inviting account.
- **Risk:** the admin of any company that invited somebody could reset that person's password, or move their email to an address they control and use "forgot password". That gives full access to the person's own companies.
- **Fix:** `identityChangeRefusal`. Email and password can now be changed only for people created in the caller's account (`403 foreign_identity` otherwise). An Administrator's email and password can be changed only by an Administrator. An admin-set password signs the person out everywhere. A changed email loses its verified status. Tested in `identityAndSessions.test.ts`.
- **Safe:** yes. Self-service changes and same-account administration still work. **Owner input:** no.

### HIGH

**H1. Signing out, a password reset or deactivation did not end access.** FIXED
- **Location:** `server/src/middleware/auth.ts`.
- **Evidence:** the middleware verified only the JWT signature. Deployments set `JWT_EXPIRES_IN=8h`.
- **Risk:** a stolen or revoked token kept working for up to 8 hours.
- **Fix:** every request now checks that the user is active and that the token's session has not been revoked or expired (one indexed read).
- **Remaining:** the handful of `/api/auth/*` routes in `routes/auth.ts` (`/me`, `/setup-company`, profile) use their own token check, which does not do this yet. LOW.

**H2. Row-level security does not isolate tenants in practice.** NOT FIXED (architecture)
- **Location:** the `*row_level_security*` migrations; `server/src/utils/tenantDb.ts`.
- **Evidence:** the policies admit every row when `clor.org_id` is unset, and no route calls `withTenant`. Isolation rests on `where` clauses in application code.
- **Risk:** one missing filter exposes another company's data.
- **Fix:** route tenant queries through `withTenant`, then make an unset setting deny. This is a large change; it was raised as a separate task. **Owner input:** prioritisation.

**H3. Login rate limiting could be bypassed, and client IPs were spoofable.** FIXED
- **Location:** `server/src/middleware/rateLimit.ts`, `server/src/services/auth.ts` `clientIp`, `server/src/app.ts`.
- **Evidence:** the limiter keyed one bucket on IP *and* email together, so one machine could try one password against many emails. The IP was read from the first `X-Forwarded-For` value sent by anyone.
- **Fix:** separate per-IP (3× allowance) and per-identity buckets. `trust proxy` now trusts only loopback and private-network proxies, and `TRUST_PROXY` can override it. Security events and rate limits use `req.ip`.
- **Safe:** yes behind Caddy or nginx on the same host or Docker network. Behind a public load balancer, set `TRUST_PROXY`. **Owner input:** confirm the proxy topology.

**H4. No privacy notice, terms, cookie notice or accessibility statement.** IMPLEMENTED (draft)
- **Fix:** `packages/shell/legal/*` adds four documents at `#/legal/{privacy,terms,cookies,accessibility}`. They are readable signed in or out, linked from the landing page footer, the sign-in and sign-up pages, and Profile.
- Every statement was written from the code. Operator facts come from build variables in `packages/platform/operator.js`, never invented. Until those are set, each page shows **"Draft"** and visible placeholders.
- **Owner/legal input: required.**

**H5. No way to erase personal data or close an account.** PARTIAL
- **Evidence:** no route deletes a user, company or account. "Remove user" only drops memberships (`users.ts:646-680`).
- **Fix:** people can now **download their own data** (`GET /api/auth/me/export`; Profile → Your data and privacy). There is also an **"Ask to close my account"** request, which emails the grievance contact once that is configured.
- **Remaining:** the erasure process itself — what to delete, what tax law requires keeping, and how to anonymise. **Owner/legal input required.**

**H6. Invoice share links never expire, and VIEW permission is enough to create one.** REPORTED
- **Location:** `server/src/routes/share.ts:30,55-63`; `PaymentReminders.jsx:99`.
- **Evidence:** `expiresAt` is never set. The token travels in a URL through WhatsApp and email. The public page shows both GSTINs, names, addresses, line items and amounts.
- The `?share=` page is also unreachable for signed-out visitors (`Shell.jsx` shows the landing page), so customers never see the invoice. This is a bug, raised as a separate task.
- **Fix needed:** a default expiry, CREATE (not VIEW) permission to create a link, and a reachable share page. **Owner input:** link lifetime.

**H7. Password-reset and email-verification links lead nowhere.** REPORTED
- **Evidence:** the server emails `/?token=…` and `/verify-email?token=…` (`auth.ts:560,775,868`), but no frontend screen reads them.
- **Risk:** people cannot reset a forgotten password. The privacy notice's "correct your data" path is also incomplete.
- **Fix:** add the two screens. Raised as a separate task.

**H8. Landing copy claimed self-hosting and that records never leave the server.** FIXED (copy)
- **Location:** `packages/shell/Home.jsx:187,420`; `packages/shell/AuthLayout.jsx:100`.
- **Evidence:** there is a hosted production deployment, so for its users records sit on the operator's server. With e-invoicing or GSTIN lookup switched on, data does go to third parties.
- **Fix:** replaced with statements the code supports: "No analytics, no advertising, no trackers. Your records are used to keep your books, and nothing else." Also "GST accounting for Indian businesses".
- **Owner input:** if a self-hosted edition is sold, say so per edition.

### MEDIUM

| # | Issue | Location / evidence | Status | Fix / remaining | Owner input |
|---|---|---|---|---|---|
| M1 | Google Fonts loaded from fonts.googleapis.com, sending each visitor's IP address to Google before sign-in | `packages/ui/src/index.css:6` | FIXED | Inter is now self-hosted (`@fontsource-variable/inter` 5.3.0, OFL-1.1). Browser check: no third-party hosts are requested. | No |
| M2 | No Content-Security-Policy on the web app | `deploy/Caddyfile.production`, `docker/*` | PARTIAL | Added `Content-Security-Policy-Report-Only` and `Permissions-Policy` to the production Caddyfile. Watch for violations, then enforce. The Docker nginx and Caddy configs have none. | Enforce date |
| M3 | Access token in localStorage | `packages/platform/http.js` | REPORTED | Mitigated by a short lifetime (now actually revocable, H1) and the CSP. Moving it to memory-only is a separate design change. | No |
| M4 | Insecure fallbacks were active whenever `NODE_ENV` was not exactly `production`: the JWT secret `dev-secret`, the mail key, and reset tokens echoed in API responses | `services/auth.ts`, `middleware/auth.ts`, `routes/auth.ts`, `services/mailer.ts` | FIXED | `isDevOrTest()` requires `NODE_ENV=development\|test` (or Vitest). Otherwise there is no fallback. | No |
| M5 | The email outbox kept live reset and verification links, defeating token hashing; this also reached backups | `services/mailer.ts` | FIXED | Link tokens are removed from the stored copy once sent. Unsent rows keep them until delivery; those tokens expire. | No |
| M6 | The access log recorded share tokens, GSTINs and search terms | `app.ts` `morgan('tiny')` | FIXED | `utils/safeUrl.ts` redacts them. | No |
| M7 | No retention for sign-in records | none existed | PARTIAL | `services/retention.ts` runs daily. It deletes used or expired reset and verification tokens after 7 days, and ended sessions after 90 days. Sign-in events are deleted only if `AUTH_EVENT_RETENTION_DAYS` is set. | Retention periods |
| M8 | Backups were world-readable, unencrypted and kept on the same host | `deploy/backup.sh` | PARTIAL | `umask 077` and `chmod 700` on the directory. Encryption and an off-host copy are still needed. | Yes |
| M9 | `GET /account/overview` showed every company's PAN, GSTIN, totals and users' emails to anyone with Company Profile VIEW in any one company | `routes/account.ts:32-130` | REPORTED | Restrict it to account owners or admins, or to companies the caller belongs to. | Intended audience |
| M10 | `GET /security/events` is account-wide: the IPs, browsers and emails of all users | `routes/security.ts:344-366` | REPORTED | Scope by company or admin. | Yes |
| M11 | SSRF: the SMTP test and the e-invoice `baseUrl` dial any host and reflect the errors | `routes/email.ts:110-145`, `services/einvoice.ts` | REPORTED | Block private and link-local ranges and stop reflecting raw errors. Self-hosters may need internal SMTP, hence an owner choice. | Yes |
| M12 | The e-invoice `headersJson` field may hold API keys; it is stored in plaintext, shown to settings viewers and exported | `routes/einvoice.ts:48`, `routes/dataExport.ts` | REPORTED | Encrypt it like the other secrets, strip it from the export and mask it in the UI. | No |
| M13 | The branch-membership route upserts an org membership for any user id without checking the branch belongs to the org | `routes/users.ts:705-728` | REPORTED | Validate the branch ids and the user. | No |
| M14 | Password policy is 8 characters on sign-up, reset and admin set; the org policy fields `requireVerifiedEmail`, `accessTokenMinutes` and `sessionDays` are stored but not enforced | `auth.ts:509,792`, `security.ts:44-55` | REPORTED | Enforce them or remove the settings. | Policy |
| M15 | Account enumeration: sign-up says "User already exists"; login timing differs for unknown emails | `auth.ts:516,156` | REPORTED | Neutral sign-up reply plus a dummy bcrypt compare. | UX trade-off |
| M16 | Contrast failures | `packages/ui/src/index.css` | FIXED | See §12. | No |
| M17 | Field borders are 1.48:1 against white; WCAG 1.4.11 asks 3:1 for component boundaries | `--border-field` | REPORTED | Visual-identity decision. The accessibility statement discloses it. | Design |
| M18 | The GSTIN lookup (a paid upstream) has no rate limit | `routes/gstin.ts:85` | REPORTED | Add a limiter. | No |
| M19 | No record of what a person agreed to at sign-up | — | FIXED | The sign-up notice links the terms and privacy notice. `User.noticeVersion` and `noticeAcceptedAt` are stored (migration `20261002090000_user_notice_acceptance`). | Wording |

### LOW

| Issue | Location | Status |
|---|---|---|
| Nine icon-only buttons had no accessible name | `App.jsx:6837,7345`, `purchase/index.jsx:1199`, `GovernanceSettings.jsx:168,299,422`, `SecuritySettings.jsx:183`, `ReportsWorkspace.jsx:922` | FIXED |
| Empty-state drawings announced as images with no name | `Illustration.jsx:47` | FIXED (`aria-hidden` when unlabelled) |
| POS quantity buttons labelled "More" / "Less" | `PosScreen.jsx:557-561` | FIXED ("Increase quantity of …") |
| GST report "Apply" button did nothing | `App.jsx:10952` | FIXED (removed; the filters apply on change) |
| Sign-in and sign-up errors were not announced | `SignIn.jsx`, `SignUp.jsx` | FIXED (`role="alert"`, password hint linked) |
| Script-driven smooth scroll ignored reduced motion | `useFieldErrors.js:90` | FIXED |
| Vite favicon still the first icon; no meta description; unused boilerplate | `index.html`, `public/vite.svg`, `react.svg`, `App.css` | FIXED |
| Sign-up accepted `mobile` and discarded it | `auth.ts:511` | FIXED (field removed) |
| A legacy `userEmail` value stayed in localStorage | `main.jsx` | FIXED (removed on start) |
| `/api/auth/*` own token check is not revocation-aware | `routes/auth.ts:56` | REPORTED |
| Refresh token still accepted in the request body | `utils/refreshCookie.ts:62-67` | REPORTED |
| Payroll PAN and bank numbers in plaintext at rest (masked in the API) | payroll schema | REPORTED |
| Deleting an org cascades away its audit log | `schema.prisma:1135` | REPORTED |
| Charts lack text or table alternatives | `CircularCharts.jsx` | REPORTED (disclosed) |
| Comparative and "guarantee" copy | `Home.jsx:305,357` | REPORTED (§16) |
| Old brand "Neev" in served copy | `featureCatalog.ts:378`, cache name `neev-static-v1`, cookie `neev_rt` | REPORTED |

### INFO
- No analytics, advertising, session recording or fingerprinting anywhere. No cookie banner is needed (§4).
- The service worker caches only static assets, never `/api/`, and is not registered.
- Uploads are small and kept in the database. Nothing is served publicly.
- Passwords use bcrypt with 12 rounds. Stored SMTP, IRP and OIDC secrets use AES-256-GCM.
- The payroll API masks PAN and bank account numbers without reveal permission.

---

## 3. Privacy policy — §1
Implemented as `#/legal/privacy` (`packages/shell/legal/documents.jsx`, `PrivacyNotice`). It covers:
- the two roles: the operator as fiduciary for account data, and the business for its own records;
- every data category in §6;
- the purposes, recipients (hosting, SMTP, and the optional GSP, IRP and TypeSafe), retention, and security as implemented;
- the rights, with the actual mechanisms (data download, correction, the erasure request, grievance contact, the Data Protection Board, nomination);
- children and changes.

It makes no claim the code does not support. Operator facts are placeholders until set.

## 4. Cookie policy and consent — §3, §4
Inventory (also published at `#/legal/cookies`):

| Name | Type | Purpose | Essential | PD |
|---|---|---|---|---|
| `neev_rt` | Cookie, HttpOnly, SameSite=Strict (prod), Secure (prod), path `/api/auth`, 30 d | Refresh / stay signed in | Yes | Session reference |
| `token` | localStorage | Access token | Yes | User and account ids |
| `activeOrgId`, `activeBranchId`, `branchId`, `activeWarehouseId`, `lastSelection:v1`, `dashboardBranchIds` | localStorage | Working context | Yes (functional) | No |
| `uiTheme`, `uiDensity`, `navCollapsed`, `notifSeenKey`, `ledger_expanded_*`, `neev:tip:*` | localStorage | Preferences | Functional | No |
| `app-table-widths:*`, `*:hiddenCols`, `report-*` | localStorage | Layout choices | Functional | No |
| `pickerRecents:v1` | localStorage | Recently picked records (ids) | Functional | Ids only |
| `theme-preset`, `theme-dark-mode`, `onboarded:org:*` | localStorage (legacy) | Old preferences | — | No |
| `userEmail` | localStorage (legacy) | — | — | **Email; now deleted on start** |

**Consent:** not required. There are no non-essential trackers or third-party cookies, so nothing optional loads. No banner was added; adding one would ask a question that has no effect. If analytics are ever added, they must load only after opt-in. The cookie notice commits to that.

## 5. Refund / cancellation — §5
**Not applicable.** The operator sells nothing and takes no payments. The terms carry a marked placeholder under "Fees". If billing is introduced, write a refund and cancellation policy then.

## 6. Form consent — §6

| Form | Personal data | Consent / disclosure | Change |
|---|---|---|---|
| Sign-up (`SignUp.jsx`) | name, email, password | **Was none** | Notice with links to the terms and privacy notice, plus a record of the notice version. No checkbox: creating the account is the agreement, and an unavoidable box adds nothing. |
| Sign-in | email, password | n/a | Policy links in the footer |
| Company set-up | company name, GSTIN, state | Covered by the notice | — |
| Profile | names, username, phone, photo | Optional fields | Privacy section added |
| Customers, vendors, employees (business records) | third-party PD | The business is the fiduciary; it must give its own notice to its customers and employees | Owner/business responsibility, noted in the privacy notice |
| User invitations | invitee email, name | Invitation email | — |
| CSV imports | third-party PD | As business records | — |

No marketing consent exists, because no marketing is sent. No pre-checked boxes exist.

## 7. Data minimisation — §7

| Field | Finding | Action |
|---|---|---|
| Sign-up `mobile` | Accepted, never stored | Removed from the API |
| `User.phone`, `avatarUrl` | Optional and user-supplied | Keep |
| `AuthEvent.email` for unknown emails | Stores whatever was typed into the login form | Keep for security; retention set by the operator (`AUTH_EVENT_RETENTION_DAYS`) |
| `Session.ip`/`userAgent`, `PasswordResetToken.requestedIp` | Security purpose | Now purged (§2 M7) |
| `EmailOutbox.bodyText` | Full message bodies | Tokens stripped; consider a retention period |
| `ImportRow.raw` | Keeps the original CSV rows indefinitely | **Owner:** purge after the import is confirmed? |
| Payroll PAN, UAN, PF, ESI, bank | Statutory payroll needs | Keep; encrypt at rest (LOW) |
| `localStorage.userEmail` | Legacy, unneeded | Removed |

No business field was deleted.

## 8. Tracking audit — §8

| Tracker | Purpose | Where loaded | Data sent | Consent required? | Current control |
|---|---|---|---|---|---|
| Google Analytics, GTM, Meta Pixel, Clarity, Hotjar, Mixpanel, Amplitude, Segment, PostHog, Sentry, LogRocket | — | **Not present** (searched the repo, excluding node_modules and dist) | — | — | — |
| Fingerprinting / session recording | — | Not present ("fingerprint" in `stockSync.js` is a record hash) | — | — | — |
| Custom telemetry | — | Not present | — | — | — |
| Google Fonts (removed) | Typeface | `index.css:6` (before) | Visitor IP, user agent, referrer | Arguably yes | **Removed** (self-hosted) |
| Server access log | Operations | API process | Method, redacted path, status, timing | No (legitimate operation) | Redaction added |

Nothing executes before consent, because nothing optional exists.

## 9. Third-party embeds and services — §9

| Service | Kind | Loaded / called | Data | Control |
|---|---|---|---|---|
| Google Fonts | Font CDN | Browser, before sign-in | IP | **Removed** |
| WhatsApp (`wa.me`) | Deep link | Opened by the user | Customer name, invoice number, amounts, share link — typed by the user and sent from their own WhatsApp | User-initiated |
| `mailto:` | Link | User | As above | User-initiated |
| GST Suvidha Provider (GSTIN lookup) | Server API, optional (`GSTIN_LOOKUP_URL`) | Server | GSTIN | Off unless configured |
| IRP / GSP e-invoice | Server API, per business | Server | Full e-invoice payload | Business opt-in |
| SMTP | Server | Server | Recipient, email body | Operator or business configures |
| TypeSafe (`api.typesafe.ai`) | Server AI API, optional (`TYPESAFE_API_KEY`) | Server | Job title, duties, role names | Off unless configured |
| YouTube, maps, chat, CAPTCHA, payment widgets | — | **None** | — | — |

The CSP (report-only) records any future third-party load as a violation.

## 10–14. Accessibility (WCAG 2.2 AA, where reasonably applicable)
Checked: semantics and landmarks in the new pages, labels, names of icon controls, dialogs (existing Modal), contrast tokens, zoom (the viewport does not block it), and reduced motion.

Fixed:
- §11: icon button names and decorative SVGs.
- §12: contrast (below).
- §14: labels.
- Error announcements, reduced-motion scroll, and focus moved to the heading on the legal page.

| Token pair (as rendered) | Before | After |
|---|---|---|
| Graphite (live default) `--fg-subtle` on the page ground | 4.40:1 ✗ | 4.81:1 |
| `--warn` on white | 4.48:1 ✗ | 5.12:1 |
| Orange theme `--fg-subtle` on the ground | 4.35:1 ✗ | 4.75:1 |
| Orange theme primary/brand button, white on orange | 3.46 / 2.86:1 ✗ | 4.53:1 (dark theme keeps 11.3:1) |
| Orange theme focus ring on white | 2.86:1 ✗ | 4.53:1 |
| Orange text uses (badges, link hover, avatar, 17 components) | 2.86:1 ✗ | `--brand-ink` 5.18:1 |
| Field border vs white | 1.48:1 ✗ | Unchanged — owner/design decision (M17) |

Note: Graphite is the live theme (`DESIGN.md` §Color). Its `:root` block in `index.css` overrides the older orange tokens, so the orange-theme fixes are latent and apply only if that theme returns.

**Not done (recorded):**
- No automated axe run. axe-core is not a dependency; adding one is suggested.
- No screen-reader pass.
- Keyboard testing of every custom control (pickers, tables, command palette) was not repeated in this audit; earlier work covered pickers and menus.
- Charts lack text alternatives.
- The accessibility statement says all of this rather than claiming conformance.

**§13 keyboard:** the global `:focus-visible` ring applies to every interactive element (`index.css:784`). The new legal pages use plain links and buttons in DOM order.

**§14 labels:** no "Go", "OK", "Click here" or "Submit" buttons exist. The one dead "Apply" button was removed. `window.confirm` in `InvoiceFieldSettings.jsx:131` still shows the browser's OK/Cancel (LOW).

## 15. Reviews and testimonials — §15
None exist: no testimonials, ratings, customer counts or logos. The hero trial balance was unlabelled sample data and is now marked "sample figures". `BillingPreview.jsx` is already labelled sample.

## 16. Unsupported claims — §16

| Claim | Location | Action |
|---|---|---|
| "Runs on your own server. Your records never leave it." | `Home.jsx:187` | **Replaced** (false for the hosted deployment) |
| "Self-hosted GST accounting" | `Home.jsx:420` | **Replaced** |
| "Your records stay on your server" | `AuthLayout.jsx:100` | **Removed** |
| "Accounting, Payroll, People and Projects on one platform" | `AuthLayout.jsx:69` | **Qualified** ("People and Projects to follow") |
| "The boring guarantees, written down" — immutable postings, hash chain, integer paise | `Home.jsx:357-371` | Backed by code (`ledger.ts`, `invoiceMutation.ts`). "Guarantee" is a legal word: **owner review** |
| "Six things most accounting software leaves to you" | `Home.jsx:305` | Comparative claim needs evidence: **owner review** |
| "GST that matches the return… line for line" | `Home.jsx:42` | Product claim: **owner review** |
| "Four applications that already know each other" | `Home.jsx:266` | Two are marked "Coming": **owner review** |
| "Books that balance themselves." | `manifest.webmanifest` | Puffery, low risk |
| "Stored encrypted and never shown again." | `EmailSettings.jsx:273` | True (AES-GCM, write-only) |

There are no "#1", "best", "100% secure", "certified", "government approved" or "compliant" claims.

## 17. Business details — §17
No operator name, address, registration number, contact or grievance details appear anywhere. These are now configurable (`packages/platform/operator.js`, `VITE_*` variables) and shown on every legal page, with a "Draft" banner until set. The email sender defaults to `no-reply@localhost` (`mailer.ts:24`); set `MAIL_FROM` and `APP_NAME`. Under DPDP, a significant data fiduciary also needs a Data Protection Officer: **owner/legal**.

## 18. Asset provenance — §18

| Asset | Source | Licence | Attribution required | Commercial use | Action |
|---|---|---|---|---|---|
| Clor logo (`public/icon.svg`, `ClorMark.jsx`) | Made for this project (inline SVG) | Owner's | No | Owner's | Confirm ownership and trademark search |
| `packages/ui/src/assets/hero-illustration.webp` (125 KB, hand and leaves) | **Unknown** — comment says "the file from the design" | **Unknown** | Unknown | **Unknown** | **Owner: confirm source and licence, or replace** |
| `AuthIllustration.jsx`, `Illustration.jsx` (inline SVG drawings) | Written in code for this project | Owner's | No | Yes | None |
| Inter typeface (`@fontsource-variable/inter` 5.3.0) | Rasmus Andersson / Fontsource | SIL OFL 1.1 | Licence must ship with redistributed font files (it does, in the package) | Yes | None |
| lucide-react 1.41.0 | Lucide | ISC | Keep the licence notice | Yes | None |
| @phosphor-icons/react 2.1.10 | Phosphor | MIT | Keep the licence notice | Yes | None |
| echarts 6.1.0 / zrender | Apache | Apache-2.0 / BSD-3 | NOTICE file | Yes | Include NOTICE in distributions |
| jspdf, jspdf-autotable, qrcode, sonner, write-excel-file, react, tailwindcss | — | MIT | Keep notices | Yes | None |
| `public/vite.svg`, `react.svg` | Vite / React boilerplate | MIT | — | — | **Removed** |
| Videos, audio, stock photos, Lottie | None found | — | — | — | — |

There is no third-party notices file. Generating one at build time (for example with `license-checker`, declared as a devDependency) is suggested.

## 19. India DPDP Act — gap assessment

**Implemented controls (technical):**
- A notice exists, with purposes, categories, recipients, rights and grievance contact (draft).
- Notice at sign-up with a recorded notice version and time.
- Self-service access to personal data.
- Correction of profile data.
- Retention: automatic deletion of expired sign-in records.
- Security safeguards: bcrypt; HttpOnly refresh; session revocation now effective; encrypted stored credentials; RBAC; audit log; masking of payroll identifiers; restricted backup permissions; log redaction.
- No tracking and no third-party scripts.

**Missing controls (technical):**
- Erasure and account closure workflow.
- Consent withdrawal that actually stops processing; today it is only an emailed request.
- A nominee-recording mechanism.
- Breach detection and alerting (no monitoring or alerting exists).
- Effective tenant isolation in the database (H2).
- Encryption of backups and of payroll identifiers at rest.
- Retention for the email outbox, `ImportRow.raw` and audit logs.
- Self-service email correction.
- Consent and notice in Indian languages (DPDP s.5(3) lets people ask for the notice in Eighth Schedule languages).

**Operational / process controls required:**
- Appoint and publish a grievance officer, with a response time.
- A breach response plan: notify the Data Protection Board and the affected people.
- Processor agreements with the hosting provider, SMTP provider, GSPs and TypeSafe.
- A records-of-processing inventory.
- A data retention schedule.
- Staff access policy for production data.
- A periodic access review.

**Legal review required:**
- The fiduciary/processor split for business records.
- The lawful basis per purpose: consent versus "legitimate uses" under s.7.
- Whether the operator could be notified as a Significant Data Fiduciary.
- How long account data is kept after closure, set against GST and Companies Act record-keeping.
- Cross-border transfer, if hosting or TypeSafe is outside India.
- Children (the age 18 threshold).
- The final text of all four documents.

**Badge:** none added. Compliance cannot be shown from code.

## 20. Security and privacy engineering — §20
Covered in §2: C1, H1–H3, M2–M15, M18, and LOW.

Confirmed fine:
- No secrets committed; only `.env.example` files are tracked, and the git history is clean.
- No secrets in the frontend bundle (`VITE_API_BASE` only).
- Uploads are bounded.
- API user selects exclude `passwordHash`.
- Payroll masking.
- CORS uses an exact-match allow-list. LOW: it falls back to localhost origins if `CORS_ORIGIN` is unset.

---

## Validation (2 October 2026)

| Check | Result |
|---|---|
| Web tests (`vitest run`) | 160 files, 1368 tests passed (incl. new `legal.test.jsx`) |
| Server tests (`vitest run` in `server/`) | 80 files, 1010 tests passed (incl. new `identityAndSessions.test.ts`) |
| ESLint (`--quiet`) on changed web code | 0 errors |
| TypeScript (`server`, `tsc --noEmit`) | clean |
| Production build (`vite build`) | succeeded; 7 Inter woff2 files bundled; no `fonts.googleapis` reference |
| Browser: `#/legal/privacy` | renders, focus on the heading, Draft banner, placeholders, 4 policy links, **0 third-party hosts requested** |
| Browser: landing page | corrected hero copy, "sample figures", legal links in the footer |
| Broken links | the four `#/legal/*` routes resolve. `mailto:` links appear only when an address is configured |
| Automated accessibility scan | **not run** (no axe dependency) |
