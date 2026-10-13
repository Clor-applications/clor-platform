# P0-1 — posted document mutation integrity

**Design pass only. No code changed.**
Baseline `0dbd0f3` (unpushed) · companion to `docs/BUSINESS_LOGIC_AUDIT.md`

The confirmed defect: an invoice posted at ₹118,000 and then PATCHed to ₹40,000
leaves the document at ₹40,000 and the ledger at ₹118,000, with no reversal and
no adjustment. Reproduced against the live API on 18 Sep 2026 — one journal
entry, still `POSTED`, total debits 118,000.

Everything below is read from the implementation at `0dbd0f3`.

---

## 1. Mutation-route matrix

Every route on the server that can change a document after it exists. "Ledger"
is what the route does to the general ledger, not what the UI implies.

| Document | Create | Update | Status change | Cancel | Delete | Reverse |
| --- | --- | --- | --- | --- | --- | --- |
| **Invoice** | `POST /invoices` — **posts** unless an approval rule holds it | `PATCH /invoices/:id` — **does nothing to the ledger** ← the defect | `PATCH /invoices/:id/status` — reverses **only** on the Draft→Cancelled edge | via the status route | `DELETE` — reverses, then deletes; **refused unless status is Draft** | via cancel/delete |
| **Bill** | `POST /bills` — posts | **no route exists** | — | — | `DELETE` — reverses, then deletes; **no status guard** | via delete |
| **Credit note** | `POST /credit-notes` — posts | **no route** (only `PATCH /:id/settlement`, which writes `extrasJson`) | — | — | `DELETE` — reverses + deletes | via delete |
| **Debit note** | `POST /debit-notes` — posts | **no route** (same settlement-only PATCH) | — | — | `DELETE` — reverses + deletes | via delete |
| **Expense** | `POST /expenses` — posts | **no route** (same) | — | — | `DELETE` — reverses + deletes | via delete |
| **Receipt / Payment** | `POST /payments` — posts + derives settlement | **no route**; `PATCH /:id/reconcile` touches only `reconciled`/`bankDate`/`statementRef` | — | — | **no delete route** | `POST /:id/reverse` — contra + settlement recalc |
| **Journal entry** | `POST /ledger/entries` — posts | **no route** | — | — | **no delete route** | `POST /ledger/entries/:id/reverse` |
| **Inventory adjustment** | `POST /adjustments` — writes `StockBalance`, **never the ledger** | none | — | — | none | — |
| **Inter-branch transfer** | `POST` / `send` / `receive` / `reject` — `StockBalance` only, **never the ledger** | — | — | — | — | — |
| **Approval decision** | `POST` governance decide — **posts an invoice on approve** and sets status `Unpaid` | — | — | — | — | — |

### The single most important finding

**`PATCH /orgs/:orgId/invoices/:invoiceId` is the only route in the entire
server that can mutate a posted document's financial fields.** Bills, credit
notes, debit notes, expenses, payments and journal entries have no general
update route at all — they are already immutable after posting, by absence.

P0-1 is therefore an **invoice-only** problem with a single entry point. That
makes it far smaller than the audit implied.

### Two further holes in the same handler

1. **It is a full replace, not a partial patch.** Every column is written from
   the body with `?? 0` defaults — `subtotal: body.subtotal ?? 0`,
   `total: body.total ?? 0`. A caller that PATCHes only `notes` **zeroes every
   financial field on the document.** The ledger, untouched, keeps the original
   amounts. This is a second, quieter route to the same divergence.
2. **It can set `status`.** `status: String(body.status || existing.status …)`.
   The reversal logic lives **only** in the separate `/status` route, so
   `PATCH { status: "Cancelled" }` on the main route cancels the document in
   the list and leaves its posting live in the books.

## 2. Field classification — invoice

Read from `invoiceUpsertSchema` and the PATCH `data` block. `EXTRA_KEYS`
columns live inside `extrasJson`.

