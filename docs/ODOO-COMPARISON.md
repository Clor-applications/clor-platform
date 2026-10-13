# This App vs Odoo — Feature Gap, Workflow Gap, and What Launch Actually Requires

Companion to [REVIEW.md](REVIEW.md) and [ROADMAP.md](ROADMAP.md).
Baseline for comparison: **Odoo Community + Enterprise (Accounting, Invoicing,
Sales, Purchase, Inventory) with the Indian localization `l10n_in`**, as of
mid-2026. Verify Odoo pricing and India e-Invoice/e-Way-bill module coverage
against Odoo's current site before quoting any of it to a customer — that layer
changes release to release.

A note on framing before the tables: Odoo is a 15-year-old ERP with thousands of
modules and a full framework (ORM, workflow engine, report writer, studio, app
store). **Feature parity is not a goal worth having.** The useful questions are
(a) which gaps block a paying customer, (b) which gaps are structural rather than
missing screens, and (c) where this app can be *better* than Odoo rather than
smaller. Sections 1–3 answer (a) and (b), Section 5 answers (c).

Legend: **Yes** = works today · **Partial** = present but incomplete or
client-only · **No** = absent.

---

## 1. Capability scorecard

### 1.1 Customer side (order to cash)

| Capability | Odoo | This app | Gap |
|---|---|---|---|
| Quotations / estimates | Yes | Partial (local only) | Medium |
| Sales orders as a distinct, confirmable document | Yes | **No** (estimate jumps straight to invoice) | **Large** |
| Customer invoices | Yes | Partial (server-side, write-only sync) | **Large** |
| Credit notes | Yes | Partial (local only) | Medium |
| Delivery linked to invoice (invoice on delivered qty) | Yes | **No** | **Large** |
| Payment terms / due-date schedules | Yes | **No** (single due date) | Medium |
| Partial payments and payment allocation across invoices | Yes | Partial (paidAmount field, no allocation model) | **Large** |
| Follow-ups / dunning levels | Yes | **No** | Medium |
| Customer portal (view + pay online) | Yes | **No** | Medium |
| Online payment (gateway) | Yes | **No** | Medium |
| Recurring / subscription invoicing | Yes (Subscriptions) | **No** | Medium |
| Price lists, per-customer pricing | Yes | **No** | Medium |
| Multi-currency + FX revaluation | Yes | **No** (INR hardcoded) | Medium |
| Invoice PDF templates | Yes | Yes (jspdf, template picker) | None |
| Email the invoice from the system | Yes | **No** | Medium |
| CRM pipeline | Yes | **No** | Low (out of scope) |

### 1.2 Vendor side (procure to pay)

| Capability | Odoo | This app | Gap |
|---|---|---|---|
| RFQ → purchase order | Yes | Partial (PO exists, no RFQ stage) | Medium |
| Vendor bills | Yes | Partial (local only) | **Large** |
| Debit notes | Yes | Partial (local only) | Medium |
| Three-way match (PO ⇄ receipt ⇄ bill) | Yes | **No** | **Large** |
| Bill payment + batch payments | Yes | Partial (disbursement form) | Medium |
| Purchase approval rules / limits | Yes | **No** | Medium |
| Vendor price lists, blanket orders | Yes | **No** | Low |
| Vendor portal | Yes | **No** | Low |

### 1.3 Accounting core — the structural gap

| Capability | Odoo | This app | Gap |
|---|---|---|---|
| Double-entry general ledger (immutable journal items) | Yes | **No** — postings derived at render time from vouchers | **Critical** |
| Journals (sales, purchase, bank, cash, misc) | Yes | Partial (single journalEntries array) | **Large** |
| Chart of accounts with country templates | Yes | Yes (templated groups/types) | None |
| Control accounts referenced by ID | Yes | **No** — matched by name string ("accounts receivable") | **Critical** |
| Posted vs draft state on entries | Yes | **No** | **Large** |
| Period lock / fiscal year close | Yes | **No** | **Critical** |
| Year-end closing + opening balance carry-forward | Yes | **No** | **Large** |
| Inalterability / audit hash chain (required by several tax authorities) | Yes | **No** | **Large** |
| Bank statement import (CSV/OFX/MT940) | Yes | **No** (`bankTransactions` array exists, nothing fills it) | **Large** |
| Bank reconciliation UI + matching rules | Yes | **No** | **Large** |
| Analytic accounting (cost centres, projects) | Yes | **No** | Medium |
| Assets register + depreciation schedules | Yes | **No** | Medium |
| Deferred revenue / prepaid expense schedules | Yes | **No** | Medium |
| Budgets | Yes | **No** | Low |
| Trial Balance, P&L, Balance Sheet, Cash Flow | Yes | Partial (computed from derived postings) | Medium |
| Aged receivable / payable | Yes | **No** | Medium |
| Day book / general ledger drill-down | Yes | Partial (LedgerView) | Medium |
| Multi-company consolidated reporting | Yes | **No** | Medium |

