# P0-3 — server-side invoice calculation authority

**Audit / design pass only. No code changed.**
HEAD `d024b6d` · companion to `BUSINESS_LOGIC_AUDIT.md` and
`POSTED_DOCUMENT_MUTATION_DESIGN.md`

The defect: the server accepts `subtotal`, `cgstTotal`, `sgstTotal`,
`igstTotal` and `total` from the client, stores them verbatim, and posts them.
`invoicePostingLines` then dumps any difference between the declared total and
the sum of its parts into the `ROUNDING` account **with no cap**. A
mathematically invalid invoice therefore produces a perfectly balanced journal
entry.

---

## 1. Every ingestion path

| # | Input source | Calculator | Fields sent | Server validation | Stored | Posting |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sales invoice form (`features/sales/index.jsx`) | **client** `utils/gst.js` | subtotal, cgst, sgst, igst, gstTotal, total, items, discounts, otherCharges | **none** — Zod types only | verbatim | `POST /invoices` → `invoicePostingLines` |
| 2 | **POS** (`features/sales/PosScreen.jsx`) | **client** `utils/gst.js`, `isIntra: true` hardcoded | same, plus `posSale`, `tender`; **no `paidAmount`** | none | verbatim | same route |
| 3 | Sales orders / quotations | client `gst.js` | totals on their own models | none | verbatim | not posted until invoiced |
| 4 | Recurring invoices (`RecurringInvoices.jsx`) | client `gst.js` | as (1) | none | verbatim | as (1) |
| 5 | **Import — invoice** (`routes/imports.ts`) | **server, its own arithmetic** | per-row qty/rate/discount_pct/gst_rate | row-level Zod spec | server-derived | `invoicePostingLines` |
| 6 | Import — bill / credit note / debit note | **server, same arithmetic** | as (5) | as (5) | server-derived | `DOC_POSTING` map |
| 7 | **Import — journal** (opening balances) | none — debit/credit given directly | account_code, debit, credit | balance enforced by `postEntry` | journal lines only | `postEntry` `JV` |
| 8 | Purchase bill / expense form | client `gst.js` (`features/purchase/index.jsx`) | as (1) | none | verbatim | `purchaseDocs` |
| 9 | Credit / debit note form | client `gst.js` | as (1) | none | verbatim | `purchaseDocs` |
| 10 | Direct API (any token holder) | **none** | anything the schema accepts | none | verbatim | posts |

**There are two calculators, not one.** `utils/gst.js` in the browser, and a
second, independent one inline in `routes/imports.ts`. They disagree — see §3
and §5.

## 2. `utils/gst.js` — exact current formulas

`round2(n) = Math.round(n * 100) / 100`, IEEE-754 doubles throughout.

### Per line — `computeGstForLine`

```
gross      = round2(quantity × rate)
discount   = 0
             + (discountPct > 0 ? gross × min(discountPct,100)/100 : 0)   // unrounded
             + (discountAmount > 0 ? discountAmount : 0)
discount   = round2(min(discount, gross))                                 // capped at gross
taxable    = round2(gross − discount)
gst        = round2(taxable × gstRate / 100)

intra:  cgst = round2(gst / 2)
        sgst = round2(gst / 2)        ← both halves rounded INDEPENDENTLY
        igst = 0
inter:  cgst = 0, sgst = 0, igst = gst

lineTotal  = round2(taxable + gst)
```

### Per document — `computeGstForLines`

