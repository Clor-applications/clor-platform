# CLOR — Full Application Audit

**Date:** 19 Aug 2026 · **Auditor:** Accio · **Scope:** full repo (`src/`, `server/`, `deploy/`, `docs/`, build & test pipeline)
**Method:** static code review of security-critical paths, live verification of build/test/lint, repo-hygiene checks, targeted web research (competitors, India compliance), reconciliation against the project's own [REVIEW.md](docs/REVIEW.md) / [STATUS.md](docs/STATUS.md).

---

## 0. Executive summary

**Verdict: a genuinely hardened prototype — not yet a production accounting product, but closer than the docs suggest.**

This is a multi-tenant, India-GST cloud accounting platform (React 19 + Vite frontend; Express 4 + TypeScript + Prisma 5 backend; SQLite today, Postgres optional). The product name is **CLOR**.

Three things stand out as **real strengths**:

1. **Auth is seriously hardened** — beyond what most startups ship: hashed refresh tokens with rotation and reuse-detection, DB-backed password-reset tokens (crypto-random, single-use), account lockout, per-IP+identity rate limiting, server-side logout/session revocation, and a full auth-event log.
2. **The ledger core is sound**: real double-entry `JournalEntry`/`JournalLine`, balanced-or-rejected postings, control accounts by `controlKind` (rename-safe), immutable posted entries with a SHA-256 hash chain, and fiscal-period locks. **209 tests pass** across 20 files.
3. **Tenancy isolation is well designed**: Account → Org → Branch → Warehouse enforced in middleware, org-membership + branch-membership checks on every request, orgId-mismatch guards in every route.

The **blocking problems** are persistence and compliance last-mile:

- **The book of accounts still lives mostly in browser localStorage** (`accountingDB:<accountId>:<orgId>`, managed from a 12,092-line `App.jsx`). Invoices and payments now sync to the server, but fixed assets, cost centres, price lists, POS day-close, journal entries and most masters are still client-only. Clearing site data destroys books. This alone blocks selling the product.
- **SQLite single-writer** and `$queryRawUnsafe` with SQLite `?` syntax throughout — the Postgres migration is not trivial.
- **GSTR-1 export is missing the mandatory HSN summary** and doesn't handle B2CL / reverse charge — GST portal filing would fail or invite notices.
- **No per-field financial audit trail** (only user CRUD + auth events) — fails the Companies Act audit-trail expectation and blocks Pvt Ltd customers.
- **No CI, no verified container run** (compose validates but the Docker engine never answered on this host), and the test suite **cannot start on the documented Node 20** (vitest 4/rolldown requires newer Node; passes on Node 25/26).

**Market-readiness: not ready for general sale.** With the roadmap executed (est. 3–6 months of focused engineering), the multi-branch + unlimited-users pricing wedge is a credible, differentiated position in the Indian SMB segment.

---

## 1. Application overview

| Layer | Tech | State |
|---|---|---|
| Frontend | React 19, Vite 7, Tailwind 3, echarts, jspdf, lucide | ~26k lines JS/JSX; builds OK (two >1 MB chunks) |
| Backend | Express 4.19, TypeScript, Prisma 5, zod, JWT + refresh rotation | `npm run build && npm start` works; typecheck clean |
| Data | SQLite (dev/default), optional Postgres profile; server uses `Decimal` for money | No migration history; schema via `db push` |
| Book of accounts | **browser localStorage** for most voucher types; server GL authoritative for invoices/payments | transitional — the critical gap |
| Tests | vitest + supertest, 20 files, **209 passing** (Node 25/26) | cannot start on Node 20.12 |
| Deploy | Docker compose + Caddy HTTPS + nightly backup script, single VPS | compose validates; end-to-end run unverified |
| API surface | 24 route modules: auth, orgs/branches/warehouses, roles/permissions/users, invoices, bills, payments, parties, items, ledger, transfers, imports, e-invoice, e-way bill, FX, batch/serial, security/policy, email | broad |