**Read this table as one finding, not eighteen.** Everything marked Critical
traces to the same root cause: there is no ledger. Odoo's reports are queries over
`account.move.line`; this app's reports are recomputations over vouchers.

### 1.4 Inventory

| Capability | Odoo | This app | Gap |
|---|---|---|---|
| Multi-warehouse | Yes | Yes (server-side `Warehouse` + access control) | None |
| Multi-location / bins inside a warehouse | Yes | **No** | Medium |
| Inter-branch / inter-warehouse transfer with state machine | Yes | **Yes** (DRAFT→SENT→RECEIVED, transactional) | None |
| Receipts / delivery orders as documents | Yes | **No** | **Large** |
| Lots / serial numbers, expiry | Yes | **No** | Medium |
| Inventory valuation (FIFO/AVCO/standard) | Yes | **No** | **Large** |
| Automated stock journal entries (COGS, stock interim) | Yes | **No** | **Large** |
| Landed costs | Yes | **No** | Low |
| Reordering rules / replenishment | Yes | **No** | Medium |
| Physical count / adjustment applied to stock | Yes | Partial — `InventoryAdjustment` rows are recorded but **never applied** to `StockBalance` | **Large** |
| Negative-stock control | Yes | **No** (transfers decrement without a guard) | Medium |
| UoM + UoM conversion | Yes | Partial (UoM master, no conversion) | Medium |
| Barcode operation | Yes | **No** | Low |
| Two item catalogs (server `Item` vs local items) reconciled | n/a | **Broken** — the two are disconnected | **Large** |

### 1.5 India / GST localization

| Capability | Odoo (`l10n_in` + Enterprise) | This app | Gap |
|---|---|---|---|
| GSTIN on company/branch/party, validation | Yes | Yes (format + checksum + state match) | None |
| CGST/SGST/IGST determination by place of supply | Yes | Yes (`src/utils/gst.js`, 38 state codes) | None |
| GST rate masters, HSN/SAC on lines | Yes | Yes | None |
| GSTR-1 / GSTR-3B **on-screen reports** | Yes | Yes | None |
| GSTR-1 export in government JSON schema | Yes | **No** (screen only) | **Large** |
| GSTR-2A/2B download + purchase reconciliation | Yes | **No** | **Large** |
| e-Invoice (IRN + signed QR via IRP) | Yes | **No** | **Large** |
| e-Way bill generate/cancel | Yes | **No** | **Large** |
| TDS / TCS with sections, thresholds, challans | Yes | **No** | **Large** |
| Reverse charge, SEZ/export with LUT | Yes | **No** | Medium |
| Composition scheme | Yes | Partial (registration type field only) | Medium |
| Tally-compatible export | Third-party | **No** | Medium |

This is the app's strongest column *and* its most dangerous one: the GST
computation is genuinely good, but everything that turns a computation into a
**filing** is missing.

### 1.6 Platform and framework