| Field | Class | Why |
| --- | --- | --- |
| `subtotal` | **ACCOUNTING** · TAX | credited to `SALES` |
| `cgstTotal` / `sgstTotal` / `igstTotal` | **ACCOUNTING** · TAX | credited to the `*_OUT` control accounts |
| `gstTotal` | presentational | not read by `invoicePostingLines` — derived display only |
| `total` | **ACCOUNTING** · SETTLEMENT | debited to `AR`; also the settlement denominator |
| round-off | **ACCOUNTING**, *derived* | no column; computed at posting as `total − (subtotal+taxes)` and posted to `ROUNDING` |
| `items[]` (qty, rate, discount, gstRate) | **ACCOUNTING** *indirectly* · TAX · INVENTORY | the server never reads them for posting (P0-3); they drive the browser's totals and the browser's stock |
| `customerId` | **ACCOUNTING** | becomes `JournalLine.partyId` on the AR line — the subledger owner |
| `customerName` | narrative | posting description only |
| `date` | **ACCOUNTING** | selects the fiscal year and is lock-checked |
| `currency` / `exchangeRate` | **ACCOUNTING** | set at create from the FX service; **not settable on PATCH** |
| `placeOfSupply` / `taxType` / `customerGstin` / `reverseCharge` | TAX (reporting) | drive GSTR-1 classification; not read at posting |
| `warehouseId` | INVENTORY | browser stock only — server stock is P0-5 |
| `status` | LIFECYCLE + SETTLEMENT (conflated — see §6) | |
| `paidAmount` | **SETTLEMENT** | since `0dbd0f3` re-derived from allocations whenever any exist |
| `number` | ACCOUNTING-ADJACENT | unique per org; appears in narration; statutory series |
| `dueDate`, `refNo`, `refDate` | **IRRELEVANT** | |
| `notes`, `terms`, ship-to, `salesmanId`, `costCenterId` | **IRRELEVANT** | `extrasJson` only |
| `branchId` | **ACCOUNTING — but not mutable** | not in the PATCH `data`; the lookup is scoped by the caller's branch. See §8 |

## 3. Posting identity

- A posting is tied to its document by `JournalEntry.sourceDocType` +
  `sourceDocId` (`'INVOICE'` + invoice id).
- `@@index([accountId, orgId, sourceDocType, sourceDocId])` — **an index, not a
  unique constraint.** Nothing prevents a document being posted twice.
- **One document can carry several entries**, and routinely does: the reversal
  contra copies `sourceDocType`/`sourceDocId` from the original, so after a
  cancel the invoice has two rows under the same `sourceDocId` — the original
  (`REVERSED`) and the contra (`POSTED`).
- Reversal identity is **one-directional**: `original.status = 'REVERSED'` and
  `original.reversedById = contra.id`. **The contra carries no marker of its
  own.**

### Consequence the design must handle

> "Find every live posting for this document" cannot be `where sourceDocId = X
> and status = 'POSTED'`. That query **also returns contra entries**, whose
> amounts are the negation of the original.

The existing cancel and delete handlers use exactly that query. They are safe
today only because the invoice status guards stop them running twice — the
delete route refuses anything that is not `Draft`, and the cancel branch is
gated on `nowCancelled && !wasCancelled`. A reverse-and-repost design would run
this query repeatedly and **must** exclude reversals explicitly:

```
live(doc) = entries where sourceDocId = doc
            and status = 'POSTED'
            and id not in (select reversedById from entries where reversedById is not null)
```

Hash chain: `prevHash` is the most recent `POSTED` entry for `(orgId, branchId)`
by `createdAt desc`; `hash = sha256(prevHash + canonicalPayload)`. It is
per-branch and append-only. Reversal appends; it never rewrites.

## 4. postEntry / reverseEntry contracts

`postEntry(req: PostingRequest)` — `{accountId, orgId, branchId, userId, date,
journalCode, narration?, sourceDocType?, sourceDocId?, lines[]}`.

- **Validation before any write:** ≥2 lines; no negative amounts; no line with
  both a debit and a credit; no zero line; `Σdebit === Σcredit` in **integer
  paise**. Violations throw `PostingError`.
