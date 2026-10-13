# Review of the 16 must-have requirements

Reviewed 17 Aug 2026 against the code as it stands, not against memory. Each row
says what exists today, what is actually missing, and what it depends on.

**The single most important finding:** eight of these sixteen need server-side
master data — customers, vendors, items, ledgers, numbering series — that does
not exist yet. Only invoices live on the server. Building those eight against
`localStorage` now means building them twice. They are marked **Blocked** below;
that is a sequencing statement, not a refusal.

Legend: **Done** · **Partial** — some of it works · **Missing** · **Blocked** —
needs server masters first.

---

## Summary

| # | Requirement | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | Create customer from the bill screen when not found | **Partial** | 0.5 d | Button already appears on no-match; needs an always-available option |
| 2 | Invoice number from the created series, not manual | **Partial → Blocked** | 2 d | Generator exists client-side; series *selection* and safe allocation need the server |
| 3 | Warehouse selection | **Done** | — | Present on the invoice form and enforced server-side |
| 4 | Receipts/Payments as a setting; otherwise from bank/cash book | **Missing** | 2 d | Needs a decision from you, see below |
| 5 | Warehouse/Branch toggles in settings; hide when off | **Missing** | 1.5 d | Feature flags per org |
| 6 | Number + date on top, small, focused on entry | **Missing** | 1 d | Pure form layout; highest value per hour of the whole list |
| 7 | Dr/Cr columns in journal entry, enforce Dr = Cr | **Partial** | 1.5 d | Server already rejects unbalanced entries; the UI does not show Dr/Cr columns |
| 8 | Multi-currency | **Done (API)** | — | Dated rates, translated posting, realised gain/loss on settlement and revaluation (`a6e9f9c`, `d4f7528`); UI in Settings → Currencies |
| 9 | Multi-user | **Done** | — | Users, roles, profiles, permissions all shipped |
| 10 | Multi-company | **Partial** | 2 d | Multiple orgs exist server-side; there is no company switcher in the UI |
| 11 | Batch / serial numbers in inventory | **Done (API)** | — | Batch and SerialNumber models, FEFO listing, double-sale refused (`d0ed203`); no UI yet |
| 12 | Due date computed from customer/vendor terms | **Done** | — | Credit period on the party; invoice and bill due dates follow it, recomputed server-side; toggleable as `paymentTerms` |
| 13 | Next SKU row adds *below* the previous one | **Partial** | 0.5 d | "Add Item" exists; the placement and focus behaviour is the complaint |
| 14 | Payment mode from created bank/cash ledgers | **Done** | — | Mode is the org's real CASH/BANK ledgers; receipts and payments post to the GL (`dde9c70`) |
| 15 | Import for invoices, purchases, notes | **Done (API)** | — | Bills, credit and debit notes now exist server-side and import (`c87fb2f`); UI in Settings → Import Data |
| 16 | Import + downloadable template for journals | **Done (API)** | — | Staged validate-then-commit with CSV template (`24ca335`); no UI yet |

Roughly **7–9 weeks** of work in total, of which about three weeks only becomes
sane after the server holds master data.

---

## Item by item

### 1. Customer creation from the bill screen — **Partial**

Already there: `src/components/pickers/CustomerPicker.jsx` shows a **Create new
customer** button when a search returns nothing, and the created customer is
selected automatically.

What you are asking for beyond that is the "extra creation tab" — a create
option that is always visible, not only after a fruitless search. Half a day.

The same pattern needs copying to `VendorPicker` and `ItemPicker`.

### 2. Invoice number from the series — **Partial, then Blocked**

`generateVoucherNumber()` already builds a number from the series, per branch,
and `lockInvoiceNumberOnCreate` stops manual editing when the series forbids it.

Two real problems:

- There is **no series picker**. If you configured three series you cannot
  choose between them on the document.
- Numbers are minted **in the browser**. Two tabs, or two users, produce the
  same number; the only thing preventing a duplicate is a database unique index
  that throws an error after the fact. That is why a changed series does not
  reliably take effect.

The fix is the `NumberSeries` table already designed in
`COMPETITORS-CUSTOMIZATION-MIGRATION.md` §2.2, allocating inside the document's
transaction. **Server work.**

### 3. Warehouse selection — **Done**

The invoice form has a required Warehouse field, warehouses are server-side, and
per-user warehouse access is enforced. One caveat worth fixing: a brand-new org
has no warehouses, so the first invoice is impossible until you create one. That
belongs with the onboarding wizard.

### 4. Receipts and payments as a setting — **Missing, and I need a decision**

I have read this one several times and want to check my understanding before
building it, because two readings give different products:

- **Reading A:** a setting decides *where* receipts and payments are entered —
  either standalone Receipt/Payment screens, or only as entries inside the bank
  and cash books.
- **Reading B:** the standalone screens always exist, and the setting only
  controls whether reconciliation fields appear on them.

Your note "if bank/cash reco not doing, options should be enabled" reads like A,
where the standalone screens are the fallback for shops that never reconcile.
Two days either way; I would rather build the right one.

### 5. Warehouse and branch toggles — **Missing**

A per-org setting: *use branches yes/no*, *use warehouses yes/no*. When off, the
fields disappear from invoicing and inventory instead of being required.

