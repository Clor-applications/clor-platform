# CLOR — business logic, accounting workflow and data consistency audit

**Baseline** `d3069f0` · **Date** 18 Sep 2026 · **Phase 1 — audit only, nothing fixed**

Evidence is labelled throughout:

- **VERIFIED** — executed against the local QA organisation through the real API and measured in the database.
- **CODE** — read from the implementation and traced end to end, not executed.
- **NOT EXERCISED** — inspected too shallowly to assert, or not reached at all. Listed in §21 rather than hidden.

No production data was touched. Every document created for this audit was
created in the local development database, measured, and then reversed or
cancelled; the AR control account was confirmed to return to its exact
starting value (13,843,616).

---

## 1. Current architecture

CLOR keeps **two books, not one**, and that single fact explains most of
the findings below.

**The server book** (`server/`, Prisma, SQLite) holds `Invoice`, `Bill`,
`Payment`, `PaymentAllocation`, `JournalEntry`, `JournalLine`,
`LedgerAccount`, `StockBalance`, and is a real double-entry ledger: entries
are immutable once posted, carry a per-branch sha256 hash chain
(`prevHash`/`hash`), and are written through exactly one function.

**The browser book** (`src/data/db.js`, ~2,700 lines, localStorage) holds its
own `invoices`, `bills`, `payments`, `journalEntries`, `chartOfAccounts`,
`expenses`, `creditNotes`, `debitNotes`, `stockTransfers`, `estimates`. It is
not a cache. It is a second set of books with its own identifiers, its own
settlement state and its own arithmetic.

Server rows are pulled into the browser book by `src/hooks/useServerDocSync.js`.
That merge **only inserts rows the browser does not already know**
(`!knownIds.has(...)`) and assigns each a fresh local numeric id, keeping the
server cuid in `backendInvoiceId`. It never updates a row it has already seen.

Which book a screen reads decides what number the user is shown:

| Screen | Book |
| --- | --- |
| Trial Balance (`case 'trialBalance'` → `<TrialBalance db={dbForUser}>`) | **browser** |
| Profit & Loss (`<ProfitLoss db={dbForUser}>`) | **browser** |
| Balance Sheet (`<BalanceSheet db={dbForUser}>`) | **browser** |
| Ledger Trial Balance (`src/features/reports/LedgerTrialBalance.jsx`) | **server** (`getTrialBalance`) |
| General ledger drill-down | **server** (`routes/ledger.ts`) |
| Invoice/bill lists, dashboard KPIs, inventory | **browser** |

The application therefore ships **two trial balances computed from two
different sets of books**, on two different screens, with no reconciliation
between them.

## 2. Module relationship map

```
                    ┌──────────────── BROWSER BOOK (localStorage) ─────────────┐
                    │  invoices  bills  payments  journalEntries  items ...    │
                    │  → P&L, Balance Sheet, Trial Balance, Dashboard, Stock   │
                    └────────▲─────────────────────────────────────────────────┘
                             │ one-way, insert-only hydration (never refreshes)
                    ┌────────┴──────────────── SERVER BOOK (Prisma) ───────────┐
  Party ──┬── Invoice ──┬── PaymentAllocation ──┬── Payment ── JournalEntry     │
          │             │                       │                 │            │
          └── Bill ─────┘                       └─────────────────┤            │
             Expense, CreditNote, DebitNote ─────────────────────►│ postEntry  │
             InventoryAdjustment ─┐                               │ (only      │
             InterBranchTransfer ─┴──► StockBalance               │  writer)   │
                                       (adjustments + transfers only)          │
                    └──────────────────────────────────────────────────────────┘
```

Implemented and posting to the ledger: **Invoice, Bill, Expense, CreditNote,
DebitNote, Payment/Receipt, manual Journal Entry, opening balances (imports),
FX revaluation, governance re-posts**. All five posting-line builders in
`services/ledger.ts` are wired to routes — none is dead code.

Not connected to the ledger at all: **InventoryAdjustment, InterBranchTransfer**
(they move `StockBalance` only), and every browser-only module (TDS stores,
stock adjustments made client-side, POS day close arithmetic).