- **Fiscal year:** `ensureFiscalYear` creates the year on demand from the date;
  rejects `status === 'CLOSED'` (409) and rejects `date <= lockedThrough` (409).
- **Numbering:** `nextEntryNo` is gap-free per `(org, branch, journalCode)`,
  computed **inside** the posting transaction.
- **Idempotency / duplicate protection: none.** Posting the same document twice
  produces two entries.
- **Failure:** throws; the transaction rolls back; callers compensate by hand
  (the invoice create path deletes the invoice row).

`reverseEntry({entryId, date?, narration?})` — refuses a non-`POSTED` entry
(409) and one already reversed (409), so it is naturally idempotent-by-refusal.
**It posts the contra on `opts.date || original.date`, and no caller passes a
date** — reversals always land in the original period.

### The blocking architectural fact

> **`PostingRequest` has no transaction parameter. `postEntry` opens its own
> `prisma.$transaction`, and `reverseEntry` performs three separate
> transactions** (read, `postEntry`, update original).

Prisma does not nest interactive transactions; calling `postEntry` inside a
caller's `$transaction` callback would not join it. **Therefore
reverse → update → repost cannot be made atomic without changing `postEntry`'s
signature**, which this phase forbids. This drives the recommendation in §12.

## 5. Settlement interaction (Phase 1 is committed)

Settlement is now derived server-side: `paidAmount = Σ valid allocations`,
status follows. `reassertSettlement` already runs after the invoice PATCH, but
**only when allocations exist** — so it corrects `paidAmount`, and does nothing
about the total the edit just changed.

The hazard is `validAllocated > newTotal`:

| Case | Today | Required |
| --- | --- | --- |
| No settlement | edit succeeds, ledger diverges | reverse+repost, or refuse |
| Partially paid — 118,000 with 50,000 received, edited to 40,000 | succeeds; `paidAmount` 50,000 > total 40,000; `outstanding` clamps to 0; status derives **Paid** | **refuse** |
| Fully paid, edited upward | succeeds; status silently drops to Partially Paid | refuse, or repost |
| Reversed receipts only | allocations are inert, so `validAllocated` is 0 | treat as unsettled |
| On-account receipt | only the allocated slice counts | compare against the allocated slice |

**The product has no customer-credit entity for receipts.** Excess money is held
by leaving it unallocated on the receipt; there is no advance/credit document to
absorb a reduction. Automatic reallocation would be inventing an accounting
model, which is out of scope. **So the rule must be refusal**, at minimum:

```
reject any edit where recomputed total < Σ valid allocations
```

This guard is independent of P0-1 and cheap. Note it is needed even for
*unposted* invoices: nothing stops a receipt allocating to a Draft.

## 6. Lifecycle vs settlement status — where they are conflated

`src/utils/statusRegistry.js` declares one flat vocabulary. Observed on
documents: `Draft`, `Unpaid`, `Partially Paid`, `Paid`, `Overdue`, `Cancelled`,
`Pending Approval`, plus `Approved`/`Rejected` on approvals.

| Status | Posted to the ledger? |
| --- | --- |
| **Draft** | **YES — a Draft invoice posts.** `POST /invoices` posts unconditionally unless an approval rule holds it. Only the *delete* route treats Draft as "never issued" |
| Pending Approval | **No** — the one genuine pre-posting state; posting happens on approve |
| Unpaid / Partially Paid / Paid / Overdue | Yes — and these are **settlement** states, not lifecycle |
| Cancelled | Was posted; reversed **only** if reached through the `/status` route |
| Rejected | not applied to invoices by any route found |

Two axes are stored in one string column. `Draft` and `Cancelled` describe the
document's life; `Unpaid`/`Partially Paid`/`Paid` describe its money;
`Overdue` is a settlement state carrying a date fact. `0dbd0f3` already treats
them as separate in `deriveSettlementStatus` (lifecycle statuses are never
overwritten), but the storage does not.

