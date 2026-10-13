# POS tender → ledger account

**Audit / design pass only. No code changed.**
`origin/main = d024b6d` · follows `POS_ACCOUNTING_INTEGRITY_DESIGN.md`

POS knows `'Cash' | 'UPI' | 'Card'` — a label. Creating a payment requires a
validated `ledgerAccountId`. Nothing bridges the two, which is why POS cannot
raise an authoritative receipt without inventing an account.

---

## 1. Existing configuration capabilities

| Entity | Shape | Suitable for this mapping? |
| --- | --- | --- |
| **`OrgMaster`** | `(kind, name, dataJson)`, `@@unique([accountId, orgId, kind, name])`; `kind` is a **whitelist** — UOM, ITEM_CATEGORY, PRICE_LIST, DISCOUNT_RULE, COST_CENTER, ACCOUNT_GROUP, GST_RATE, TDS_* | **Yes, with a new kind.** Purpose-built for exactly this: small reference data, server-owned identity, client-owned payload shape |
| **`Org.profileJson`** | free-form JSON, updated through `profile: z.record(z.any())` — the route's own comment says it is "unvalidated beyond its shape because nothing branches on it — it is read back onto one screen" | **No.** Putting an accounting-critical account id behind an unvalidated blob turns a display field into one that decides where money lands |
| **`Branch`** | typed columns only — **no settings JSON**. Carries `shareHeadOfficeSettings Boolean` | Cannot hold it directly, but establishes the inheritance precedent (§6) |
| **`FeatureSetting`** | on/off capability flags | No — a flag, not a reference |
| **`EInvoiceSetting` / `EmailSetting` / `NotificationSetting`** | one typed row per org per concern | A precedent for a dedicated table, if a typed model is preferred over `OrgMaster` |
| **Settings registry** (`settingsRegistry.js`) | 28 screens across business / finance / organisation / platform / security / tax | **No POS screen exists.** `finance` has 2 entries and is the natural category |

**Recommendation: a new `OrgMaster` kind — `POS_TENDER_ACCOUNT`.** It needs no
migration (the table and the route already exist), it is already synced to the
browser through `listOrgMasters`, and `MASTER_KINDS` is a one-line whitelist
addition. A typed table would also work and buys referential integrity; it
costs a migration.

### A precedent worth not repeating

`src/utils/bankBookSync.js` already resolves a browser account to a server
ledger:

```js
const ledgerAccountId = serverLedgerIdFor(chartRows, entry.cashBankAccountId);
if (!ledgerAccountId) return {};          // ← saves locally, server never hears
```

When the mapping is missing it **silently degrades to a browser-only record** —
the same failure mode as the POS receipt. Whatever POS does must fail loudly
instead.

## 2. Account classifications actually available

`LedgerAccount.accountType` — `ASSET | LIABILITY | EQUITY | INCOME | EXPENSE`.

`controlKind` — 19 values, but **a user may only create `CASH` or `BANK`**:

```ts
const accountCreateSchema = z.object({
  accountType: z.enum(['ASSET','LIABILITY','EQUITY','INCOME','EXPENSE']),
  controlKind: z.enum(['CASH','BANK']).optional().nullable(),
  …});
```

Eligibility for receiving money is decided in one place, `GET /payment-modes`:

```ts
where: { orgId, isActive: true,
         controlKind: { in: ['CASH','BANK'] },
         code: { notIn: SETUP_CASH_BANK_CODES },
         OR: [{ branchId: null }, { branchId }] }
```

Three consequences:

- **The setup accounts are deliberately excluded** — `Cash-in-Hand` (1200) and
  `Bank Accounts` (1300) "stay in the chart and keep taking the postings; they
  are just not choices".
- Accounts are already **branch-aware**: an account belongs to a branch or is
  shared (`branchId: null`).
- **There is no `CARD` or clearing `controlKind`**, and none can be created.

## 3. Cash

```
Dr <configured Cash ledger>   1,180
Cr Accounts Receivable        1,180
```

**Do not use the system `CASH` control account (1200).** `payment-modes`
excludes it on purpose, and posting POS takings into the account that also
absorbs every control posting would make the till unreconcilable. The
configured account must be a till the business actually opened.

**Consequence to accept:** a business that has opened no cash account has **no
valid Cash mode**, and POS must refuse to take cash until one exists. That is
the correct behaviour and a real onboarding step.