## 3. Source-of-truth map

For a sales invoice:

| Value | Stored | Computed by | Recomputed server-side? | Recomputed by reports? |
| --- | --- | --- | --- | --- |
| line taxable | `itemsJson` (JSON blob) | `src/utils/gst.js computeGstForLine` | **no** | browser recomputes for stock/GST reports |
| subtotal | `Invoice.subtotal` | client | **no** | — |
| CGST / SGST / IGST | `Invoice.cgstTotal/sgstTotal/igstTotal` | client | **no** | — |
| grand total | `Invoice.total` | client | **no** | — |
| round-off | *not stored* | derived at posting as `total − (subtotal+taxes)` | n/a | — |
| amount received | `Invoice.paidAmount` | **client only** | **never written by the payment path** | — |
| outstanding | *not stored* | `total − paidAmount` in ~15 call sites, `total − Σ allocations` in the payments module | — | both, disagreeing |
| AR balance | `JournalLine` on control account `AR` | `invoicePostingLines` | yes | server trial balance |

The canonical tax engine is `src/utils/gst.js` — `computeGstForLine` /
`computeGstForLines` — used by `src/App.jsx`, `features/sales/index.jsx`,
`features/purchase/index.jsx`, `PosScreen.jsx`, `SalesOrders.jsx`,
`RecurringInvoices.jsx`. That single engine is a genuine strength: line
discount (pct then flat), invoice-level discount applied **proportionally
before tax**, `round2` at every step, intra/inter decided by
`isIntraStateSupply({companyState, partyState})`.

**The server has no tax engine at all.** `routes/invoices.ts` accepts
`body.subtotal`, `body.cgstTotal`, `body.sgstTotal`, `body.igstTotal`,
`body.total` and stores them verbatim (`body.cgstTotal ?? 0`), then posts
those same client numbers to the ledger.

## 4. Sales workflow

Implemented stages: **Quotation (`Estimate`) → Sales Order (`SalesOrderDoc`)
→ Delivery Challan (`DeliveryChallan`) → Invoice → Receipt (`Payment`) →
Reconciliation (`BankBookEntry`)**. All five documents exist as first-class
server models, so the chain is real, not aspirational.

Source references are carried: `Invoice.sourceEstimateId` is a column, and
`sourceSalesOrderId` / `sourceChallanId` are carried in `extrasJson` (they
were previously dropped on the way to the server — the `extrasJson` comment
records that fix). So Q-001 → SO-001 → INV-001 **is** traceable forward from
the invoice.

**NOT EXERCISED:** whether conversion copies billing/shipping address, GST
rate, warehouse, branch, currency, terms and notes faithfully at each hop. The
fields exist; I did not drive a conversion and diff the result.

## 5. Purchase workflow

Implemented: **Vendor → Purchase Order (`PurchaseOrderDoc`) → Bill →
Payment**. There is **no GRN model**; goods receipt is not a distinct
document, so the PO→Bill hop carries no receiving step and no three-way match.

`billPostingLines` is the correct mirror of the invoice and additionally
handles TDS at the bill: it debits Purchases and input GST, credits
`TDS_PAYABLE` for the deduction, and credits AP with `total − tds`. The
deduction is capped at the bill total. That logic is sound.

## 6. Receipts and payments

`routes/payments.ts` creates the `Payment` and its `PaymentAllocation` rows in
one transaction, then posts Dr Bank/Cash, Cr AR (receipt) or the mirror
(payment), with per-deduction debits for TDS, bank charges and other charges,
and an FX difference line. The posting is correct and balanced — **VERIFIED**,
see §7.

What it does **not** do is touch the invoice. See **P0-2**.

## 7. Accounting posting model — verified

Canonical credit sale, run through the API on 18 Sep 2026
(`AUDIT-F-001`, taxable ₹100,000, intra-state 18%):