**Unresolved:** "Draft posts to the ledger" (audit P1-1) is not strictly a
P0-1 defect, but any mutation policy keyed on "is it posted?" must not read
`status === 'Draft'` as "unposted". **The only reliable test is whether a live
journal entry exists** — see §3.

## 7. Fiscal-year locks

`postEntry` is the only enforcement point, and it is honoured on both the
original and the contra, because reversal goes through `postEntry` too.

- Editing an invoice in a locked period **today bypasses nothing, because the
  PATCH never posts.** It silently changes the document while the locked ledger
  keeps the old figures — arguably worse than a rejection.
- Cancelling or deleting an invoice in a locked period **already fails** with
  409, since the contra is dated to the original.
- A reverse-and-repost design **inherits the lock automatically**. It cannot
  bypass it.

### Cross-period edit — an unresolved policy decision

Original dated 31/03 (FY A), edited to 01/04 (FY B). The reversal lands in
**FY A** (original date) and the new posting in **FY B** (new date). Two years'
figures move, and both periods must be open. That is accounting-correct, but
the code defines no policy. **Product decision required:**

- (a) allow it, both periods must be open; or
- (b) refuse a date change that crosses a fiscal year on a posted document,
  directing the user to a credit note.

## 8. Branch change

**Not reachable.** `branchId` is absent from the PATCH `data` block, and the
invoice lookup is scoped by `branchId: req.tenant!.branchId`, so a user in
branch B cannot even load an invoice belonging to branch A.

The hazard is therefore **theoretical today and must stay that way**. If branch
ever becomes mutable it would require reversing in A's hash chain and posting
into B's — two chains, two `entryNo` series, and a document whose history spans
both. **Recommendation: leave branch immutable, and state it as a rule rather
than an accident of the current handler.**

## 9. Tax dependency — is P0-3 a prerequisite?

The server does not compute tax. It stores `body.subtotal/cgstTotal/…/total`
verbatim and posts those numbers, dumping any inconsistency into `ROUNDING`
with no cap (audit P0-3).

**Answer: it depends entirely on which strategy is chosen.**

- **Strategy A (reverse + repost) — P0-3 IS a prerequisite.** Reposting means
  taking client-supplied totals and writing them into the ledger a second time.
  Without server-side recomputation, P0-1 would turn a one-off trust problem
  into a repeatable one: every edit becomes a fresh opportunity to post
  arbitrary numbers, and the uncapped `ROUNDING` plug absorbs the difference
  silently. The **smallest sufficient prerequisite** is not all of P0-3 — it is:
  1. recompute `subtotal`/`cgst`/`sgst`/`igst`/`total` server-side from
     `items[]` using one shared engine, and
  2. reject a document whose rounding difference exceeds ±₹1.
- **Strategy D (refuse financial edits) — P0-3 is NOT a prerequisite**, because
  nothing new is ever posted. D can ship immediately and independently.

## 10. Inventory dependency

Server `StockBalance` is written only by adjustments and transfers; invoices
and bills never touch it (audit P0-5). Stock shown in the app is derived in the
browser from its own documents.

Edits that *should* move stock: `items[]` identity, quantity, `warehouseId`,
and cancellation.

Because the server has no stock authority, a reverse-and-repost that faithfully
corrected the ledger would still leave server stock untouched — and would leave
browser stock recomputed from the edited document with no record of the
original. **Allowing quantity/warehouse edits on posted documents before P0-5
adds a second inconsistency on top of the one being fixed.** Recommendation:
refuse those edits on posted documents rather than pretending inventory
integrity exists.

## 11. Proposed mutation policy

"Posted" = a live journal entry exists for the document (§3), **not** a status
string. "Settled" = `Σ valid allocations > 0`.