| Capability | Odoo | This app | Gap |
|---|---|---|---|
| Multi-company | Yes | Yes (`Account → Org`) | None |
| Multi-branch inside a company | Via companies/analytic | **Yes, natively** | **Better here** |
| Warehouse-level user access | Partial (via groups) | **Yes, natively** | **Better here** |
| Role/permission model stored in DB | Yes | Yes (module/subModule/action) | None |
| Record-level access rules (ir.rule) | Yes | Partial (branch/warehouse scoping only) | Medium |
| Approval workflows / activity assignment | Yes | **No** (transfers only) | **Large** |
| Chatter: per-document comments, log, followers | Yes | **No** | **Large** |
| Document attachments (bills, receipts) | Yes | **No** | **Large** |
| Audit log on financial records | Yes | **No** (`AuditLog` written for users only) | **Large** |
| Email integration (send + incoming) | Yes | **No** (SMTP config exists in dead code) | **Large** |
| Scheduled jobs / cron | Yes | **No** | Medium |
| Import/export (CSV/XLSX) of any model | Yes | Partial (export to Excel/PDF for ledger) | Medium |
| Pivot/graph analysis, custom dashboards | Yes | **No** (fixed reports) | Medium |
| Custom fields without code (Studio) | Yes (Enterprise) | **No** | Low |
| Public API (XML-RPC/JSON-RPC/REST) | Yes | Partial (internal REST, undocumented, no keys) | Medium |
| Webhooks | Yes | **No** | Low |
| Mobile app / responsive UI | Yes | **No** | Medium |
| Offline capability | No | Accidentally yes (localStorage) | n/a |
| Translations / i18n | Yes (many) | **No** (English only) | Low |
| Deep links to a record (URL per document) | Yes | **No** (no router at all) | Medium |
| Printing/report designer | Yes (QWeb) | Partial (fixed invoice templates) | Medium |
| App marketplace / third-party ecosystem | Yes | **No** | n/a |

### 1.7 Scorecard totals

Across the ~100 capabilities compared above:

| Verdict | Count (approx.) |
|---|---|
| Yes — at parity | ~14 |
| Better here than Odoo | 2 (native branch model, warehouse-level access) |
| Partial | ~20 |
| No — missing | ~64 |

Of the missing items, roughly **15 are structural** (they need the ledger,
document-flow, and attachment/audit layers to exist first) and the rest are
screens and integrations that can be built once the structure is right.

---

## 2. The workflow gap — the part that matters more than the feature list

A feature checklist understates the distance, because Odoo's real product is not
its screens; it is that **every business event produces a linked document and a
balanced journal entry, automatically, inside one transaction**. Five flows show
what that means in practice.

### 2.1 Order to cash

**Odoo:** Opportunity → Quotation → *confirm* → Sales Order (reserves stock) →
Delivery Order → *validate* (stock moves post COGS + stock interim entries) →
Invoice created *from the delivery, on delivered quantities* → *post* (creates
`account.move` with AR debit, revenue credit, GST credit) → Payment registered →
Payment matched against invoice → Bank statement line reconciled to the payment.
Every document links back to the one before it; every state change is logged in
chatter; the invoice cannot be edited after posting, only credited.

**This app:** Estimate and Invoice are two independent rows in two independent
localStorage arrays. Creating an invoice does not reserve, move, or value stock.
It writes a `paidAmount` number rather than a payment allocated to it. Nothing
posts. The trial balance recomputes from the invoice list every time it is
rendered, resolving "Accounts Receivable" by name.

**Consequence:** an accountant cannot answer "why did AR move by ₹X on this day"
with a drill-down, because there is no entry to drill into.

### 2.2 Procure to pay

**Odoo:** RFQ → PO → Receipt (stock in, at cost, posting the stock interim
account) → Vendor Bill matched against PO and receipt (three-way match, with a
difference report) → Payment → Bank reconciliation.

**This app:** Bill and PO exist as separate local documents with no match, no
receipt, and no stock or cost effect. Purchases do not change inventory value
because inventory has no value — only quantity.

### 2.3 Stock movement accounting

**Odoo:** every stock move can generate accounting entries under automated
valuation, and the Stock Valuation report ties to the Balance Sheet.

**This app:** stock is quantity-only (`StockBalance.qtyOnHand`). There is no cost
layer, no valuation method, no COGS posting. `Stock-in-Hand` exists as a chart-of-
accounts group with nothing computing a balance for it. Adjustments are recorded
but never applied.

### 2.4 Month-end close

**Odoo:** lock date per journal and per user group, unreconciled-items report,
bank reconciliation to zero, tax report → close entry, then the period is
immutable.

**This app:** there is no close. Every historical voucher stays editable and
deletable forever, and reports recompute from whatever the vouchers say today.
Two people can produce two different Marches from the same file.

### 2.5 Tax filing

**Odoo:** tax tags on every journal item → tax report → GSTR-1/3B in filing
format, with e-Invoice IRNs already on the invoices.

**This app:** GSTR-1 and GSTR-3B render on screen from voucher data. There is no
JSON export, no IRN, no e-Way bill, no 2B reconciliation. The last mile — the part
the customer is actually paying for — is absent.