## 4. UPI

Nothing in the product models a payment gateway, a settlement batch or a
clearing account. UPI settles to the bank in near real time in practice.

**Smallest correct model: UPI → a configured BANK ledger, received
immediately.** Same posting shape as cash, different account. Do not invent
gateway complexity the product has no data for.

## 5. Card — the decision that cannot be made silently

**Option A — Card → Bank immediately.** Same as UPI. One mapping, no new
concepts. **Wrong in a way that shows up at reconciliation**: card takings
arrive a day or more later, net of merchant fees, so the bank ledger claims
money the statement does not yet show, and the fee never appears at all.

**Option B — Card → a card-receivable/clearing account, cleared on settlement.**

```
Sale        Dr Card Clearing   1,180      Cr AR            1,180
Settlement  Dr Bank            1,156      Dr Fees   24
                                          Cr Card Clearing 1,180
```

Faithful, and it makes the fee visible as an expense.

**B cannot be built today without a schema decision.** A clearing account is
not cash and not a bank account, but `payment-modes` only offers
`CASH | BANK`, and users can only create those two `controlKind`s. B therefore
needs either a new `controlKind` (e.g. `CLEARING`) or a deliberate misuse of
`BANK`, plus a settlement document that does not exist.

**Recommendation: ship A, name it honestly, and record B as owed.** A is
defensible for a small merchant taking a handful of card sales a day; it stops
being defensible at volume. **This is a product decision, not a technical
one** — it is about whether card fees and settlement timing need to be
accounted for now.

## 6. Mapping scope — branch level, inheriting from head office

Organisation-wide mapping would be actively wrong here. Ledger accounts are
already branch-scoped (`OR: [{branchId: null}, {branchId}]`), journal entries
carry `branchId`, and the **hash chain is per branch**. A single org-wide "Cash"
mapping pointing at Branch A's till would post Branch B's counter takings into
Branch A's cash account — and the posting would succeed, because nothing
cross-checks the account's branch against the posting's branch.

The product already models the inheritance: `Branch.shareHeadOfficeSettings`.

**Recommended: mapping keyed by `(branchId, tender)`, with a head-office row
used when a branch has none** — matching `shareHeadOfficeSettings` semantics.
Terminal-level is finer than anything else in the product (there is no terminal
entity) and should wait until a real two-till-in-one-branch case appears.

## 7. Validation at checkout

```
tender selected
   ↓
resolve (branch, tender) → ledgerAccountId       (falling back to head office)
   ↓
missing, inactive, wrong org, or wrong branch?
   ↓
BLOCK THE SALE
```

Never: fall back to an arbitrary account, post to AR and call it settled, write
a browser-only receipt, or mark the invoice Paid.

**API:** the POS checkout endpoint returns **409** with a specific code —
`POS_TENDER_UNMAPPED` — naming the tender. Not 400: the request is
well-formed, the business is not configured.

**UI:** the charge button is disabled for an unmapped tender, with a line
saying which tender is unconfigured and a link to the settings screen.
Ideally POS checks its mapping on load, not at the moment a customer is
standing there.

## 8. Account eligibility — what can actually be validated

From the current schema, at mapping time and again at checkout:

| Rule | Enforceable today |
| --- | --- |
| account exists | yes |
| belongs to this org | yes — `orgId` |
| usable by this branch | yes — `branchId === branch \|\| branchId === null` |
| active | yes — `isActive` |
| is a cash or bank account | yes — `controlKind IN ('CASH','BANK')` |
| is not a setup control account | yes — `code NOT IN SETUP_CASH_BANK_CODES` |
| is an asset | yes — `accountType === 'ASSET'` |

That set makes `Cash → Sales Revenue` (INCOME) and `Card → GST Payable`
(LIABILITY, `controlKind SGST_OUT`) impossible. **Reuse `/payment-modes` as the
single definition of eligibility** rather than re-deriving it — it already
encodes every rule above, and a second copy would drift.

## 9. Idempotency — the primitive is only half there

| Model | `sourceSystem` / `sourceKey` | Unique constraint |
| --- | --- | --- |
| `Invoice` | yes | **`@@unique([orgId, sourceSystem, sourceKey])`** |
| `Payment` | **yes** | **none** — only `@@unique([orgId, number])` |