| Field / action | Unposted | Posted | Posted **and** settled |
| --- | --- | --- | --- |
| `notes`, `terms`, ship-to, `salesmanId`, `costCenterId` | allow | **allow** | allow |
| `refNo`, `refDate` | allow | **allow** | allow |
| `dueDate` | allow | **allow** (changes Overdue only) | allow |
| `customerName` (same customer, spelling) | allow | allow | allow |
| `customerId` | allow | **refuse** — moves the AR subledger | refuse |
| `number` | allow | **refuse** — statutory series | refuse |
| `date` | allow | **refuse** in Phase D | refuse |
| `items[]`, qty, rate, discount | allow | **refuse** | refuse |
| tax rate, `placeOfSupply`, `taxType`, `reverseCharge` | allow | **refuse** | refuse |
| `subtotal`, tax totals, `total` | allow | **refuse** | refuse |
| `currency` / `exchangeRate` | not settable | not settable | not settable |
| `warehouseId` | allow | **refuse** until P0-5 | refuse |
| `branchId` | not settable | **not settable** | not settable |
| `status` → Cancelled | allow | **route to the cancel path** (must reverse) | refuse while settled — reverse the receipts first |
| `paidAmount` | derived | derived | derived |
| delete | allow (Draft only, as today) | refuse (as today) | refuse |
| any edit where `newTotal < Σ valid allocations` | **refuse** | refuse | refuse |

## 12. Strategy comparison

| | Fits current architecture? | Needs `postEntry` change? | Needs P0-3? | Verdict |
| --- | --- | --- | --- | --- |
| **A — reverse + update + repost** | Poorly today: `postEntry` owns its transaction (§4), so the three steps cannot be atomic | **Yes** — an optional `tx` parameter | **Yes** (minimum: server-side totals + rounding cap) | Right destination, wrong phase |
| **B — delta/adjustment entry** | Needs a diffing engine and an adjustment journal that does not exist; a partial-period delta misstates both periods | Yes | Yes | Rejected — most machinery, least precedent |
| **C — immutable + credit note** | **Already the product's model**: credit notes exist, post correctly, and the delete guard already cites Rule 46(b) | No | No | Correct long-term user-facing answer |
| **D — refuse financial edits after posting** | **Exactly the existing posture** for bills, notes, expenses, payments and journal entries, all of which have no update route | **No** | **No** | **Recommended now** |

### Recommendation

**Ship D now; keep C as the user-facing amendment path; defer A until P0-3
lands.**

D is not a workaround — it makes the invoice consistent with every other
document in the product. Five document types already have no edit route, the
delete guard already refuses to destroy an issued invoice on statutory grounds,
and a GST invoice that has been reported is legally amended by credit note
rather than edited. D closes the divergence completely, needs no schema change,
no `postEntry` change and no P0-3, and it does not foreclose A.

Its cost is honest: users who today "fix" a posted invoice by editing it must
cancel and reissue, or raise a credit note. That is a real workflow change and
needs product sign-off.

## 13. Transaction boundary

**Under D** the whole mutation is one `prisma.invoice.update` — already atomic.
The validation reads (live entries, valid allocations) happen before it; the
worst case of a race is a refusal, never a partial state.

**Under A**, the required boundary is:

```
BEGIN
  load document + live entries + valid allocations   (FOR UPDATE semantics)
  validate new state                                  (totals, settlement, lock, period)
  reverse live entries                                (contra, original date)
  update document
  post new entry                                      (new date)
COMMIT — or roll back all of it
```

This is **not achievable at `0dbd0f3`**. `postEntry` and `reverseEntry` each
open their own transaction, and Prisma will not join them to a caller's. The
minimum enabling change is an **optional `tx` parameter** threaded through
`postEntry`, `reverseEntry`, `ensureFiscalYear`, `nextEntryNo` and
`resolveControlAccountId` — additive, no behaviour change when omitted.

Note SQLite serialises writers, so a long interactive transaction here blocks
the whole API; on Postgres (`docs/POSTGRES-CUTOVER.md`) it would not. That is a
further argument for D now.

## 14. Required regression scenarios