**Summary:** the app has *documents*; Odoo has *document flow plus a ledger*. The
gap is one layer deep, not one hundred features wide. Build the ledger and the
document-linkage layer (ROADMAP Phase 1–2) and roughly 30 of the "No" rows above
stop being independent problems.

---

## 3. Where Odoo is genuinely weak (and where this app can win)

Do not read the tables above as "give up". Odoo's weaknesses are real and they are
the same ones every Indian SMB complains about:

1. **Implementation cost.** Odoo Accounting for a 3-branch distributor is a
   consultant project, not a signup. Partners typically bill more for the
   implementation than the first two years of licence.
2. **Per-user pricing.** Every branch accountant, storekeeper, and cashier is a
   paid seat. A 20-user distributor feels this immediately. A flat
   per-company or per-branch price is a sharp wedge.
3. **Complexity tax.** Most SMBs use maybe 15% of the accounting app and pay the
   navigation cost of the other 85% every day.
4. **Branch-level operation is awkward.** Odoo models branches as either separate
   companies (heavy: separate CoA, inter-company rules) or analytic accounts
   (weak: not an access boundary). **This app models branch and warehouse as
   first-class tenancy with per-user access — that is a genuinely better fit for
   Indian multi-branch retail/distribution, and it is already built.**
5. **India last-mile depends on Enterprise or partners.** Community's `l10n_in`
   does not give you a turnkey e-Invoice/e-Way-bill/2B experience.
6. **Speed of data entry.** Odoo's web client is heavy; a keyboard-first billing
   screen that a Tally operator can use without retraining is a real product.

**The defensible position is not "Odoo but cheaper". It is: multi-branch Indian
GST billing + inventory + compliance filing, opinionated, fast to enter data,
flat-priced, with the branch/warehouse permission model built in.** That is a
product Odoo serves badly and Tally serves without cloud/multi-branch access
control.

Competitors that matter more than Odoo for that wedge: **Tally Prime** (incumbent,
desktop, huge switching cost), **Zoho Books** (cloud, polished, weak multi-branch
inventory), **Vyapar / myBillBook** (cheap mobile billing, no real accounting),
**Busy** (multi-branch, desktop). Position against Zoho Books and Busy, not Odoo.

---

## 4. What "launch" requires

Feature gaps are only one of six workstreams. Nothing here is optional if real
businesses will keep their books in this system.

### 4.1 Product minimum (the non-negotiable set)

From ROADMAP Phases 0–2, restated as launch gates:

- [ ] Server is the system of record; browser storage is a cache only.
- [ ] Real double-entry GL with posted/draft states and control accounts by ID.
- [ ] Document flow: estimate → invoice → payment allocation; PO → bill → payment.
- [ ] Inventory valuation with COGS posting, or **explicitly ship quantity-only
      inventory and say so in the pricing page** (a legitimate v1 choice).