So the invoice can be made idempotent today; **the payment cannot.** Adding
`@@unique([orgId, sourceSystem, sourceKey])` to `Payment` is a
**migration, and a hard prerequisite** for POS.

### Contract

```
sourceSystem = 'POS'
sourceKey    = <checkout id, generated once per cart>
```

Both the invoice and its receipt carry the **same** key, so one checkout is one
pair, and a retry maps onto the existing rows rather than creating a second
sale. The key must be generated when the cart is first charged and **persisted
with the cart** — not regenerated per attempt — so it survives a refresh.

**The invoice number must not be the key.** It is derived from the browser
book, so two terminals can mint different numbers for the same checkout, and a
retry after a number bump would create a duplicate sale.

`crypto.randomUUID()` is available in every browser this product supports and
is already the right primitive; no library is needed.

Neither create route accepts these fields today — exposing them is part of the
work, and needs care: `sourceSystem`/`sourceKey` currently signal "imported",
and POS would become a second writer of that meaning.

## 10. Target transaction

```
POS checkout ₹1,180 Cash

Invoice   Dr Accounts Receivable   1,180
          Cr Sales                        1,000
          Cr Output CGST                     90
          Cr Output SGST                     90

Receipt   Dr <configured Cash>     1,180
          Cr Accounts Receivable          1,180

Allocation  1,180 → invoice
Settlement  derives paidAmount 1,180 · outstanding 0 · status Paid
```

Final: AR net **0**, Cash **+1,180**, Revenue **+1,000**, GST payable
**+180**, and **no browser state is required for correctness**.

Note POS never sends `status`. Phase 1 produces `Paid` from the allocation —
which is the whole point of not letting the client declare it.

## 11. Failure model — the refactor should come first

**A — compensation.** Invoice posts, receipt fails, unwind the invoice. The
unwind is itself several un-transacted writes (reverse the entry, delete the
row); if *it* fails, the books hold a sale with no money against it and the
operator has been told nothing. The window is small and the consequence is a
wrong set of books discovered by a customer.

**B — thread an optional `tx` through `postEntry`, `reverseEntry`,
`ensureFiscalYear`, `nextEntryNo`, `resolveControlAccountId`.** Additive; no
behaviour change when omitted. Then invoice, sale posting, payment, allocation,
receipt posting and settlement all commit or roll back together.

**Recommendation: B first.** Two independent designs — P0-1 and POS — have now
hit the same wall from different directions, which is the signal that it is a
missing capability rather than an inconvenience. POS is also the worst place to
rely on compensation: it runs at a counter, with a customer waiting, on the
flakiest network in the building.

Caveat worth stating: SQLite serialises writers, so a longer interactive
transaction blocks the API for its duration. At POS volumes this is
microseconds of work; on Postgres (`docs/POSTGRES-CUTOVER.md`) it stops
mattering entirely.

## 12. Cancellation coupling

Cancelling a settled POS invoice must not leave the receipt standing — cash
would remain in the till account against a sale that no longer exists.

Both halves already work independently: `POST /payments/:id/reverse` writes a
contra and (since `0dbd0f3`) re-derives settlement; `PATCH /invoices/:id/status`
→ Cancelled reverses the sale entry. They are simply not coupled.

Two candidate rules:

- **Refuse**, as P0-1 does for settled invoices: "reverse the receipt first".
  Consistent with the rule already shipped, and explicit.
- **Cascade**: cancelling reverses the receipt then the invoice, in one
  transaction — which needs §11 B.

**Recommended: refuse now, cascade once the transaction context exists.** And
note that a cancellation after the customer has left is really a **refund** —
money going back out — not a reversal. Reversal is for a mistake caught
immediately; the product has no refund document, and that gap should be named
rather than papered over with a cancel.

## 13. Minimum configuration UX

Settings → **Finance** → **POS payment accounts** (the `finance` category has
only two entries; POS has none).

```
Cash   [ Cash Till — Main Counter   ▼ ]
UPI    [ HDFC Current A/c           ▼ ]
Card   [ HDFC Current A/c           ▼ ]

Branch: Head Office        ☐ Branches use these accounts
```

Each dropdown is populated from `GET /payment-modes` for the selected branch —
so only eligible accounts can ever be chosen, and the eligibility rules live in
one place. An unmapped tender shows an inline warning that POS cannot take it.

No Settings redesign; one screen in an existing category.