| # | Scenario | Expected under D |
| --- | --- | --- |
| 1 | ₹118,000 posted invoice → edit total to ₹40,000 | **refused 409**; document and ledger both remain 118,000 |
| 2 | ₹118,000, ₹50,000 settled → edit total to ₹40,000 | **refused**, citing the allocation |
| 3 | Edit `notes` only | succeeds; **no new journal entry**; financial fields unchanged (this also pins the `?? 0` full-replace bug) |
| 4 | Change `customerId` on a posted invoice | refused; AR subledger owner unchanged |
| 5 | Change a GST-relevant line on a posted invoice | refused; tax ledgers unchanged |
| 6 | Change branch | not expressible; assert the field is not settable |
| 7 | Edit an invoice in a locked period | refused; assert the lock is not bypassed and that a refusal — not a silent success — is what happens |
| 8 | Posting fails midway (A only) | whole mutation rolls back |
| 9 | Repeated identical PATCH | idempotent; no reversal, no repost, no new entry |
| 10 | Edit a Cancelled or already-reversed invoice | refused by explicit lifecycle rule |
| 11 | Edit an **unposted** (Pending Approval) invoice | allowed, full financial edit |
| 12 | `PATCH { status: "Cancelled" }` on the main route | must reverse, or be refused and directed to `/status` |
| 13 | Partial PATCH omitting `subtotal` | must not zero the financial fields |

## 15. Unresolved product decisions

1. **Cross-fiscal-year date edits** — allow with both periods open, or refuse?
   (§7). No policy exists in code.
2. **Does D's workflow change get sign-off?** Editing a posted invoice becomes
   cancel-and-reissue or credit-note. This is the only user-visible cost.
3. **Should Draft stop posting?** (audit P1-1.) Until it does, "posted" must be
   tested by the existence of a live entry, never by status.
4. **Is `number` ever editable after posting?** Currently yes, subject only to
   uniqueness. Statutorily it should not be.
5. **Should `PATCH` become a true partial patch?** The `?? 0` full-replace is a
   live hazard independent of P0-1.
6. **Branch immutability** — currently accidental. Make it a stated rule.

---

# Implemented — Strategy D

Implemented at `0dbd0f3` + working tree, 18 Sep 2026. Uncommitted.
No schema change, no change to `postEntry`/`reverseEntry`, no reverse-and-repost.

## What "posted" means in code

`server/src/services/postingState.ts` — `livePostingsFor` / `hasLivePosting`.

Document status is **not** consulted, because a Draft invoice posts today
(audit P1-1). A posting is live when it belongs to the document, is `POSTED`,
and is not itself a contra entry. The contra is identified the only way the
schema allows: by collecting every `reversedById` referenced by the document's
own entries, since a reversal carries no marker of its own and copies the
original's `sourceDocId`.

Proven by test: after a cancellation the document has two entries, exactly one
of them `POSTED` — and `livePostingsFor` returns **zero**, where the naive
query would return one.

## Immutable on a live-posted invoice

**Money and identity:** `subtotal`, `cgstTotal`, `sgstTotal`, `igstTotal`,
`total`, `customerId`, `date`, `number`, `items[]` economics, and
`customerName` **only when the invoice has no `customerId`** — a walk-in billed
by name alone has nothing else identifying the counterparty, so the name is the
identity; where a customerId exists, a spelling correction is allowed.

**Tax treatment and attribution:** `customerGstin`, `placeOfSupplyState`,
`taxType`, `reverseCharge`, `warehouseId`.

### Why the GSTIN is in that list

It was investigated rather than assumed, and it is **not** a printable
snapshot:

- `src/utils/gstrExport.js:146,209` — `customerGstin` is the counterparty's
  **CTIN** in GSTR-1, and whether it is present is what sorts the invoice into
  the **b2b** or **b2c** block. It also feeds the place-of-supply code
  (`:178`, `:216`).
- `src/utils/einvoice.js:78,84,95` — it becomes `BuyerDtls.Gstin` in the INV-01
  payload and decides `SupTyp: 'B2B' | 'B2C'`; it also derives the buyer state.