```
1100 Accounts Receivable   Dr 118,000
4000 Sales Accounts                    Cr 100,000
2100 Output CGST                       Cr   9,000
2110 Output SGST                       Cr   9,000
                                   balanced: true
```

Receipt of ₹50,000 (`AUDIT-F-RCPT-1`):

```
1300 Bank Accounts         Dr  50,000
1100 Accounts Receivable               Cr  50,000
```

Both exactly as an accountant would expect. **There is no COGS or inventory
line on either.** `Stock-in-Hand` (1400, `controlKind: STOCK`) is created by
`ensureLedgerSetup` and is **never posted to by any code path** — confirmed by
grep across `server/src`. The model is therefore **periodic**, not perpetual,
which `docs/ODOO-COMPARISON.md` already states. It is a deliberate gap, not a
bug, but it must be stated explicitly because gross profit cannot be computed
from the ledger.

**The double-entry invariant is enforced properly.** `postEntry` converts every
amount to integer paise, rejects negative amounts, rejects a line carrying
both a debit and a credit, rejects a zero line, requires at least two lines,
and throws `PostingError` unless `debitPaise === creditPaise`. It is the only
writer of `JournalEntry`. **VERIFIED: 10 entries in the QA database, 0
unbalanced**, before and after the audit transactions.

## 8. GST / TDS / TCS

Intra vs inter-state is decided by `isIntraStateSupply({companyState,
partyState})` in `src/utils/gst.js`, with `getGstStateFromGstin` deriving the
state from the GSTIN's first two digits and `canDetermineSupplyType` guarding
the case where neither side's state is known. Intra splits GST into
`round2(gst / 2)` for each of CGST and SGST; inter puts the whole amount in
IGST. Invoice-level discount is applied proportionally to every line **before**
tax, which is the GST-correct treatment.

Rounding is `round2` (`Math.round(x*100)/100`) applied per line, per component
and at each aggregate.

**Half-GST rounding is not compensated.** `round2(gst/2)` is applied to both
halves independently, so an odd-paise GST amount produces `cgst + sgst ≠ gst`
by ₹0.01 on that line. Whether this materialises at document level depends on
the line mix — see **P2-1**.

TDS: bill-side deduction is handled in `billPostingLines`; receipt-side TDS is
a deduction line posting to `TDS_RECEIVABLE`. The TDS *module* (rules,
challans, quarterly returns) is browser-local — see **P1-4**.

**NOT EXERCISED:** TCS, cess, zero-rated/exempt/non-GST classification,
inclusive pricing, and GSTR-1/3B reconciliation against source documents.

## 9. Inventory

**Server:** `StockBalance` is written by exactly two routes —
`inventoryAdjustments.ts` and `transfers.ts`. Invoices and bills contain no
reference to `stockBalance` at all.

**Browser:** `src/utils/inventory.js buildStockMovements` derives every
movement by walking `db.bills` (IN), `db.invoices` (OUT), `db.debitNotes`
(OUT), `db.creditNotes` (IN), `db.stockAdjustments` and `db.stockTransfers`.

So the quantity a user sees is computed in the browser from the browser's copy
of the documents, while the server's own stock table knows only about
adjustments and transfers. The two can never agree, and neither is derived
from the other. See **P0-5**.

Valuation: no costing method (FIFO/weighted average) exists in either book.
Quantities only.

## 10. Reports

| Report | Source | Reconciles? |
| --- | --- | --- |
| Ledger Trial Balance | server ledger | **yes** — footed to zero, 0 unbalanced entries |
| Trial Balance (main) | browser book | independent arithmetic |
| P&L | browser book | independent arithmetic |
| Balance Sheet | browser book | independent arithmetic |
| Aging / receivables | browser `total − paidAmount` | **no** — see P0-2 |
| Stock ledger | browser movements | **no** — see P0-5 |
| GSTR-1 / 3B | browser documents | NOT EXERCISED |

**AR reconciliation, measured with a receipt outstanding:**

```
AR control account (ledger)        13,911,616
Σ (total − paidAmount)             13,961,616   ← off by exactly the ₹50,000 receipt
Σ (total − allocations)            13,911,616   ← agrees with the ledger
```

