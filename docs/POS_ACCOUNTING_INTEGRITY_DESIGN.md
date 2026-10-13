# POS accounting integrity — audit and design

**Audit / design pass only. No code changed.**
`origin/main = d024b6d` · companion to `BUSINESS_LOGIC_AUDIT.md`,
`POSTED_DOCUMENT_MUTATION_DESIGN.md`, `INVOICE_CALCULATION_AUTHORITY_DESIGN.md`

**The original finding is confirmed, empirically, on local QA.** A POS sale
debits Accounts Receivable and nothing ever credits it. The cash never reaches
the ledger. The invoice claims to be Paid.

---

## 1. The current flow, traced

```
POS checkout (src/features/sales/PosScreen.jsx)
  │
  ├─ computeGstForLines({ lines, isIntra: true })        ← client, gst.js, intra hardcoded
  │
  ├─ number = nextFreeVoucherNumber(... browser book ...) ← number allocated in the BROWSER
  │
  ├─ createInvoiceApi({ … status: 'Paid', posSale: true, tender,
  │                     subtotal, cgstTotal, sgstTotal, gstTotal, total,
  │                     items })                          ← no paidAmount, no allocation
  │        └─ POST /orgs/:org/invoices
  │             ├─ stores the client's totals verbatim   (P0-3)
  │             ├─ stores status 'Paid' verbatim         ← unchallenged
  │             └─ postEntry SAL: invoicePostingLines()
  │                  Dr AR 1,180 / Cr Sales 1,000 / Cr CGST 90 / Cr SGST 90
  │
  ├─ setDb(...)  invoice + receipt appended to the BROWSER book
  │        receipt = { voucherType:'receipt', amount, allocations:[…], mode: tender }
  │                                                        ← never sent anywhere
  └─ print + toast "received by Cash"
```

**No call to `createPayment` exists anywhere in `PosScreen.jsx`.** The receipt
is a local object and nothing more.

### Worked example — ₹1,000 + ₹180 GST, ₹1,180 cash

**Server state (the books):**

| | |
| --- | --- |
| `Invoice.total` | 1,180 |
| `Invoice.status` | **Paid** |
| `Invoice.paidAmount` | **0** |
| outstanding (`total − paidAmount`) | **1,180** |
| `Payment` rows | **0** |
| `PaymentAllocation` rows | **0** |
| `JournalEntry` | `SAL-000011`, POSTED, balanced |
| lines | Dr AR 1,180 · Cr Sales 1,000 · Cr CGST 90 · Cr SGST 90 |
| **AR control** | **+1,180, never cleared** |
| **Cash control** | **0** |
| **Bank control** | **0** |

**Browser state (the second book):**

| | |
| --- | --- |
| `db.invoices[…]` | total 1,180, `paidAmount: 1,180`, status `Paid` |
| `db.payments[…]` | receipt `RCPT-<number>`, amount 1,180, `mode: 'Cash'`, allocated in full |
| account on that receipt | **none** — `mode` is a label, not a ledger account |

The two books disagree about whether the money arrived, and only the browser
thinks it did.

## 2. Empirical reproduction — local QA, confirmed

A POS-shaped payload was posted through the real API and measured directly in
the database. Control balances before and after:

```
BEFORE   AR 13,843,616   CASH 0   BANK 0

POST /invoices  { total: 1180, status: 'Paid', posSale: true, tender: 'Cash', … }

invoice.total        1180
invoice.status       Paid          ← accepted verbatim
invoice.paidAmount   0
outstanding          1180
allocations          0
payments created     0
journal              SAL-000011  Dr AR 1180 / Cr Sales 1000 / Cr CGST 90 / Cr SGST 90

AFTER    AR 13,844,796 (+1,180)   CASH 0   BANK 0
```

**Every predicted symptom reproduced.** Receivable overstated by the full sale
value; cash understated by the same; the document claims Paid with zero
settlement evidence.

The test invoice was then cancelled; AR returned to exactly 13,843,616 and the
ledger remained balanced (0 unbalanced of 22 entries). No QA data was left
behind.

## 3. Payment modes

`PosScreen.jsx` holds a single `tender` state, defaulting to `'Cash'`, with
three choices:

| Tender | Should debit | AR involved? | `Payment` row expected | Allocation expected | UI supports today |
| --- | --- | --- | --- | --- | --- |
| **Cash** | a CASH ledger | yes, then cleared | yes | yes | yes |
| **UPI** | a BANK ledger | yes, then cleared | yes | yes | yes |
| **Card** | a BANK ledger (or a card-settlement account) | yes, then cleared | yes | yes | yes |
| split tender | — | — | — | — | **no** — one `tender` value per sale |
| partial payment | — | — | — | — | **no** — always charges the full total |
| credit sale (POS) | — | — | — | — | **no** — always marked Paid |

Day-close aggregates by exactly these three (`{ Cash: 0, UPI: 0, Card: 0 }`),
with cash denomination counting and over/short against `byTender.Cash` — all
computed from the **browser** book.

**Card is worth a product decision**: card takings usually land in the bank a
day or more later, net of charges. Treating Card as an immediate bank receipt
is a simplification that will not reconcile against a real bank statement.

## 4. Accounting model comparison

### Model A — invoice + receipt (two postings)

```
Sale     Dr AR        1,180
         Cr Sales             1,000
         Cr Output CGST          90
         Cr Output SGST          90

Receipt  Dr Cash/Bank 1,180
         Cr AR                1,180
```

with `PaymentAllocation = 1,180` → settlement derives `paidAmount 1,180`,
`outstanding 0`, `status Paid`.

### Model B — direct posting (one entry, no AR)

```
Dr Cash/Bank 1,180
Cr Sales             1,000
Cr Output CGST          90
Cr Output SGST          90
```

### Assessment against this codebase

| | Model A | Model B |
| --- | --- | --- |
| Uses the existing posting builder | **yes** — `invoicePostingLines` unchanged | **no** — needs a second invoice posting shape |
| Settlement authority (`0dbd0f3`) | **works as designed** — allocations are the evidence | **breaks** — a Paid invoice with no allocation is exactly the state the settlement service refuses to justify |
| Cash/bank reports, reconciliation | **works** — a real `Payment` row appears in `/payments`, bank reconciliation, cash book | **invisible** — no `Payment` row exists to reconcile |
| Day close | reconciles against real receipts | reconciles against nothing on the server |
| Customer subledger | correct — AR moves and clears | customer never appears in AR |
| Refund / partial / credit later | natural — reverse the receipt | needs a special case |
| Journal lines per sale | 4 + 2 | 4 |
| P0-4 consolidation | **helps** — the browser receipt gets a server counterpart to converge with | hinders — the browser book has a receipt the server never will |

**Model B's only advantage is two fewer journal lines.** It would require a
second posting model, would bypass the settlement service entirely, and would
leave cash/bank reporting and day close with nothing authoritative to read.

## 5. Settlement authority — POS must not be exempt

Phase 1 (`0dbd0f3`) established that `paidAmount` and `status` derive from
valid allocations. POS currently escapes it on a technicality: `reassertSettlement`
runs on **PATCH** and only when allocations exist, while **creation** takes
`status` straight from the request body.

So `POST /invoices { status: 'Paid' }` is accepted with no evidence — as
reproduced in §2.

**The rule should be: a document may not be created claiming a settlement
status it cannot evidence.** Either the server refuses the claim, or it derives
the status from allocations created in the same transaction. POS should satisfy
it by producing a real receipt, not by being excused from it.

This is a strict tightening of Phase 1, and it will reject the current POS
payload — which is the point, and why POS and this rule must ship together.

## 6. Cash / bank account resolution

Normal receipts require `ledgerAccountId`, validated as an active `CASH` or
`BANK` control account:

```ts
const mode = await prisma.ledgerAccount.findFirst({
  where: { id: body.ledgerAccountId, orgId, isActive: true,
           controlKind: { in: ['CASH','BANK'] } } });
if (!mode) return res.status(400).json({ error: 'Choose a cash or bank account…' });
```

`GET /payment-modes` lists selectable accounts and **deliberately excludes the
setup control accounts** (`SETUP_CASH_BANK_CODES`) — the comment is explicit:
they "stay in the chart and keep taking the postings; they are just not
choices."

**POS sends nothing that can resolve an account.** It sends `tender: 'Cash' |
'UPI' | 'Card'` — a label, stored in `extrasJson`. The browser receipt has no
account either.