---

## 2. Security audit (verified, not just doc claims)

Severity: **P0** = exploitable/blocks production · **P1** = serious · **P2** = hygiene/defense-in-depth.

### 2.1 Previously reported gaps — current state (C-1 … C-10 from REVIEW.md)

| # | Finding | State | Evidence |
|---|---|---|---|
| C-1 | Hardcoded superuser email (`isOwnerUser`) | **FIXED** | No `isOwnerUser`/`anandgowda` references in repo |
| C-2 | Invoice routes had no permission check | **FIXED** | All 5 invoice routes gate on `SALES::Invoices`; RBAC tests assert 403 on EDIT/DELETE |
| C-3 | Login not account-scoped | **FIXED** | Email unique globally (create + rename); login returns orgs + activeOrgId/branchId |
| C-4 | RBAC self-escalation (permission check mutates permission table) | **OPEN (deliberate)** | `rbac.ts:ensureOwnerPermissionForCreator` grants missing permission to org creator's Owner role on 403. Documented trade-off until role-management UI exists — **must be replaced by explicit bootstrap before multi-tenant launch** |
| C-5 | Reset tokens via `Math.random()` in a module Map | **FIXED** | `crypto.randomBytes(32)`, SHA-256 hashed, DB-persisted, single-use, 30-min expiry, old tokens invalidated; email-verify tokens likewise |
| C-6 | No rate limiting / lockout / email verification | **FIXED** | login 10/15min per IP+identity, signup 5/h, reset 5/h (IPv6 key bug fixed + regression test); DB-backed lockout (8 fails → 15 min, policy-configurable); email verification implemented (non-blocking at signup) |
| C-7 | JWT in localStorage, no refresh/revocation | **PARTLY FIXED** | Server side complete: 15-min access tokens, refresh rotation with **reuse detection that revokes all sessions**, server-side logout, session list/revoke-all, `sid` claim. **Remaining:** tokens still stored in localStorage (XSS-readable) — mitigated by short TTL, but consider httpOnly cookie or in-memory session storage |
| C-8 | `POST /api/users` accepts unvalidated `orgIds`/`branchIdsByOrg` | **OPEN** | Memberships created with caller's `accountId` + body-supplied `orgId`; no check that the org belongs to the caller's account. No data leak today (queries filter `accountId`), but it is an unvalidated cross-account foreign key — validate org/branch ownership server-side |
| C-9 | `$queryRawUnsafe`/`$executeRawUnsafe` everywhere | **OPEN** | invoices.ts, governance.ts, parties.ts, payments.ts, revaluation.ts, approvals.ts. Values are bound (not injectable), but hardcoded SQLite `?` syntax blocks the Postgres switch (D-1); raw `UPDATE Invoice SET status` in governance bypasses Prisma |
| C-10 | Dev-mode leaks (login oracle, `devToken`) | **FIXED-BY-CONFIG** | Uniform "Invalid credentials"; `devToken`/`devVerifyToken` returned only when `NODE_ENV !== 'production'`; 500s masked and stacks not returned in production. **Operational requirement:** deploy with `NODE_ENV=production` set (Dockerfile must guarantee it) |

### 2.2 New findings in this audit