```
grossSubtotal        = round2(Σ computeGstForLine(line, gstRate=0).taxable)
invoiceDiscountValue = type==='pct' ? round2(grossSubtotal × min(v,100)/100)
                                    : round2(min(v, grossSubtotal))
scale                = grossSubtotal > 0
                       ? (grossSubtotal − invoiceDiscountValue) / grossSubtotal
                       : 1                                    ← unrounded ratio

each line recomputed with  rate × scale  and  discountAmount × scale

subtotal        = round2(Σ line.taxableAmount)
cgstTotal       = round2(Σ line.cgstAmount)
sgstTotal       = round2(Σ line.sgstAmount)
igstTotal       = round2(Σ line.igstAmount)

chargeRows      = otherCharges.filter(amount>0)
                    .map(c => computeGstForLine({quantity:1, rate:c.amount, gstRate:c.gstRate}))
otherChargesTotal = round2(Σ chargeRow.taxableAmount)
cgstT           = round2(cgstTotal + Σ chargeRow.cgstAmount)
sgstT           = round2(sgstTotal + Σ chargeRow.sgstAmount)
igstTotal       = round2(igstTotal + Σ chargeRow.igstAmount)

gstTotal        = round2(cgstT + sgstT + igstTotal)
total           = round2(subtotal + otherChargesTotal + gstTotal)
```

**There is no round-off field.** No line, no document, computes a deliberate
final rounding adjustment. Every `ROUNDING` posting that exists today is a
*residue*, not an intention.

## 3. `routes/imports.ts` — the second calculator

```
taxable   = qty × rate × (1 − discountPct/100)      ← NO rounding
gstAmount = (taxable × gstRate) / 100               ← NO rounding
subtotal  = Σ taxableAmount                          ← NO rounding
gstTotal  = Σ gstAmount                              ← NO rounding
total     = subtotal + gstTotal
stored as  new Prisma.Decimal(x.toFixed(2))          ← rounded ONCE, at the end
```

versus `gst.js`, which rounds at **every** step. For the same input the two can
differ by paise — and both post to the same ledger through the same function.

## 4. Precision audit

| Boundary | Today |
| --- | --- |
| input parsing | `Number(v)` — float |
| line gross | `round2` (gst.js) / none (imports) |
| percentage discount | **unrounded** intermediate, then `round2` on the sum |
| taxable | `round2` / none |
| GST per line | `round2` / none |
| CGST / SGST halves | `round2` each, **independently** / residual-preserving (imports) |
| line total | `round2` / none |
| document aggregates | `round2` of a float sum / raw float sum |
| storage | SQLite `Decimal` → NUMERIC affinity → **IEEE-754 double** |
| posting input | `Number(...)` from the request body — float |
| **posting internals** | **integer paise** (`toPaise`, `Math.round(n*100)`) — the one clean boundary |
| settlement (`0dbd0f3`) | **integer paise** |
| mutation guard (`d024b6d`) | **integer paise** |

So the product already converged on integer paise everywhere *except* the
calculation itself. **Three representations are mixed**: float, 2-dp rupees,
integer paise — and the float region is precisely the region that decides what
gets posted.

## 5. The three concepts, kept apart

| | Definition | Where it should live |
| --- | --- | --- |
| **A — calculation precision** | Internal precision while multiplying, apportioning and summing | Integer paise, with a defined higher-precision intermediate for ratios (§13). **Never** reaches the ledger as a residue |
| **B — statutory / display rounding** | The 2-dp values printed on the invoice and filed in GSTR-1 | Deterministic rounding at defined points; the printed values must re-add to the printed total |
| **C — final payable round-off** | A deliberate adjustment of the payable amount (e.g. to the nearest rupee) | The **only** thing `ROUNDING` may carry |

Today A, B and C are indistinguishable, because `ROUNDING` receives whatever is
left over from any cause.

## 6. CGST / SGST odd paise

`gst.js` computes `cgst = round2(gst/2)` and `sgst = round2(gst/2)`
independently.

**Worked failure.** Taxable ₹1,000.05 at 5%:

```
gst  = round2(50.0025)   = 50.00      → halves 25.00 + 25.00 = 50.00   ✓
```

Taxable ₹190.00 at 18%:

```
gst  = round2(34.20)     = 34.20      → round2(17.10) × 2 = 34.20      ✓
```

Taxable ₹99.99 at 3%:

```
gst  = round2(2.9997)    = 3.00       → round2(1.50) × 2 = 3.00        ✓
```

Taxable ₹1.05 at 5%:

```
gst  = round2(0.0525)    = 0.05
half = round2(0.025)     = 0.03       (JS rounds .5 away from zero here)
cgst + sgst = 0.06  ≠  gst 0.05       ✗  — one paisa manufactured
```

The failure is real but **rate-and-amount dependent**: it appears whenever
`gst` in paise is odd and the half lands exactly on a half-paisa. Every such
paisa currently flows into `ROUNDING` at document level, because `gstTotal` is
recomputed as `cgstT + sgstT`.

### The convention already exists — do not invent one

`routes/imports.ts` states it explicitly:

```ts
const half = Math.round((gstTotal / 2) * 100) / 100;
// The remainder keeps the two halves summing to the whole on odd paise.
return { cgst: half, sgst: Math.round((gstTotal - half) * 100) / 100, igst: 0 };
```

**CGST is floored, SGST carries the residual paisa.** That is the product's own
existing answer, written down in its own comment, and the canonical calculator
should adopt it rather than choose afresh:

```
cgstPaise = floor(gstPaise / 2)
sgstPaise = gstPaise − cgstPaise
```

Invariant: `cgstPaise + sgstPaise === gstPaise`, per line **and** per document.

**Unresolved:** whether the split is applied per line (and the document totals
are sums of line halves) or once at document level. The two differ by paise.
`gst.js` does it per line; `imports.ts` does it per document. A decision is
required.

## 7. Discount contract

Supported, from the implementation:

- **line percentage** — `discountPct`, capped at 100
- **line flat** — `discountAmount`
- **both on one line** — they add: `pct` applied to gross, then flat subtracted
- **invoice level** — `{type: 'pct' | 'amt', value}`, applied **before GST**

Invoice-level discount is distributed **proportionally**, by scaling each
line's `rate` and `discountAmount` by an **unrounded** ratio
`(grossSubtotal − discount) / grossSubtotal`. Consequences:

- there is **no residual-paise allocation** — the ratio is applied to every
  line and the results are independently rounded, so `Σ discounted lines` need
  not equal `grossSubtotal − invoiceDiscountValue`
- zero-rated and zero-value lines participate (they scale to zero anyway)
- a discount exceeding gross is capped per line (`min(discount, gross)`) and
  per document (`min(v, grossSubtotal)`)
- `invoiceDiscountApplied` is stored in `extrasJson` for display; **no column**

**Unresolved:** the canonical calculator must decide whether invoice discount
is apportioned by scaling rates (current, lossy) or by distributing a paise
amount across lines with an explicit residual rule (deterministic). The second
is the only one that can satisfy `Σ lines == subtotal` exactly.

## 8. GST inclusive vs exclusive

**Exclusive only.** A search of `src/`, `server/src/`, the Prisma schema,
settings and import specs finds no inclusive-pricing concept — every hit for
"inclusive" is a date range, a threshold bound, or a TDS comment. `rate` is
always a pre-tax rate.

**Do not design a reverse-tax formula.** If inclusive pricing is ever wanted it
is a new feature with its own contract, not part of P0-3.

## 9. Supply type

`utils/gst.js`:

```
getGstStateFromGstin(gstin)  = GST_STATE_BY_CODE[gstin.slice(0,2)]
getCompanyGstProfile(company) / getPartyGstProfile(party)
isIntraStateSupply({companyState, partyState}) =
    normalize(companyState) === normalize(partyState)
canDetermineSupplyType({companyState, partyState}) =
    Boolean(normalize(companyState)) && Boolean(normalize(partyState))
```

Authority order in practice: the party's explicit state, else the state derived
from their GSTIN; the company's state comes from its own profile/GSTIN.

**Failure mode today:** `isIntraStateSupply` returns `false` when either side is
unknown, because two empty strings are compared — so an **unknown supply type
silently becomes IGST**. `canDetermineSupplyType` exists to catch exactly this
and is advisory; nothing rejects the document.

**POS bypasses all of it** — `isIntra: true` is hardcoded and
`taxType: 'CGST_SGST'` is sent with no place of supply. For an over-the-counter
sale that is correct in law, but it is an assumption the server cannot see.