## 14. Implementation prerequisites, in order

1. **Migration — `@@unique([orgId, sourceSystem, sourceKey])` on `Payment`.**
   Hard prerequisite for idempotency (§9).
2. **Transaction context** — optional `tx` through the posting engine (§11 B).
   Recommended before POS, not strictly required.
3. **Storage for the mapping** — a `POS_TENDER_ACCOUNT` kind on `OrgMaster`
   (no migration) or a typed settings table (migration).
4. **Settings screen** (§13), reading `/payment-modes`.
5. **Server accepts `sourceSystem`/`sourceKey`** on invoice and payment create.
6. **Server stops honouring a client-declared settlement status** — POS must
   not send `status: 'Paid'`, and no document may claim a settlement it cannot
   evidence.
7. **POS checkout** creates invoice → receipt → allocation, blocking on an
   unmapped tender.
8. **Cancellation coupling** (§12).

Items 1, 3 and 6 can land independently of POS. Item 6 is a tightening of
Phase 1 that will reject the current POS payload, so it must ship **with** the
POS change, not before it.

## 15. Unresolved product decisions

1. **Card treatment — A or B** (§5). The only decision that changes the data
   model.
2. **`OrgMaster` kind or a typed table** (§1). Migration cost against
   referential integrity.
3. **Branch inheritance semantics** — reuse `shareHeadOfficeSettings`, or give
   the POS mapping its own opt-in?
4. **Transaction refactor before POS?** (§11.) Recommended yes.
5. **Cancel versus refund** (§12). The product has no refund document.
6. **What POS does when unconfigured** — block the tender, or block POS
   entirely until all three are mapped?

---

# Decided and implemented — v1

The unresolved decisions in §15 are settled. This section is the record; the
sections above are the audit that led to it.

## Card — option A

Card maps to a configured **BANK** account and is treated as received
immediately. A clearing account, settlement timing and MDR fees are **future
work**, not approximated here: option B needs a `controlKind` the schema does
not have and a settlement document that does not exist, and a fake clearing
implementation would be worse than an honest simplification.

## Configuration — explicit per branch, no inheritance

**Head office inheritance is deferred**, on evidence rather than preference:

- no authoritative head-office identifier exists in the schema;
- `branchCode = 'HO'` is set once at company setup and is freely editable
  afterwards through `branches.ts` — a convention, not an identity;
- `parentBranchId` is accepted from the request body on create and update and
  defaults to null, so **every** branch created without naming a parent is
  equally rootless;
- production contains an organisation with **two parentless branches**, so the
  obvious rule returns two answers;
- `shareHeadOfficeSettings` is **false on every production branch** — the
  feature has no users to preserve.

Encoding a head office would have meant inventing that identity and making it
load-bearing for money. Every branch names its own accounts instead. Adding
inheritance later needs a real identifier first — an `isHeadOffice` marker with
a one-time reviewed backfill would be the way, and it is a separate decision.

Resolution is therefore two-valued:

```
explicit mapping for (org, branch, tender), still usable  →  DIRECT
otherwise                                                 →  UNCONFIGURED
```

"Still usable" matters: a mapping whose account has since been deactivated,
moved to another branch or had its kind changed reports UNCONFIGURED rather
than a broken account, because a checkout asking "can I take cash?" needs a
usable answer rather than a stale one.

Choosing an organisation-shared (`branchId: null`) account is allowed and is
**not** inheritance — it is this branch selecting a shared ledger. Every ledger
account in production is shared today, so a rule demanding an exact branch match
would have rejected all of them.

## Storage

`PosTenderAccount` — typed, `@@unique([orgId, branchId, tender])`, with a real
relation to `LedgerAccount`. Not `Org.profileJson` (unvalidated, and the route
comment says nothing branches on it), not `OrgMaster` (a whitelist of
browser-shaped payloads, chosen only to dodge a migration).

Removal is the absence of a row. There is no sentinel account id meaning
"none".

## Eligibility

One definition, in `services/receiptAccounts.ts`, now read by both
`/payment-modes` and POS configuration. It is the rule `/payment-modes` always
applied — same org, active, CASH or BANK, not a setup control account, and
belonging to this branch or to none — plus tender compatibility: cash into a
cash account, UPI and card into a bank account.

Two copies of a rule about where money may land would drift, and only one of
them would get corrected.