| # | Sev | Finding |
|---|---|---|
| S-1 | P1 | **Express 4.19.2 is outdated.** 4.20+ backported the path-to-regexp DoS fix (CVE-2024-29041, CVE-2024-39001 class). Upgrade express and run `npm audit` as part of CI. |
| S-2 | P1 | **No rate limiting on authenticated write endpoints.** Only auth routes are limited. Add per-tenant quotas (e.g., invoice creation) and a global limiter; the in-memory store is per-process — multi-instance deployment needs Redis. |
| S-3 | P1 | **No pagination on any list endpoint** (`GET invoices` returns every row). Unbounded response = memory/CPU DoS and a UX cliff at scale. |
| S-4 | P2 | **Frontend book in localStorage is also a security surface**: anyone with console access can read/edit all financial data of a signed-in user. With JWT also in localStorage, an XSS anywhere (including a compromised npm dep) exposes both credentials and books. Move the book server-side; this is the same fix as A-1. |
| S-5 | P2 | **helmet defaults only** — no tuned CSP (jspdf/html2canvas may need allowances), no HSTS max-age tuning. Verify security headers against the production SPA before launch. |
| S-6 | P2 | **`.env.example` still contains `JWT_SECRET="change-me"`** — fine as a template, but ops risk if copied; `env:init` generates real secrets (good). |
| S-7 | P2 | Demo seed `password: 'admin123'` shipped in `src/data/db.js` (frontend demo data) — remove or gate to demo builds; scan tools will flag it. |
| S-8 | P2 | **CORS default is dev-only** when `CORS_ORIGIN` unset — good default; must set explicitly in production or the app will break (also prevents accidental exposure). |
| S-9 | P2 | No `engines` field pinning Node; server code uses modern JS. Combined with the vitest/rolldown issue (below), the documented dev environment is broken as shipped. |

### 2.3 What is genuinely good (keep it)

- Tenant isolation chain is the strongest part of the codebase — org + branch membership enforced in `requireTenantContext`, orgId-mismatch checks in every route, warehouse access scoped separately.
- Error handler never leaks internals in production; zod validates all bodies; `express.json({limit:'1mb'})` caps payloads.
- Refresh-token reuse detection (revoke-all on replay) and constant-time comparisons (`timingSafeEqual`) are best practice.
- Secrets (SMTP passwords, e-invoice client secrets, NIC keys) stored AES-256-GCM encrypted and never returned by the API.

---

## 3. Compliance audit (India)

### 3.1 e-Invoice & e-Way Bill — genuinely integrated

- **Real IRP integration, not a stub**: NIC direct API (RSA auth handshake, AES-256-ECB payload) and GSP REST gateways; IRN, Ack No, Signed QR, SignedInvoice stored on the invoice row; **24-hour IRN cancellation window enforced**; e-way bill generation from IRN (single call).
- Credentials are org-scoped, encrypted at rest, feature-flagged, and RBAC-protected. Settings endpoint never returns secrets.
- **Caveat:** the client builds the INV-01 payload — the GSTN schema validation happens at the IRP, not before; add a client-side validation layer to catch schema errors before the API call.

### 3.2 GST engine — strong base, three filing-blocking gaps

| Item | Status | Risk |
|---|---|---|
| 38 state codes, intra/inter-state detection | ✔ Correct | — |
| CGST/SGST 50/50 vs IGST split | ✔ Correct | — |
| Discount applied to taxable value before tax | ✔ Correct (statutory requirement) | — |
| GSTR-1: B2B, B2CS, CDNR export | ✔ Present | — |
| **GSTR-1 HSN summary (Table 12)** | ✖ **Missing** | **HIGH — portal rejects filings without HSN summary for B2B** |
| **B2CL (inter-state to unregistered > ₹2.5L)** | ✖ Aggregated into B2CS | MEDIUM — mis-classification triggers notices |
| **Reverse charge (RCM)** | ✖ Hardcoded 'N' | MEDIUM — blocks services SMBs (GTA, legal, commission agents) |
| GSTR-3B tables 3.1(a), 4(A)(5) | ✔ Computed | — |
| GSTR-2B reconciliation | ✖ Manual JSON upload only (no GSTN API pull) | LOW (usable) |
| e-Way bill standalone (non-e-invoice taxpayers) | ✖ Only via IRN | MEDIUM |
| TDS 194Q / TCS 206C(1H) | ✔ Report + journal logic present | LOW |
| Tally XML export | ✔ Present | — |

**GSTR-1 filing note:** the current GSTR-1 report is on-screen/JSON only — users cannot file directly; confirm the JSON export conforms to the GSTN schema before claiming "filing".