**Unresolved:** should the server refuse a taxable invoice whose supply type
cannot be established? Recommended yes, with POS passing an explicit
counter-sale marker rather than relying on a silent default.

## 10. Tax categories actually supported

| Category | Supported? |
| --- | --- |
| Taxable at a rate | **yes** — `gstRate` per line |
| Zero-rated | **no** — a 0% rate is a rate, not a classification |
| Exempt / nil-rated | **no** — `gstrExport.js:298` hardcodes `osup_nil_exmp: {txval: 0}` |
| Non-GST | **no** — `:300` hardcodes `osup_nongst: {txval: 0}` |
| Export / SEZ | **no** — `gstrExport.js:11` says outright the product "has no data for" exports |
| Cess | **no** — no field, no column, no posting |
| Reverse charge | **flag only** — `reverseCharge` boolean is stored and reported, never posted |
| TCS | **separate module** (`utils/tdsTcs.js`), computed from bill totals for 206C reporting; **does not enter invoice totals** |

The canonical calculator should therefore model **one dimension — a GST rate
per line** — and nothing else. Adding categories is a separate feature.

## 11. Other charges — a live ROUNDING leak

`gst.js` taxes other charges and adds them to `total`, but **excludes them from
`subtotal`**. The server stores them in `extrasJson` only — there is no column
and no ledger account. `invoicePostingLines` credits `SALES` with `subtotal`
**alone**.

**Worked example.** Lines ₹100,000 @18%, one other charge ₹5,000 @18%:

```
subtotal          = 100,000        (lines only)
otherChargesTotal =   5,000
gstTotal          =  18,900
total             = 123,900

posting: Dr AR 123,900
         Cr Sales      100,000
         Cr CGST         9,450
         Cr SGST         9,450
         computed     = 118,900
         ROUNDING     =   5,000   ← the entire other charge
```

**₹5,000 of real revenue is posted as "Rounding difference".** This is not a
hypothetical: it is what the current code does with a documented, shipped
feature.

## 12. ROUNDING audit

```ts
const computed = round2(subtotal + cgst + sgst + igst);
const total    = declaredTotal || computed;
const rounding = round2(total − computed);
if (rounding > 0) lines.push({controlKind:'ROUNDING', credit: rounding, ...});
if (rounding < 0) lines.push({controlKind:'ROUNDING', debit: −rounding, ...});
```

**No tolerance of any kind.** `subtotal: 100, total: 118000` posts a balanced
entry crediting **₹117,900** to Rounding. The account is a balancing plug, and
today it absorbs at least four different things: genuine round-off (none is
ever computed), CGST/SGST split residue, other charges (§11), and arbitrary
client disagreement.

### Evidence for a tolerance, before choosing one

The QA database shows **every** seeded invoice carrying a −0.01 plug, which is
sub-paise noise, not intent. No code anywhere computes a deliberate round-off;
no setting exposes "round the invoice to the nearest rupee". So:

- **today's real residues are ≤ ₹0.01** in normal use
- **the only large residues come from other charges** (§11), which is a
  modelling bug, not rounding
- Indian practice commonly rounds the payable to the nearest rupee, which would
  need `|round-off| ≤ ₹0.50` **if that feature existed** — it does not

**Recommendation:** the canonical calculator computes `roundOffPaise`
**explicitly** as an output. Posting then asserts
`total == components + roundOff` with **zero** tolerance, and the validation
boundary (§13) is where client disagreement is judged. `ROUNDING` stops being a
plug and becomes a posted, intended figure.

If a nearest-rupee round-off feature is later wanted, the bound is ±50 paise
and it belongs in the calculator, not the posting engine.

## 13. Client / server contract

| Option | Assessment |
| --- | --- |
| **A — silently override** | **Rejected.** The user sees the invoice they typed and the ledger holds something else — the same divergence P0-1 just closed, with the server as the culprit. Invisible corrections are the failure mode to avoid |
| **B — reject mismatch** | Correct, but breaks every existing client at once if the tolerance is exact |
| **C — client stops sending totals** | The destination; requires the client to be updated in lockstep |
| **D — compute, compare, reject material difference, persist server values** | **Recommended**, transitioning to C |