- `src/utils/einvoice.js:136` — it is `toGstin` on the e-way bill.
- The invoice row stores `irn`, `irnSignedInvoice` and `einvoicePayloadJson` —
  the payload actually registered with the IRP, kept verbatim. Editing the
  GSTIN after registration leaves the document disagreeing with its own signed
  e-invoice.

So it is category **B — part of tax/compliance identity and reporting** — and
it is immutable once posted.

`placeOfSupplyState` and `taxType` decide CGST+SGST against IGST, which is
which tax account was credited. `reverseCharge` decides who owes the tax at
all. `warehouseId` is inventory attribution, and with server stock authority
still unresolved (audit P0-5) re-attributing a posted sale would add a second
document-versus-stock inconsistency on top of the existing one.

Immutable regardless of posting: `branchId` (explicitly refused at the route,
no longer merely absent from the update), and `status` through the general
PATCH (lifecycle transitions belong to the status route, which owns reversal).

Still editable on a posted invoice: `dueDate`, `refNo`, `refDate`, and the
`extrasJson` fields (`salesmanId`, `costCenterId`, ship-to, other charges, POS
fields). All of these are metadata with no posted accounting or tax effect.
Every one of the fields above stays fully editable while nothing is posted.

Line economics are compared **semantically** — item id, name, quantity, rate,
discount amount and percentage, GST rate, line amount, all in integer paise —
so re-sending identical lines in a different key order or numeric spelling is
not an amendment. Presentation-only keys (description, HSN) are not compared.

## PATCH semantics, before and after

**Before:** every column was written from the parsed body with `?? 0` behind
it. A request carrying only a reference set `subtotal`, every tax total and
`total` to **zero**, while the ledger it never touched kept the original
figures. Proven: reverting that one line makes the metadata test fail with
`expected +0 to be 118000`.

**After:** the set of keys the caller actually sent is read from `req.body`
before Zod applies defaults; an omitted field keeps its stored value. Extras
are merged rather than rebuilt, so a partial edit no longer drops the salesman
and the shipping address stored beside the field being changed. It is a PATCH,
not a PUT.

## Settlement guard

Runs on any edit that changes `total`, **posted or not** — a receipt can be
allocated to a draft. Uses Phase 1's canonical `validAllocatedPaise`; no second
allocation calculation exists. An invoice may not be reduced below what has
been received against it, because receipts have no customer-credit document to
absorb the difference.

## Test evidence

`server/src/__tests__/postedInvoiceMutation.test.ts` — **27 tests**, covering
scenarios A–O of §14, the tax-treatment and attribution fields, metadata that
must stay editable, and live-posting detection. Verified to fail on the unfixed
code: **12 of 19** failed with the guard removed, the metadata test fails
independently with the old `?? 0` restored, and **5 of the 5** tax/attribution
refusals fail when those fields are dropped from the policy.

Accounting integrity after every scenario: refusals create no journal entry, no
reversal, and no settlement or allocation change; the ledger stays balanced.

## One existing test changed

`audit.test.ts` → "carries the per-field diff of an edit" edited a **posted**
invoice's total from 1,180 to 118 and asserted the audit diff. That edit is the
defect this work removes, so it now returns 409. The test's intent — that the
trail carries a per-field diff rather than the word "edited" — is preserved by
diffing `dueDate`, which is still the user's to change, and a second test
asserts that a refused edit records nothing at all.

## Known limitation — the invoice form

`src/features/sales/index.jsx:4014` offers **"Update Invoice"** with the full
form editable for any non-draft invoice. The server now refuses the financial
part of that save with 409, and `apiFetch` surfaces the server's message
verbatim through `notify.error`, so the user is told why — but the controls
still look editable until they press save. Making them visibly read-only is a
UX task, deliberately not done here.

## Still open after this change

P0-1 is remediated **for invoices**, which is the only document with an edit
route. Unchanged and still open: P0-3 (client-supplied totals), P0-4 (the dual
book), P0-5 (stock authority), P1-1 (Draft posts to the ledger), and the
unresolved product decisions in §15 above — none of which this strategy needed.