## 11. Dashboard

Dashboard KPIs are computed in `src/App.jsx` from the browser book — e.g.
`const due = numv(i.total) - numv(i.paidAmount)` (≈12103) for receivables and
the same shape at ≈12124 for payables. They therefore inherit **P0-2** in full:
a half-paid invoice contributes its entire total to "Receivables" and
"Overdue".

**NOT EXERCISED:** the precise date basis, status filter and branch/FY filter
behind each KPI tile.

## 12. Branch / warehouse / fiscal year

`postEntry` resolves the fiscal year via `ensureFiscalYear`, refuses to post
into a `CLOSED` year, and refuses to post on or before `lockedThrough`. Journal
entries, lines, invoices and payments all carry `branchId`, and document
numbers are unique per **org** (`@@unique([orgId, number])`) rather than per
branch — deliberate, and documented in the schema.

**NOT EXERCISED:** whether branch and warehouse filters actually isolate
values on the dashboard, lists, ledger, inventory and tax screens; and
behaviour across the 31/03 → 01/04 boundary.

## 13. Edit / cancel / delete / reversal

| Action | Ledger effect | Verdict |
| --- | --- | --- |
| Invoice **create** | posts `SAL` entry | correct |
| Invoice **edit (PATCH)** | **nothing** | **P0-1** |
| Invoice **status → Cancelled** | reverses every posted entry | correct |
| Invoice **delete** | reverses, then deletes; blocked once issued ("Cancel it instead") | correct |
| Payment **create** | posts `BNK`/`CSH` entry | correct |
| Payment **reverse** | contra entry, status `REVERSED` | correct in the ledger |
| Payment **reverse** | `PaymentAllocation` rows **survive** | **P1-2** |

Posted rows are never mutated — reversal always writes a contra entry and
links `reversedById`. That is the right model, and the hash chain depends on
it.

## 14. Calculation ownership

One engine, client-side, for tax and document totals (`src/utils/gst.js`) —
good. One engine, server-side, for postings (`services/ledger.ts`) — good.
**Nothing connects them and nothing validates one against the other.**

## 15. Duplicated calculations

1. **Outstanding** — `total − paidAmount` (≈15 sites incl. `App.jsx:12103`,
   `SalesOverview.jsx:415`, `sales/index.jsx:422`, `paymentService.js:175`)
   versus `total − Σ allocations` (payments module, server allocations). These
   disagree by construction.
2. **Trial balance** — browser `<TrialBalance>` versus server
   `trialBalance()` in `services/ledger.ts`.
3. **Stock on hand** — browser `buildStockMovements` versus server
   `StockBalance`.
4. **Settlement state** — `paymentService.js applyCustomerReceipts` /
   `applyVendorPayments` maintain `paidAmount`/`status` in the browser; the
   server maintains allocations and the ledger. Neither writes the other's.

## 16. Broken workflows

- Receipt → invoice settlement (**P0-2**)
- Invoice edit → ledger (**P0-1**)
- Sale/purchase → stock (**P0-5**)
- Payment reversal → allocation withdrawal (**P1-2**)
- Any multi-device or multi-user session, because hydration never refreshes an
  already-known row (**P1-3**)

## 17. Data consistency findings

### P0-1 — Editing a posted invoice does not touch the ledger · **VERIFIED**

**Reproduction.** `POST /orgs/:org/invoices` with total ₹118,000 → posts
`SAL-000007` with Dr AR 118,000. Then `PATCH /orgs/:org/invoices/:id` with
total ₹40,000.
**Expected.** Ledger adjusted to ₹40,000, by reversal + re-post or a delta entry.
**Actual.** `invoice.total = 40000`; journal entries for that invoice: **1**,
still `POSTED`, total debits **118,000**. AR overstated by ₹78,000, silently
and permanently.
**Modules.** Sales, AR, Trial Balance, Balance Sheet, aging, dashboard.
**Code.** `server/src/routes/invoices.ts` — `postEntry` appears only at :458
(create); the PATCH handler at :490 contains no `postEntry`/`reverseEntry`.
**Entities.** `Invoice`, `JournalEntry`, `JournalLine`.
**Correction.** On any edit that changes a posted amount, reverse the original
entry and post a fresh one inside one transaction — the machinery already
exists and is used by cancel and delete.