### Recommended contract

1. Server computes the canonical result from **economic inputs only** — items
   (qty, rate, discounts, gstRate), invoice-level discount, other charges,
   supply type.
2. If the client also sent derived totals, they are **compared, not used**.
3. Agreement within tolerance → **persist the server's values**, not the
   client's. This matters even when they agree: it makes the server the writer.
4. Material disagreement → **422** with a diagnosable body.
5. Later, derived totals are dropped from the request schema entirely (C).

**Status code:** `422 Unprocessable Entity` for a payload whose arithmetic does
not hold — the request is well-formed but semantically wrong. `409` is already
used for lifecycle refusals (P0-1) and should stay distinct.

```json
{
  "error": "The invoice totals do not match its lines.",
  "mismatches": [
    { "field": "total",     "supplied": 118000.00, "calculated": 118.00, "difference": 117882.00 },
    { "field": "cgstTotal", "supplied": 0.00,      "calculated": 9.00,   "difference": -9.00 }
  ]
}
```

Nothing internal is exposed — no ledger accounts, no entry numbers, no SQL.

## 14. Integer-paise design

The calculator works in **integer paise** end to end. Two places need more
precision temporarily:

- **percentage discount** — `gross × pct / 100`
- **GST** — `taxable × rate / 100`
- **proportional invoice discount** — a ratio across lines