Worth building carefully: for a single-shop customer, hiding branch and warehouse
entirely is the difference between a product that feels made for them and one
that feels like enterprise software with fields they must ignore. 1.5 days,
stored in the `OrgSetting` table already designed.

### 6. Number and date on top, small, focused — **Missing**

Every entry screen puts document number and date first, in a compact strip, with
focus landing on the first data field so a Tally operator can type straight into
it without reaching for the mouse.

**This is the highest value per hour on the whole list.** It touches every entry
form and costs about a day. Do it first.

### 7. Dr/Cr in journal entry with Dr = Cr — **Partial**

The server side is already correct: `postEntry()` sums in integer paise and
rejects any entry whose debits and credits differ, so an unbalanced journal
cannot be stored. There is a passing test for it.

The UI is what is missing: `JournalEntryForm` needs proper Dr and Cr columns, a
running total per column, and a live difference indicator that blocks Save while
it is non-zero. 1.5 days.

### 8. Multi-currency — **Missing, and the largest item here**

`getCurrencyCode()` ignores its argument and returns `'INR'`. Doing this
properly means: currency on the party and the document, an exchange-rate table
with rates by date, base-currency amounts stored alongside document amounts on
every journal line, realised gain/loss on settlement, and unrealised
revaluation at period end.

8–12 days, and it should come **after** the ledger holds all voucher types.
Retrofitting currency into a ledger is far more expensive than building the
remaining vouchers with the columns already present.

If you have no foreign-currency customers today, say so and I will park it —
it is the one item on this list I would push back on for now.

### 9. Multi-user — **Done**

Users, roles, role profiles, field-level permissions, approval thresholds and
document restrictions all shipped. 32 passing tests.

### 10. Multi-company — **Partial**

The server models `Account → Org → Branch` and every query is scoped by it. What
is missing is purely the UI: `activeOrgId` is written once at signup and never
changed, so there is no company switcher in the header and no way to create a
second company after onboarding. About two days.

### 11. Batch and serial numbers — **Blocked**

Needs the server-side item and stock model first. Once there: a per-item flag
(none / batch / serial), batch records with manufacture and expiry dates, serial
records with status, selection at both issue and receipt, and expiry-aware
picking (FEFO) for anything perishable.

6–8 days after the inventory model lands. Note this also decides your market:
pharma and food distribution will not buy without batch and expiry.

### 12. Due date from party terms — **Blocked**

Straightforward once parties are server-side: `paymentTermDays` on the customer
and vendor, and the document computes `dueDate = date + terms` on the server so
it cannot be bypassed by editing the form. Two days.

Worth adding named terms (Net 30, 50% advance) rather than a bare day count.

### 13. SKU rows add below — **Partial**

`addItem()` exists and appends to the array. The complaint is the interaction:
the add control sits above the grid, and after adding a row focus does not land
in it. Fix: move the control below the last row, focus the new row's item field,
and let <kbd>Tab</kbd> from the last cell create the next row — which is how
Tally behaves and what your operators expect. Half a day, pairs naturally
with item 6.

### 14. Payment mode from bank/cash ledgers — **Blocked**

Today the Mode dropdown is a hardcoded list (`Cash`, `Bank`, `UPI`, `Card`,
`Other`) and does not correspond to any ledger, which means a receipt cannot
know which bank account it hit. It should list the actual ledger accounts whose
`controlKind` is `CASH` or `BANK` — those already exist in the chart of accounts
the ledger seeds. 1.5 days once payments post to the ledger.

### 15. Import for invoices, purchases and notes — **Blocked**

This is the migration engine from `COMPETITORS-CUSTOMIZATION-MIGRATION.md` §3,
pointed at ongoing operations rather than a one-time cutover: upload, map
columns, dry-run with per-row errors, then commit. Build it once and both jobs
are served. 5–7 days.

### 16. Import and template for journal entries — **Blocked**

Same engine plus a downloadable template. Journals need one extra rule the other
imports do not: each imported entry must balance, and the dry run should report
the imbalance per entry rather than failing the whole file. 2 days on top of 15.

---

## Recommended order

**Now — three days, no server dependency, felt immediately by every user**

1. Item 6 — number and date on top, compact, focused
2. Item 13 — SKU rows add below, with Tab-to-new-row
3. Item 1 — always-available create in customer, vendor and item pickers
4. Item 7 — Dr/Cr columns with a live difference indicator

**Next — one week, unblocks eight other items**

5. Server-side masters: customers, vendors, items, ledgers *(this is Phase 1 of
   the existing roadmap; nothing else on this list is sane until it lands)*
6. Item 2 — numbering series, allocated server-side
7. Item 12 — due dates from party terms
8. Item 14 — payment mode from real ledgers

**Then — two weeks**

9. Item 5 — branch/warehouse feature toggles
10. Item 10 — company switcher
11. Items 15 and 16 — the import engine and templates

**Later, deliberately**

12. Item 11 — batch and serial *(decides whether you can sell to pharma)*
13. Item 8 — multi-currency *(only when you have a customer who needs it)*

**Blocked on you:** item 4 — which of the two readings is right.