### 3.3 Record retention & audit trail — legal exposure

- **GST Act:** records must be kept 72 months; **Companies Act 2013 s.128:** 8 years, and the Accounts Rules require an **uneditable audit trail of every change**. Current `AuditLog` covers user CRUD and some admin actions; **financial document/ledger edits are not logged per-field** (the ledger hash chain covers postings, not edits to invoices/bills/parties). **Blocker for Pvt Ltd customers; medium risk for others.**
- No archival/retention policy or data-export tooling for the server side (frontend export is the localStorage blob).

### 3.4 DPDP Act 2023 — not addressed

- The platform processes PAN, GSTIN, bank details, phone numbers — sensitive personal data of data principals.
- **Missing:** notice-and-consent capture at signup, purpose limitation statements, a 72-hour breach-notification workflow to the Data Protection Board, data-minimisation and deletion/erasure tooling, and a documented data-residency position (Indian data centres recommended).
- Severity: P1 for launch (enforcement is ramping; an accounting SaaS with zero consent machinery is a liability).

---

## 4. Feature inventory (verified)

### 4.1 Frontend modules (`src/features/`, 17 modules)

| Module | Capability |
|---|---|
| accounting | Fixed-asset register (WDV depreciation), cost centres (P&L by vertical), year-end closing |
| accounts | Chart of accounts, ledger groups, account types |
| admin | Branches, warehouses, users, roles (RBAC) |
| approvals | Multi-level document approval inbox |
| cashBank | Cash/bank accounts, manual statement import + reconciliation |
| companies | Multi-company + org hierarchy |
| dashboard | Sales/expense/receivables/payables charts |
| data | Batch import (Excel/JSON) for masters + transactions |
| inventory | Item master, batch & serial tracking, reorder alerts |
| marketing | Public landing page |
| parties | Customers/vendors, GSTIN validation |
| payments | Receipts, disbursements, reconciliation |
| pricing | Price lists, discount rules |
| purchase | PO → Bill → Debit note |
| reports | Balance sheet, P&L, cash flow, GSTR-1/3B/2B, TDS/TCS, Tally XML |
| sales | Estimates, sales orders, invoices, credit notes, **POS screen** |
| settings | Company profile, multi-currency, email/SMTP, numbering series |

### 4.2 Server-backed vs client-only (transitional state)

| Area | Server-backed | Still client-only (localStorage) |
|---|---|---|
| Core accounting | GL, trial balance, invoices, bills, payments, FX revaluation | Fixed assets (depreciation), cost centres, year-end close, journal entries |
| Masters | Items, parties, branches, warehouses, users/roles | Price lists, recurring-invoice templates |
| Operations | Transfers, e-invoice/EWB, approvals, imports | POS day-close (Z-reports), GSTR-2B reconciliation |
| Platform | Auth, sessions, policy, audit events | UI prefs, onboarding |

### 4.3 Missing standard features (verified absent)

Payroll/HRMS · automated bank feeds (Plaid/Yodlee/Salt Edge) · budgets vs actuals · customer/vendor portal · payment links (Razorpay/Stripe) · direct GSTN API pulls (2B, filing) · native mobile app · server-side backup/restore UX · real-time sync/offline conflict handling.

---

## 5. Gap analysis — verified against REVIEW.md (16 Aug) and current code

### A. Data architecture