### P0-2 — Receipts never update the invoice they settle · **VERIFIED**

**Reproduction.** Invoice ₹118,000, then a ₹50,000 receipt allocated to it.
**Expected.** paid 50,000 · outstanding 68,000 · status Partially Paid.
**Actual.** `paidAmount = 0` · `status = "Unpaid"` · allocations = 50,000.
Outstanding reads **118,000** by `total − paidAmount` and **68,000** by
allocations. Org-wide AR: ledger 13,911,616, `Σ(total − paidAmount)`
13,961,616 — out by exactly the receipt.
**Modules.** Sales, receipts, AR, aging, customer ledger, dashboard, FX
revaluation (`routes/revaluation.ts:91` uses `total − paidAmount`).
**Code.** `routes/payments.ts` never writes `Invoice.paidAmount`/`status`;
grep shows the only writes are from the invoice create/patch body.
Settlement is applied in the **browser** by
`src/features/payments/paymentService.js:321` (`applyCustomerReceipts`) and
`:380` (the undo).
**Correction.** Make the server the single writer: recompute
`paidAmount`/`status` from non-reversed allocations inside the payment
transaction, or drop the denormalised fields and derive outstanding
everywhere.

### P0-3 — Financial totals are client-supplied and never validated · **CODE**

`routes/invoices.ts` stores `body.subtotal/cgstTotal/sgstTotal/igstTotal/total`
verbatim and posts those numbers. `invoicePostingLines` then computes
`rounding = total − (subtotal + cgst + sgst + igst)` and posts the remainder
to `ROUNDING` — **with no cap**. A client sending `subtotal: 100,
total: 118000` produces a balanced, hash-chained entry crediting ₹117,900 to
Rounding. Nothing rejects it.
**Correction.** Recompute totals server-side from `items` and reject (or
clamp) a rounding difference beyond ±₹1 per document.

### P0-4 — Statutory reports are computed from the browser book · **CODE**

P&L, Balance Sheet and the main Trial Balance take `db={dbForUser}`
(`App.jsx:13423–13428`), i.e. localStorage. The audited, hash-chained ledger is
surfaced only on the separate *Ledger Trial Balance* screen. Two answers to
"what are my books", and the one most users will open is not the audited one.

### P0-5 — Sales and purchases do not move server stock · **CODE**

`StockBalance` is written only by `inventoryAdjustments.ts` and `transfers.ts`.
Quantities shown in the app come from `buildStockMovements` over the browser's
documents. A second device, or a cleared browser, reports different stock.

### P1-1 — Draft invoices reach the general ledger · **CODE**

In `routes/invoices.ts` the `postEntry` at :458 is guarded only by
`evaluateApproval`. An invoice created with `status: "Draft"` and no approval
rule is posted. Draft is supposed to mean "not in the books".

### P1-2 — Reversing a payment leaves its allocations behind · **VERIFIED**

After `POST /payments/:id/reverse`, `payment.status = REVERSED` and a contra
entry is posted, but the `PaymentAllocation` row survives — confirmed: 1
allocation still attached after reversal. No code anywhere filters allocations
by payment status (grep for `REVERSED` returns ledger/journal sites only). Any
allocation-derived outstanding therefore still counts the withdrawn money.

### P1-3 — Hydration never refreshes a known row · **CODE**

`useServerDocSync.js` inserts only rows whose id/name the browser does not
already hold. Server-side changes to an existing document never reach a
browser that has seen it. Divergence is permanent, not eventual.

### P1-4 — Browser-only financial modules · **CODE**

TDS rules/challans/returns, stock adjustments made client-side, and the
browser `journalEntries` collection have no server counterpart in the read
path. Single-device, single-user, and lost with site data.