- [ ] Period lock + audit trail on every financial mutation.
- [ ] Bank statement import and reconciliation (the #1 reason SMBs abandon a book).
- [ ] GSTR-1/3B in government JSON format; e-Invoice IRN if any customer crosses
      the turnover threshold; e-Way bill for goods movement.
- [ ] The four P0 security defects from REVIEW.md closed (hardcoded owner email,
      unguarded invoice routes, cross-account login, unignored secrets).

### 4.2 Data and onboarding

- [ ] Import: Tally XML/Excel, Zoho Books CSV, Busy export, plain Excel templates
      for masters (customers, vendors, items, opening balances).
- [ ] **Opening balance entry flow** — no business starts on day zero. Trial
      balance import that posts an opening journal entry.
- [ ] Company setup wizard: GSTIN → auto-fill state/place of supply, CoA
      selection, branch/warehouse creation, first user + role.
- [ ] Sample/demo company that can be reset — the current `seedDummyDataV1` seeds
      75 vouchers into real tenants and should be behind an explicit toggle.
- [ ] Export everything (the customer's data must be theirs: CSV/Excel of all
      masters and vouchers, plus a full JSON dump).

### 4.3 Infrastructure and operations

- [ ] Postgres (managed), not SQLite. Staging + production environments.
- [ ] Automated daily backups with **a tested restore** (an untested backup is
      not a backup) and point-in-time recovery.
- [ ] Monitoring: uptime, error rate, latency, disk. Alerting to a human.
- [ ] Structured logs + error tracking (Sentry), request IDs.
- [ ] CI/CD with migrations applied automatically and a rollback path.
- [ ] Rate limiting, WAF/CDN, TLS, secrets in a manager (not `server/.env`).
- [ ] Published status page and an incident process.
- [ ] Capacity plan: how many orgs per instance, and what happens at 10x.

### 4.4 Security, legal, compliance

- [ ] Password policy, 2FA, session revocation, forced logout on role change.
- [ ] Encryption at rest and in transit; documented data retention and deletion.
- [ ] **DPDP Act 2023 (India)** posture: consent, purpose limitation, breach
      notification, grievance officer, data-principal rights. Get this reviewed
      by counsel; it applies to you as a data fiduciary.
- [ ] VAPT / penetration test report — mid-market Indian buyers ask for it.
- [ ] Terms of service, privacy policy, DPA, SLA, refund/cancellation policy.
- [ ] Your own entity, GST registration, and compliant invoicing for the SaaS.
- [ ] A qualified CA on retainer to sign off tax logic **before** customers file
      from it. Wrong GSTR-1 output is a liability event, not a bug report.
- [ ] Disclaimer + audit trail sufficient for the customer's own statutory audit.

### 4.5 Commercial

- [ ] Pricing model. Recommended: per-org base + per-branch, unlimited users —
      it is the anti-Odoo move and it matches how Indian SMBs think about cost.
- [ ] Subscription billing (Razorpay/Stripe), invoicing, trials, dunning,
      plan limits enforced in code (branches, warehouses, vouchers/month).
- [ ] Free trial or free tier with a hard, honest limit.
- [ ] Migration offer: "we import your Tally data free" is the single highest-
      converting line for this category.
- [ ] Channel: chartered accountants and tax practitioners resell/recommend.
      Build a CA partner portal (multi-client switcher) — Zoho's biggest lever.

### 4.6 Support and content

- [ ] Documentation and a help centre; in-app contextual help.
- [ ] Onboarding videos in English + Hindi (and ideally one southern language).
- [ ] Support channel with a stated response time; WhatsApp is table stakes in
      this market.
- [ ] Changelog and a public roadmap.
- [ ] Accounting-correctness test suite as a *marketing asset*: "every release is
      verified against N ledger and GST scenarios."

### 4.7 Launch gate — the short version

Do not charge money until all of these are true:

1. A customer's data survives losing their laptop.
2. Two users in two branches see the same books.
3. A month can be closed and the numbers do not move afterward.
4. Trial balance foots to zero from posted journal lines.
5. A GSTR-1 produced by the app has been reconciled against a CA's own
   computation for at least three real filing cycles.
6. A restore from backup has been performed successfully into staging.
7. The P0 security defects are closed and a pen test has been run.

---

## 5. Realistic sequencing against Odoo

| Build now (wedge) | Build later (retention) | Never build (concede to Odoo) |
|---|---|---|
| Ledger + document flow | Bank feeds/auto-reconciliation | Manufacturing (MRP) |
| GST filing last mile (JSON, IRN, e-Way, 2B) | Analytic/cost centres | Ecommerce, website builder |
| Multi-branch + warehouse access (done) | Assets, deferrals, budgets | HR, payroll, recruitment |
| Fast keyboard-first billing | Customer portal + online payment | POS hardware ecosystem |
| Tally/Zoho import | Approval workflows, attachments, chatter | Studio / no-code customization |
| Bank statement import | Multi-currency | App marketplace |
| Aged AR/AP, day book | Mobile app | Project/timesheets |

**Effort, honestly stated.** Parity with Odoo Accounting + Inventory for a small
team is an 18–30 month program, and it is the wrong goal. The wedge product
described in Section 3 — ledger, document flow, GST filing, branch model, import,
bank reconciliation — is roughly **6–9 months** on top of ROADMAP Phases 0–2 for
one or two developers, and it is sellable.

---

## 6. Verdict

The prototype is a **UI-complete demo of an accounting product with an
unusually good India-GST computation layer and a genuinely better multi-branch
permission model than Odoo's**, sitting on top of no ledger, no persistence
guarantee, and no filing capability.

Against Odoo it is not close on breadth and will not become close. Against the
product it should be — cloud multi-branch GST billing for Indian SMBs — it is
maybe 30–40% of the way there, and the missing 60% is concentrated in two layers
(ledger + document flow, then compliance last-mile) rather than scattered across
a hundred features. That concentration is good news: it is a build plan, not a
rewrite.