| Gap | Status (verified 19 Aug) |
|---|---|
| A-1 Books in localStorage | **OPEN — P0.** `App.jsx:9596` builds `accountingDB:<accountId>:<orgId>`; whole book still `setDb`-managed. Invoices/payments now server-synced; the rest is not. |
| A-2 Invoice sync write-only | **PARTLY.** Creation pushes to server; full read-back/reconciliation on load still not landed. |
| A-3 No real double-entry GL | **FIXED.** Control-account-by-`controlKind`, balanced-or-rejected, hash-chained, immutable postings; invoice→GL and reversal verified by tests. |
| A-4 No period lock | **FIXED.** Posting into locked period → 409 (tested). |
| A-5 No audit trail | **PARTLY.** Entry immutability + hash chain done; per-field document audit log missing (see §3.3). |
| A-6 Client numeric IDs | **PARTLY.** Server entities use cuid; localStorage entities still max+1. |
| A-7 Money as float | **PARTLY.** Server uses Prisma `Decimal` for money; client still JS numbers (round2 at edges). |
| A-8 Client-side numbering | **PARTLY.** Server has `NumberSeries` allocation in-transaction + unique index on invoices; other docs still client-numbered. |

### B. Build / runtime / ops

| Gap | Status (verified) |
|---|---|
| B-1 Server build broken | **FIXED.** `npm run build && node dist/index.js` boots (verified). |
| B-2 No containers/CI | **PARTLY.** compose validates (`docker compose config` OK); **container run unverified** (daemon never answered on this host); **no CI exists**. |
| B-3 Secrets committed | **FIXED.** `.gitignore` covers `.env`, `*.db`, `dist`, logs, tmp; `git ls-files` shows only `.env.example` files; real `.env` on disk ignored. |
| B-4 Zero tests | **FIXED+.** 20 files / **209 tests pass** on Node 25/26 — but the suite **fails to start on Node 20.12** (vitest 4 + rolldown `styleText` incompatibility). Pin a Node version (`engines`) or downgrade vitest. |
| B-5 Windows-only tooling | **FIXED.** |
| B-6 Working-tree junk | **PARTLY.** `dist/`, `server/dist/`, `logs/`, `server/logs/`, `tmp/`, `_backup_before_onedrive_restore/` still on disk but gitignored (220 KB backup dir, 2.7 MB logs). |
| B-7 Not a git repo | **FIXED.** `main` branch, clean status. |
| B-8 No server lint/typecheck | **PARTLY.** Typecheck clean; **frontend lint: 26 errors / 44 warnings** (mostly react-hooks memoization noise, but `npm run verify` fails today); server has no lint script. |

### C. Backend completeness

| Gap | Status (verified) |
|---|---|
| D-1 SQLite only | **OPEN.** Postgres profile exists but raw SQL uses SQLite `?`; no `prisma/migrations` history. |
| D-2 No API for domain | **MOSTLY FIXED.** parties, items, purchase docs, quotes, payments, expenses, credit/debit notes, currencies, imports, batch/serial, revaluation all have routes + schema now. |
| D-3 Dual item catalogs | **PARTLY.** `ItemMaster` server-side; frontend items still localStorage → transfers can reference unknown items. |
| D-5 Negative stock / adjustments | **OPEN (per code).** Transfers reduce stock with no negative guard; adjustments recorded but not applied to `StockBalance`. |
| D-6 No pagination | **OPEN.** See S-3. |

### E. Frontend quality

| Gap | Status |
|---|---|
| E-1 10.5k-line App.jsx | **OPEN — now 12,092 lines** (+3,721-line db.js). Unreviewable; whole-book re-serialisation per edit. |
| E-2 No routing | **OPEN.** `react-router` absent; `useState` navigation; no deep links. |
| E-3 Client permission gating | **PARTLY.** `/auth/me` returns `isOrgAdmin` + `allowedBranchIds`; menu gating ad-hoc. |
| E-4 alert() UX | **OPEN** (per prior review; not re-audited in depth). |
| E-5 i18n/a11y/responsive | **OPEN.** INR hardcoded in places. |
| E-6 Grid virtualization | **OPEN.** |
| E-7 activeOrgId on login | **FIXED.** |

---

## 6. Competitive comparison (data retrieved 19 Aug 2026)

### 6.1 Pricing landscape (INR, excl. GST)