### P1-5 — No COGS, no inventory valuation · **CODE**

`Stock-in-Hand` exists in the chart of accounts and is never posted. Gross
profit cannot be derived from the ledger.

### P2-1 — Half-GST rounding is uncompensated · **CODE**

`round2(gst / 2)` for both CGST and SGST; on an odd-paise line
`cgst + sgst ≠ gst` by ₹0.01. The difference then lands in the ROUNDING
posting rather than being pushed into one half.

### P2-2 — Money is stored as SQLite floats · **CODE**

`datasource db { provider = "sqlite" }` with `Decimal` columns. SQLite has no
decimal type; values land in NUMERIC affinity as IEEE-754 doubles. The posting
path is safe — `postEntry` works in integer paise — but stored document totals
are floats and every frontend calculation is raw JS `Number` with `round2`.
`docs/POSTGRES-CUTOVER.md` exists, which suggests this is known.

### P2-3 — Every seeded invoice carries a ₹0.01 rounding plug · observation

All 6 QA invoices have `total ≠ subtotal + taxes` by −0.01. These rows were
written by the seed script, not the API, so this is evidence about the seed,
not proof of an engine defect — but it is exactly the shape P0-3 permits.

### P3-1 — Contradictory statuses exist in seeded data

One invoice is `Paid` with non-zero outstanding; two are `Partially Paid` with
`paidAmount = 0` and no allocations. Seed artefacts, but they demonstrate that
nothing validates the status/amount relationship.

## 18. Accounting integrity findings

The core is **sound**: single write path, integer-paise balance check,
immutable posted rows, contra-entry reversal, per-branch hash chain, fiscal
year and lock enforcement. **0 unbalanced entries** across the database.

The integrity problem is not inside the ledger. It is that **documents can
change without the ledger changing** (P0-1), and that **settlement state lives
somewhere the ledger cannot see** (P0-2).

## 19. Missing workflows

GRN / three-way match · perpetual inventory with COGS · inventory valuation
method · server-side tax computation · server-derived invoice status ·
allocation withdrawal on payment reversal · a reconciliation job between the
two books.

## 20. Proposed canonical invariants

```
INV-1  Σ debits == Σ credits           for every JournalEntry        [holds today]
INV-2  invoice.total == round2(subtotal + cgst + sgst + igst + roundOff)
INV-3  |roundOff| <= 1.00              per document
INV-4  invoice.paidAmount == Σ allocations WHERE payment.status != 'REVERSED'
INV-5  invoice.outstanding == invoice.total - invoice.paidAmount, and >= 0
INV-6  status == 'Paid'      <=> outstanding == 0
       status == 'Partial'   <=> 0 < paidAmount < total
INV-7  AR control balance == Σ customer outstanding
INV-8  AP control balance == Σ vendor outstanding
INV-9  every amount-changing edit to a posted document reverses and re-posts
INV-10 cancelled/draft documents contribute nothing to any financial report
INV-11 stock(item, warehouse) == opening + Σ inward - Σ outward ± adjustments,
       and the server and browser answers are equal
INV-12 trial balance total debit == total credit, on both screens, equal
INV-13 an allocation belonging to a REVERSED payment settles nothing
```

INV-1 holds. INV-2/3 are unenforced (P0-3). INV-4/5/6/7 fail today (P0-2).
INV-9 fails (P0-1). INV-11/12 fail (P0-4, P0-5). INV-13 fails (P1-2).

## 21. Coverage — what this audit did not reach

Purchase workflow run end to end · GRN absence confirmed only by schema ·
multi-warehouse transfer arithmetic · the §J inventory sequence executed ·
TCS, cess, zero-rated/exempt, inclusive pricing · GSTR-1/3B reconciliation ·
dashboard KPI definitions per tile · branch/warehouse isolation · fiscal-year
boundary behaviour · conversion fidelity Quotation→SO→Challan→Invoice ·
credit/debit note lifecycle · expense payable vs paid-immediately · contra and
bank transfer postings · opening balance import · POS day close.

Findings there are unknown, not absent.