### Minimum contract addition

POS must send a real `ledgerAccountId`, chosen from `/payment-modes`. That
means a per-terminal (or per-branch) mapping of tender → account, configured
once:

```
Cash → <a CASH account the business opened>
UPI  → <a BANK account>
Card → <a BANK account, or a card-settlement account>
```

**Do not hardcode a cash ledger.** `payment-modes` excludes the setup accounts
precisely so that money is never received into an account nobody opened — and
a business that has opened none has **no valid mode at all**. POS therefore
needs a genuine first-run configuration step, and must refuse to take money
until it has one. That is a real UX consequence and needs product sign-off.

## 7. Transaction boundary

The required sequence:

```
BEGIN
  create invoice
  post sale entry
  create payment + allocation
  post receipt entry
  derive settlement
COMMIT   — or roll back all of it
```

**This cannot be one transaction at `d024b6d`.** `postEntry` takes no
transaction parameter and opens its own `prisma.$transaction`; Prisma does not
join a nested interactive transaction to a caller's. The same constraint
documented for P0-1 applies here.

Today's invoice route already compensates by hand: if posting throws, it
deletes the invoice row. A POS endpoint could extend that pattern — create,
post, create receipt, post, and unwind explicitly on failure — but compensation
is not atomicity, and a crash between steps leaves a half-recorded sale.

**Minimum enabling refactor** (not proposed here): thread an optional `tx`
through `postEntry`, `reverseEntry`, `ensureFiscalYear`, `nextEntryNo` and
`resolveControlAccountId` — additive, no behaviour change when omitted. Phase 1's
settlement boundaries remain valid either way, because settlement is derived
inside whatever transaction writes the allocations.

**Until then, the honest ordering is:** invoice and its posting first, then
receipt and its posting; on receipt failure, reverse the invoice posting and
delete the invoice, and tell the operator the sale did not complete. Never
report success before both exist.

## 8. Idempotency

POS is the most exposed surface in the product, and the protections are thin.

| Risk | Today |
| --- | --- |
| Double-click | covered — `busy` state disables the charge button |
| Network timeout after the server committed | **not covered** — the client cannot tell a lost response from a failed write |
| Browser refresh mid-checkout | **not covered** |
| Two terminals / two tabs | numbers come from the **browser** book, so both can mint the same or adjacent numbers |
| Duplicate invoice | partially covered by `@@unique([orgId, number])` — a retry with the *same* number fails safely with 409; a retry that re-derives a *different* number creates a duplicate sale |
| Duplicate receipt | **no protection** — there would be nothing to collide on |

**`sourceSystem` / `sourceKey` already exist on `Invoice` with
`@@unique([orgId, sourceSystem, sourceKey])`**, but the create route does not
accept them — they are set only by imports. That is the natural idempotency
key: POS sends a client-generated sale id, a retry maps to the same row instead
of a second sale. `Payment` carries the same pair, unused in the same way.

This needs no schema change — only exposing fields that already exist.

## 9. Cancellation and refunds

**POS has no cancel, return or refund UI.** The only lifecycle reference in
`PosScreen.jsx` filters cancelled invoices out of today's sales list. A POS sale
is cancelled through the ordinary invoice screen.

Consequences today: cancelling reverses `Dr AR / Cr Sales / Cr GST`, which is
correct for the sale — and the **browser** receipt survives, orphaned, still
claiming ₹1,180 was received. Day close continues to count it.

Under Model A the coupling becomes explicit and must be designed: cancelling a
settled POS invoice has to reverse **the receipt as well**, or be refused until
the receipt is reversed — the same rule P0-1 applies to editing a settled
invoice. A refund is a separate outward payment, not a reversal, once the money
has genuinely left.

## 10. Reports affected

**Server-side, wrong today:**

- accounts receivable / customer outstanding — overstated by every POS sale
- cash and bank balances — understated by the same
- trial balance — foots, but AR and Cash are both wrong
- balance sheet — same
- aging — POS invoices age as unpaid receivables forever
- bank reconciliation — POS takings never appear as receipts
- settlement status — `Paid` with `paidAmount 0`, the impossible state INV-6 forbids
- `report:settlement` — POS invoices are *not* flagged, because stored `paidAmount 0` agrees with `Σ allocations 0`. **The reconciliation cannot see this defect**; only the status/allocation contradiction reveals it