| Product | Price | Model | Notes |
|---|---|---|---|
| Zoho Books | Free <₹25L turnover; Standard ₹749/mo; Premium ₹2,999/mo | Per user/org | Full GSTR-1/3B + e-invoice IRP; strong ecosystem |
| TallyPrime 7.1 | Silver ₹18,000 one-time; Gold ₹54,000; rental ~₹600/mo | Per machine | Desktop incumbent, huge CA network, connected services |
| Vyapar | ~₹699/yr mobile; ~₹2,399/yr desktop | Per user | Micro-business, offline-first |
| Busy | SMART ₹8,000/yr; POWER ₹12,000/yr | Per company | Multi-branch inventory strength |
| Marg ERP | Basic ~₹8,100/yr; Gold ~₹25,200/yr | Per company | Pharma/FMCG specialised |
| Odoo Accounting | Standard ~$31/user/mo; Custom ~$61/user/mo | Per user | Global ERP, `l10n_in` for GST |
| QuickBooks India | — | — | **Intuit exited India (2023)**; global SKU lacks native GST filing — a structural gap a new entrant can exploit |
| **CLOR (this app)** | undecided; docs recommend flat per-branch | **Unlimited users per branch** | Differentiator: branch = access boundary |

### 6.2 Feature matrix (2026 market standard vs this app)

| Feature | Zoho | Tally | Vyapar | Busy | CLOR |
|---|---:|---:|---:|---:|---:|
| GST invoicing | ✔ | ✔ | ✔ | ✔ | ✔ |
| GSTR-1/3B filing | ✔ Full | ✔ Full | JSON only | ✔ Full | **Partial (HSN gap)** |
| e-Invoice IRN/QR | ✔ | ✔ | ✔ | ✔ | ✔ (NIC/GSP direct) |
| e-Way bill | ✔ | ✔ | ✔ | ✔ | ✔ (via IRN) |
| Inventory valuation | FIFO/AVCO | Multi | Qty only | FIFO/AVCO | **Qty only** |
| Multi-branch as access boundary | Medium | Medium | No | Strong | **Excellent (native)** |
| Multi-user RBAC | ✔ | ✔ | ✖ | ✔ | ✔ (branch-scoped) |
| Bank reconciliation | Auto | Manual | ✖ | ✔ | Manual |
| Multi-currency | ✔ | ✔ | ✖ | ✔ | ✔ (dated rates, revaluation) |
| Payroll / projects | ✔ | ✔ | ✖ | ✖ | ✖ |
| Mobile app | Strong | Weak | Strong | Strong | ✖ |
| Offline mode | ✖ | ✔ | Partial | ✔ | Partial (localStorage) |
| Audit trail | ✔ | ✔ mandatory | ✖ | ✔ | **Partial** |
| Pricing | Per user | Per machine | Per user | Per comp | **Flat per branch** |

### 6.3 Positioning

- **Segment sweet spot:** multi-branch SMB distribution/retail (2–10 branches, 10–50 users) — currently squeezed by Zoho's per-user cost and Tally's lack of cloud sync. A flat per-branch price with unlimited users is a credible wedge.
- **Avoid:** micro/freelancer segment (Vyapar owns it) and mid-market ERP (Odoo).
- **Recommended message:** "The multi-branch cloud ledger for Indian distribution — stop paying per user, get Tally-like speed with Zoho-like cloud and industrial-grade branch permissions."
- **Suggested price:** ₹1,999/branch/month, unlimited users, free migration from Tally/Zoho (per project docs).

---

## 7. Market-readiness verdict

**Status: BETA — not ready for general sale; ready for a controlled pilot.**

| Dimension | Readiness | Blocker |
|---|---|---|
| Security | ~80% | localStorage book + raw SQL + express version + rate-limit scope |
| Compliance | ~60% | GSTR-1 HSN, B2CL, RCM, audit trail, DPDP |
| Features | ~75% | Inventory valuation, payroll, mobile, bank feeds |
| Engineering | ~60% | Postgres, CI, pagination, toolchain pinning, codebase splitting |
| Ops | ~50% | Docker run unverified, no monitoring/alerting, SQLite backups |