Design: compute these in a scaled integer domain (e.g. paise × 10⁴, i.e.
`BigInt` or safe `Number` under 2⁵³), and convert down at **one defined
boundary per value** with a stated rounding mode (half-up, matching
`Math.round`'s behaviour on positives). Apportionment uses the **largest-
remainder** method so `Σ allocations == the amount being allocated` exactly,
with the residual assigned by a fixed rule (largest fractional part first, ties
to the earliest line).

No float ever accumulates. `Number` is used only to parse input and to format
output.

## 15. Posting contract

`invoicePostingLines` should receive **only** values read back from the
persisted invoice, which are by then server-computed. The smallest change that
achieves "client values cannot determine ledger amounts":

- `routes/invoices.ts` passes the **stored row** to `invoicePostingLines`
  instead of `body.*` (it currently passes `body`)
- `roundOff` becomes an explicit input rather than a derived remainder
- `invoicePostingLines` **asserts** `total === subtotal + taxes + roundOff` and
  throws rather than plugging the difference

`postEntry` is untouched throughout; it remains a consumer of validated state.

## 16. POS compatibility

POS sends: no `placeOfSupplyState`, no `customerId`, `taxType: 'CGST_SGST'`,
`isIntra: true` baked into the client computation, `status: 'Paid'`, and
**no `paidAmount`**.

Under the proposed contract POS would pass validation **only if** the server
can derive intra-state supply. It cannot today — there is no place of supply on
the payload. **POS needs an explicit counter-sale marker** (`posSale: true`
already exists in `EXTRA_KEYS`) that the calculator reads as "place of supply =
supplier's state".

### A severe defect found while tracing POS — documented, not fixed

**A POS sale's receipt exists only in the browser.** `PosScreen.jsx` creates a
`receipt` row in `db.payments` (local) and sets `paidAmount` locally, but the
server payload contains no `paidAmount` and **no Payment is created on the
server**. The invoice therefore posts `Dr AR / Cr Sales` and **nothing ever
credits AR**; the cash never reaches the ledger.

Net effect on the books: **accounts receivable overstated and cash understated
by the whole of every POS sale.** Since `0dbd0f3`, `reassertSettlement` only
runs when allocations exist, so the invoice also sits at `status: 'Paid'` with
`paidAmount: 0` — the impossible state INV-6 forbids.

This is a **new P0-class finding**, separate from P0-3. It belongs in the audit
backlog and should not be folded into this work.

## 17. Import and opening-balance compatibility

Two genuinely different things:

**Transaction import** (`INVOICE`, `BILL`, `CREDIT_NOTE`, `DEBIT_NOTE`) carries
full economic inputs — qty, rate, discount_pct, gst_rate — and already computes
server-side. It should be **migrated onto the canonical calculator**, which
also removes the second engine. Its totals may shift by paise; that is the
point, and it needs saying to whoever runs an import.

**Opening balances** (`JOURNAL` import) carry no economic inputs at all — only
`account_code`, `debit`, `credit`. They must **never** be forced through
item-level calculation. They already have their own integrity guarantee:
`postEntry` refuses an unbalanced entry.

**A trusted-import mode is NOT proposed here**, but if historical invoices ever
need to be loaded with totals that the calculator would not reproduce (foreign
rounding, legacy tax schemes), that mode is a **security boundary**: it must be
a distinct permission, not merely a flag on the request, and it must mark the
resulting documents as externally-sourced (`sourceSystem` already exists).

## 18. Credit / debit note compatibility

Notes are raised through the same client engine (`gst.js`) and stored verbatim
by `purchaseDocs`, exactly like invoices. `creditNotePostingLines` /
`debitNotePostingLines` mirror `invoicePostingLines` and have the **same
uncapped rounding plug**.

The canonical calculator should be **document-type agnostic** — it computes
line economics and tax, and the caller decides which accounts they land in.
Extending it to notes and bills is a later phase, not this one.

## 19. Proposed canonical calculator

```
calculateInvoice(input, taxContext) → CanonicalInvoice
```

**Input (economic only):**

```
lines: [{ itemId?, description?, quantityMilli, ratePaise,
          discountPctBasis?, discountAmountPaise?, gstRateBasis }]
invoiceDiscount?: { type: 'pct' | 'amt', valueBasisOrPaise }
otherCharges?: [{ label, amountPaise, gstRateBasis }]
```

**taxContext:**

```
{ supplyType: 'INTRA' | 'INTER',        // resolved by the caller, never guessed
  roundOffPolicy: 'NONE' | 'NEAREST_RUPEE' }
```

**Output:**

```
{ lines: [{ grossPaise, discountPaise, taxablePaise,
            gstPaise, cgstPaise, sgstPaise, igstPaise, lineTotalPaise }],
  subtotalPaise, invoiceDiscountPaise, otherChargesPaise,
  taxablePaise, cgstPaise, sgstPaise, igstPaise, taxPaise,
  roundOffPaise, totalPaise }
```

Pure, deterministic, side-effect free, no React, no Prisma, no I/O. Lives
server-side and is the single engine; the browser keeps `gst.js` for immediate
feedback until phase C retires it.

**Open question:** whether `otherCharges` join `subtotal` (fixing §11) or gain
their own ledger account. Either fixes the leak; they post differently.

## 20. Invariants the design must make provable

```
INV-C1   Σ line.taxablePaise + otherChargesPaise − invoiceDiscountPaise == subtotalPaise
INV-C2   taxPaise == cgstPaise + sgstPaise + igstPaise
INV-C3   INTRA ⇒ cgstPaise + sgstPaise == taxPaise  and  igstPaise == 0
INV-C4   INTER ⇒ igstPaise == taxPaise  and  cgst == sgst == 0
INV-C5   totalPaise == subtotalPaise + taxPaise + roundOffPaise      (exactly)
INV-C6   |roundOffPaise| ≤ policy bound (0 today; 50 if nearest-rupee ships)
INV-C7   calculate(x) == calculate(x)                 — deterministic
INV-C8   calculate(calculate(x).asInput()) == calculate(x)   — idempotent
INV-C9   no ledger amount derives from req.body
INV-C10  ROUNDING carries only roundOffPaise
```

## 21. Golden test matrix

Paise, intra-state unless stated. Cases 1–17 assume the corrected split
(CGST floored, SGST carries the residual).

| # | Case | Input | Expected |
| --- | --- | --- | --- |
| 1 | simple | 1 × ₹100 @18% | taxable 10000, gst 1800, cgst 900, sgst 900, total 11800 |
| 2 | decimal qty | 2.5 × ₹40 @18% | taxable 10000, gst 1800, total 11800 |
| 3 | rate with paise | 3 × ₹333.33 @18% | taxable 99999, gst 18000 (17999.82→18000), total 117999 |
| 4 | pct discount | 1 × ₹100 @18%, 10% | taxable 9000, gst 1620, total 10620 |
| 5 | flat discount | 1 × ₹100 @18%, ₹5 | taxable 9500, gst 1710, total 11210 |
| 6 | line + invoice discount | 2 lines ₹100 @18%, line 10%, invoice 5% | Σ lines == subtotal exactly; residual by largest remainder |
| 7 | intra | as (1) | cgst 900, sgst 900, igst 0 |
| 8 | inter | as (1) | igst 1800, cgst 0, sgst 0 |
| 9 | **odd paise** | 1 × ₹1.05 @5% | gst 5, **cgst 2, sgst 3**, cgst+sgst == gst |
| 10 | zero rate | 1 × ₹100 @0% | taxable 10000, gst 0, total 10000 |
| 11 | mixed rates | ₹100@18% + ₹100@5% | gst 1800 + 500 = 2300; halves sum exactly |
| 12 | proportional residual | 3 lines ₹33.33, invoice discount ₹10 | Σ allocated == 1000 exactly |
| 13 | walk-in | no customerId, POS marker | INTRA; passes |
| 14 | unknown supply type | no company state, no party state | **rejected** |
| 15 | client off by ₹0.01 | total 11801 vs 11800 | within tolerance → server value persisted |
| 16 | client off by ₹1 | total 11900 | **422** |
| 17 | client off by ₹100 | total 21800 | **422** |
| 18 | **malicious** | subtotal 100, total 11800000 | **422**, never reaches posting |
| 19 | POS | POS payload, counter-sale marker | accepted, INTRA |
| 20 | import row | qty/rate/discount_pct/gst_rate | same result as the form for the same economics |
| 21 | opening balance | JOURNAL rows | **not** routed through the calculator |

## 22. Recommended implementation sequence

**P0-3A — the calculator.** One pure server module in integer paise, with the
golden matrix. Not wired to anything. No behaviour change, no risk.

**P0-3B — the validation boundary.** `POST /invoices` computes canonically,
compares the client's derived totals, rejects material mismatch with 422, and
**persists the server's values**. Extend to `PATCH` for unposted invoices.

**P0-3C — posting hardening.** `invoicePostingLines` reads the persisted row,
takes `roundOff` explicitly, and asserts rather than plugs. Migrate
`imports.ts` onto the calculator, removing the second engine.

Then, separately: notes and bills (§18), and the client dropping derived totals
(contract C).

## 23. Unresolved product decisions

1. **Tolerance for P0-3B.** Recommend ±₹0.01 initially — evidence in §12 is
   that real residues are sub-paise — widened only if a real workflow breaks.
2. **Per-line or per-document CGST/SGST split** (§6). The two differ by paise.
3. **Invoice-discount apportionment**: keep rate-scaling, or distribute paise
   with largest-remainder (§7). Only the second satisfies INV-C1.
4. **Other charges**: fold into `subtotal`, or give them their own ledger
   account (§11). Both fix the leak; they post differently.
5. **Reject ambiguous supply type?** (§9.) Recommend yes.
6. **Does a nearest-rupee round-off feature exist or get added?** If not,
   `roundOffPaise` is always 0 and `ROUNDING` should approach silence.
7. **Trusted import mode** (§17) — needed or not, and if so, under which
   permission.

## 24. New defects found during this pass — not fixed

- **POS sales never credit AR** (§16). Receivable overstated and cash
  understated by every POS sale; invoice sits `Paid` with `paidAmount 0`.
  P0-class, separate from P0-3.
- **Other charges post to `ROUNDING`** (§11). Real revenue recorded as a
  rounding difference.
- **Unknown supply type silently becomes IGST** (§9).
- **Two divergent calculators** (§1, §3), both feeding the same ledger.