**Sales and GST reporting are correct** — the sale itself posts properly, so
revenue and output tax are right. The error is confined to *how it was
settled*.

**Browser-side, hiding it:** the POS screen, day close, cash position and any
receipt list read `db.payments`, where the receipt exists. An operator sees a
correct till and a correct day close while the books disagree — **a textbook
P0-4 symptom, and strong evidence for consolidating the two books.**

## 11. Historical exposure — local QA only

```
invoices total              9
posSale invoices            1
POS: Paid, paidAmount 0, no allocation   1
value                       ₹1,180
AR overstated by            ₹1,180
```

(That one row is the reproduction from §2, since cancelled.) Local QA has
almost no POS history, so this establishes the *shape* of the query, not the
scale.

**Production was deliberately not queried.** The task scoped historical
investigation to local QA, and read-only production access was not part of it.
The same query can be run there on request — it is read-only and cheap:

```
invoices where extrasJson.posSale = true
          and status = 'Paid'
          and paidAmount = 0
          and no PaymentAllocation
→ count, Σ total  = the AR overstatement
```

One caveat for whoever runs it: `posSale` lives inside `extrasJson`, so the
filter is in application code, not SQL.

## 12. Recommended model

**Model A — invoice + authoritative server receipt + allocation, with
settlement derived by the existing service.**

```
POS checkout
  → create invoice            (status NOT declared by the client)
  → post sale                 Dr AR / Cr Sales / Cr GST
  → create Payment(direction RECEIPT, ledgerAccountId from tender mapping)
  → create PaymentAllocation(invoice, full amount)
  → post receipt              Dr Cash/Bank / Cr AR
  → settlement service derives paidAmount = total, status = Paid
```

Final authoritative state for a ₹1,180 sale:

```
AR net effect        0
Cash/Bank            +1,180
Sales                 1,000 credit
Output CGST + SGST      180 credit
valid allocations     1,180
paidAmount            1,180
outstanding               0
status                 Paid
```

It reuses every existing mechanism — `invoicePostingLines`, the payments route,
`PaymentAllocation`, `recalcSettlementForPayment` — and adds no second posting
model. It is also the model that makes the browser receipt convergeable under
P0-4, because a server counterpart finally exists.

## 13. Minimum implementation scope

1. **Tender → ledger account mapping**, configured per branch or terminal, from
   `/payment-modes`. POS refuses to take money without it.
2. **POS checkout creates a real receipt and allocation** after the invoice,
   through the existing payments path.
3. **The server stops accepting a client-declared settlement status** — derive
   it, or reject an unevidenced claim.
4. **Idempotency**: accept `sourceSystem`/`sourceKey` on invoice and payment
   creation, so a retry maps to the existing sale. No schema change.
5. **Failure handling**: unwind the invoice if the receipt cannot be created,
   and never report success before both exist.
6. **Cancellation coupling**: cancelling a settled POS invoice must reverse the
   receipt or be refused.

Not in scope: offline POS, split tender, partial payment, POS credit sales,
card settlement timing, and the `tx` refactor in §7.

## 14. Unresolved decisions

1. **Which account receives each tender**, and who configures it. A business
   with no opened cash/bank account has no valid mode — POS must then refuse to
   trade, which is a real operational constraint.
2. **Card timing.** Immediate bank receipt is a simplification; real card
   takings settle later, net of fees. A card-settlement clearing account is the
   accounting-correct answer and is more work.
3. **Should the server reject a client-declared status outright, or silently
   derive it?** Rejecting is consistent with the reject-don't-override stance
   taken for P0-3; deriving is gentler on existing clients.
4. **Atomicity**: accept compensation-on-failure now, or do the `tx` refactor
   first? POS is the strongest argument yet for the refactor, because a
   half-recorded counter sale is discovered by a customer, not by an auditor.
5. **Historical POS repair.** Once the scale is known, the fix is a receipt
   raised per affected sale, dated to the sale — an accounting correction, not
   a data patch, and it needs sign-off.
6. **Day close** should read server receipts rather than the browser book; that
   is arguably part of P0-4 rather than this work.