**Launch gates (must ship before first paying customer):**

1. **P0 — Books on the server (Postgres).** Complete the localStorage → API migration; kill `accountingDB`. Non-negotiable for a financial product.
2. **P0 — GSTR-1 HSN summary + schema-conformant JSON export** (and B2CL/RCM classification). Filing must not fail.
3. **P0 — Full audit trail** on financial mutations (uneditable per-field log) — Companies Act requirement.
4. **P1 — Pagination, per-tenant rate limits, express upgrade, Node engines pinning, CI (lint+test+build+deploy).**
5. **P1 — Verified Docker/HTTPS deploy with `NODE_ENV=production`, CORS_ORIGIN, monitoring + backup restore drill.**
6. **P1 — DPDP baseline**: consent at signup, privacy policy, breach-notification runbook, data-residency statement.
7. **P2 — Beta cohort (10–20 businesses) + CA partner validation of GSTR outputs** before general launch.

**Estimated effort: 3–6 months of focused engineering** (aligned with the project's own ROADMAP Phases 1–2).

---

## 8. Prioritised remediation roadmap

**Now (0–4 weeks) — stability & trust**
- Complete server-side book migration for remaining client-only modules (fixed assets, cost centres, journal entries, price lists, POS).
- GSTR-1: HSN summary, B2CL, RCM flag; export JSON validated against GSTN schema.
- Per-field audit log on invoices/bills/payments/parties/items edits.
- Fix `engines`/vitest so `npm test` works on the documented Node; add CI (GitHub Actions: lint → typecheck → test → build → api:build).

**Next (4–10 weeks) — production hardening**
- Postgres + `prisma migrate` history; replace `$queryRawUnsafe` with typed Prisma queries.
- Pagination on all list endpoints; per-tenant rate limits; express ≥4.20; `npm audit` clean.
- Remove RBAC self-escalation (C-4) once role UI exists; validate org/branch ownership in `POST /users` (C-8).
- Negative-stock guard + apply adjustments to `StockBalance`; inventory valuation (FIFO/AVCO) for BS correctness.
- Verified Docker deploy + restore drill; structured logging + request IDs + Sentry; `/metrics`.

**Later (10+ weeks) — competitive features**
- Payroll/HRMS (PF/ESI), automated bank feeds, payment links, customer portal, GSTR-2B auto-pull, standalone e-way bill, mobile app (PWA first), budgets, recurring invoices server-side.
- DPDP compliance program (consent, erasure, breach workflow, data residency).
- Split `App.jsx` by route, react-router, lazy-loaded reports, virtualised grids, i18n.

---

## 9. Sources

- Project docs: [docs/REVIEW.md](docs/REVIEW.md), [docs/STATUS.md](docs/STATUS.md), [docs/ROADMAP.md](docs/ROADMAP.md), [docs/ODOO-COMPARISON.md](docs/ODOO-COMPARISON.md), [docs/COMPETITORS-CUSTOMIZATION-MIGRATION.md](docs/COMPETITORS-CUSTOMIZATION-MIGRATION.md), [DEPLOY.md](DEPLOY.md)
- Competitor pricing retrieved 19 Aug 2026: zoho.com/in/books/pricing · tallysolutions.com · vyaparapp.in · busy.in/pricing · odoo.com/pricing · margcompusoft.com
- Compliance: cbic-gst.gov.in (e-invoice threshold) · meity.gov.in (DPDP Act 2023, s.8 breach notification) · mca.gov.in (Companies Act 2013 s.128)
- Verified locally: `npm run typecheck` ✔ · `npm test` 209/209 (Node 25/26) ✖ on Node 20.12 · `npm run build` ✔ (chunk warning) · `npm run api:build` ✔ · `docker compose config` ✔ · `git ls-files` secret scan ✔

*Audit performed statically + via live build/test runs; no penetration testing or live traffic was exercised.*
