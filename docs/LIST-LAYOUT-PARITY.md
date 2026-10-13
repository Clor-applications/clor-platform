# The document list layout, applied to the sales siblings

_10 Sep 2026_

Sales Invoices sets what a list of documents looks like in this product. Its
five siblings had each grown their own screen, so moving between them meant
learning the page again.

## The layout, in order

1. **`PageHeader`** — title, one-line description, and on the right: search,
   any page-specific control, **More**, then one primary button.
2. **`StatCards`** — five figures, each answering a different question about
   the same book.
3. **Status tabs** — `ui-segmented` pills, each tinted with its own status
   colour, each carrying its count. `All` first, always selected on arrival.
4. **One card** holding the table: `ui-table ui-table-wide ui-table-sticky`,
   `ColumnHeader` per filterable column, `ui-rows` body, empty state inside the
   table rather than instead of it, totals bar at the foot.
5. **One tip** under the card, dismissed for good.

`src/components/list/DocumentListShell.jsx` carries 1, 2, 3 and the card. The
columns, the row and what a status means stay with each document — forcing a
challan through an invoice template is how a list ends up with a Balance column
that is always blank.

## What each page now says

| Page | Figures | Status tabs |
|---|---|---|
| Quotations | count · quoted · open · converted · expired | Draft · Sent · Accepted · Converted · Expired |
| Sales Orders | count · order value · to deliver · delivered-to-bill · billed | Open · Partly done · Delivered · Billed |
| Delivery Challans | count · goods out · out-not-billed · invoiced · job work | Out, not billed · Invoiced |
| Sales Returns | count · credited · against invoices · on account · draft | Draft · Issued · On account · Settled |
| Recurring | count · active · billing per month · due this month · paused | Active · Paused · Finished |

Receipts were already on this layout and were left alone.

## Derived, not stored

Three of the five filter on a status the row does not carry:

- a **quotation** expires when its validity date passes, whatever was typed;
- a **sales order** is Delivered or Billed according to the challans and
  invoices raised against it;
- a **credit note** on account is Settled once nothing is left to knock off.

A list that showed the stored word would say a lapsed quote is still Sent.

## Mistakes made

- The credit note tab said **Issued** and the row pill said **Unpaid** — the
  status registry aliases `issued` onto the Unpaid entry. The derived value is
  `Open` now, which is what the registry renders.
- The Sales Orders empty state read "Pick a customer, add lines…", which
  collided with the form's own **+ Add line** button — one test could no longer
  tell the two apart, and neither could a screen reader.
- Recurring's monthly figures normalise by frequency. Adding a yearly AMC to a
  monthly rent at face value says nothing.

`src/features/sales/listLayoutParity.test.jsx` holds all five to the contract:
heading, header search, five figures, tabs with counts, More, exactly one
primary, and no card inside a card.

## CRM — Customers, Vendors, Salesmen, Payment Reminders

Same shell, same order. Two of these carried a defect the layout work exposed:

**Customers and Vendors showed a balance nobody maintained.** Both listed a
stored `balance` field that nothing ever wrote to, so every row read ₹0.00
while the invoice list showed lakhs outstanding against the same names. What a
party owes is now computed from the documents — `src/utils/partyStanding.js`,
shared by both sides because the arithmetic is identical and writing it twice
is how two screens end up disagreeing about what "overdue" means. Cancelled and
draft documents are left out; the part past its due date is counted separately,
because that is the figure somebody rings about.

| Page | Figures | Tabs |
|---|---|---|
| Customers | count · owing you · outstanding · overdue · GST registered | Owing · Overdue · GST registered · Unregistered |
| Vendors | count · you owe · payable · overdue · GST registered | You owe · Overdue · GST registered · Unregistered |
| Salesmen | team · selling · invoices · sales (pre-GST) · commission due | Selling · No sales yet · Commission due |
| Payment Reminders | open invoices · outstanding · due now · 15+ days · to chase today | Send now · Due · 7+ days · 15+ days |

Payment Reminders has no primary action — it creates nothing, every invoice
with a balance appears on its own.

`CustomersList` and `VendorsList` moved out of `App.jsx` into
`src/features/crm/`. A screen that cannot be rendered on its own cannot be
tested on its own, and both were 350-line components inside a 14,000-line file.

### Mistakes made

- `isGstRegistered` first matched `/registered/i`, which is a substring of
  **Unregistered** — every unregistered party counted as registered.
- The Salesmen header's primary called `add()` with the form empty, so it only
  ever produced "name is required". It focuses the name field instead.
- The first version of the customer-balance test asserted `11,800` appeared in
  the row — which it did, from the *overdue* column, so replacing the computed
  figure with the old stored one still passed. The fixture now has one invoice
  due and one not, and the two columns are asserted separately.

`src/features/crm/crmLayoutParity.test.jsx` holds these four to the contract and
to the money.

## Purchases

Bills, Purchase Orders, Purchase Returns and the two transaction lists
(Receipts, Payments) now use the shell. Bills was closest already — it had the
figures and tabs — but wore the older grey pills, a Filters popover that
duplicated the column filters, and an Export button beside the tabs instead of
in More.

| Page | Figures | Tabs |
|---|---|---|
| Purchase Invoices | count · billed · paid · unpaid · overdue | Draft · Received · Partially paid · Paid · Overdue · Cancelled |
| Purchase Orders | count · ordered · awaiting the goods · billed · cancelled | Awaiting the goods · Billed · Cancelled |
| Purchase Returns | count · returned · against bills · on account · draft | Draft · Issued · On account · Settled |
| Receipts / Payments | count · value · this month · against documents · on account | Against documents · On account |

A purchase order's status is derived, like a sales order's: it closes when a
bill names it, either by `sourcePurchaseOrderId` or by quoting its number as
the reference.

## Purchase Overview

It shipped as a placeholder — "statistics will appear here" — beside a Sales
overview with six figures, two charts and the recent documents of each kind.
Someone who had learnt to read one module could not read the other.

The furniture moved to `src/features/overview/OverviewParts.jsx` (period model
with its previous-period comparison, the tinted figure card, panels, the empty
panel, segmented control) and both pages use it. The figures stay separate: a
bill is a liability and an invoice is not, so Sales asks what came in and how
much has been collected, Purchases asks what went out and how much has been
paid.

### Mistakes made

- `SeriesBars` read fixed field names (`invoiced` / `received` / `outstanding`),
  so the purchase chart handed it `billed` / `paid` / `payable` and drew three
  empty series on an axis running to ₹1 — a chart that looks broken rather than
  one saying nothing was bought. It takes a `keys` prop now.
- **The donut was invisible on every module overview, including Sales.** The
  pages pass palette entries like `rgb(var(--ov-blue))`; ECharts wrote that
  straight into the SVG `fill`, where a CSS variable means nothing. The centre
  label and the legend rendered, which is what made it read as a layout problem.
  `resolveTokenColor` resolves the token against the document, and the chart
  falls back to a real colour rather than painting nothing.
- The Bills columns were reordered to match the invoice list and the row cells
  were not, so the Date column showed a dash while Ref Date showed the bill's
  date. The parity test now checks every list's row has as many cells as the
  header has columns.

## Cash & Bank, and Expenses

**Cash & Bank** carried four header buttons of equal weight — and the only one
styled as primary, Add Transaction, is disabled until a cash or bank account
exists, so a new company saw a row of grey buttons and nothing to press. The
account picker and the view select sat in a panel of their own between the
header and the rows: a second toolbar for controls that belong with the first.

- The primary follows the state: **New Account** until there is one, **Add
  Transaction** after.
- The account picker moved into the header, beside search — it governs every
  figure and every row below it.
- Download template, Upload statement, Export and New account moved into More.
- The view select became tabs with counts: Uncategorised · Categorised · All.
- Figures: transactions · money in · money out · net movement · to categorise.
- "No transactions." became a real empty state that tells the three cases apart:
  no account yet, no account chosen, nothing left to categorise.

**Expenses** had no search at all — the only way to find a voucher was to
scroll, or to know its date and narrow the period around it. It also had six
plain pill filters with no counts, and a card holding two date inputs and three
export buttons between the tabs and the table.

- Search in the header; Export, Import template and Import behind More.
- Status pills became tabs with counts (over the period and the search, not the
  whole book — a strip of counts describing rows the table is not showing is
  two sets of figures on one screen with nothing saying so).
- Figures: vouchers · spent · paid · unpaid · average voucher.
- The period moved to the top of the table it governs.
- Ref date became a filterable column like the ones beside it; as a plain
  heading it also wore the table's uppercase, so one column read in a different
  case from the rest.

## Inventory

The least consistent group in the product before this: Inventory kept its
figures as a line of small text above the heading and its search at the far
right of a filter row; Stock Adjustments and Batch Stock had no search at all;
the transfers list was a heading with two loose buttons beside it.

| Page | Figures | Tabs |
|---|---|---|
| Inventory | items · stock value · in stock · out of stock · negative | In stock · Out of stock · Negative |
| Stock Adjustments | count · units up · units down · value up · value off | Written up · Written off |
| Reorder Alerts | items · out of stock · suggested qty · cost at last rate · no vendor | Out of stock · At or below level · Vendor known |
| Batch Stock & Expiry | batches · on the shelf · expiring in 30d · expired still held · dated | In stock · Expired · ≤30/60/90 days |
| Warehouse / Branch Transfers | transfers · awaiting approval · units in transit · units received · short lines | Draft · In transit · Received · Short received · Closed |

Stock screens count units, not money — a transfer moves stock between two
places the business already owns, so nothing is bought or sold.

### Mistakes found

- **The transfer table's column headers were shifted by one.** `From` was wired
  to `col="date"`, `To` to `col="from"` and `Date` to `col="to"`, so filtering
  the From column filtered by date and the Date column filtered by destination.
  The labels were in the right order and each filtered its neighbour's data,
  which is why reading the header row could not see it — the test opens the
  From filter and checks the values it offers are places, not dates.
- Reorder Alerts searched `name` and `lastVendorName`, neither of which exists
  on its rows (they are `item.name` and `last.vendorName`), so typing anything
  into the search emptied the table.
- Inventory's four figures sat above the page heading as small text, which is
  neither a heading nor a card; they are the standard five now.

## Journal Entries

A bare heading, one button and a filter band — no figures, and status was a
column you could filter but not see the shape of. On a screen whose whole
subject is whether the books balance, that is the wrong thing to leave out.

- Figures: entries · posted value · lines posted · unbalanced · reversed.
- Tabs: Balanced · Unbalanced · Reversed, with counts.
- A reversed entry is left out of the posted value — it was undone, not
  posted, and counting it would overstate what the books moved by.
- The row still offers **Reverse** for an entry that reached the ledger and
  **Delete** only for one that never left this browser.

Moved out of `App.jsx` into `src/features/accounting/JournalEntriesList.jsx`,
for the same reason Customers and Vendors were: a screen that cannot be
rendered on its own cannot be tested on its own.

## Masters — Chart of Accounts, Items, Item Categories, Price Lists

| Page | Figures | Tabs |
|---|---|---|
| Chart of Accounts | ledgers · groups · debit balances · credit balances · in suspense | Ledgers · Groups |
| Items | items · goods · services · without HSN/SAC · without a price | Goods · Services · No HSN/SAC · No sale price |
| Item Categories | categories · in use · unused · items categorised · typed but not listed | — |
| Price Lists | lists · active · rates set · pricing nothing · expired | Active · Inactive · Expired |

Each of those fifth figures is the one the screen exists to surface:

- **In suspense** — money posted against no real account is money nobody has
  explained yet.
- **Without HSN/SAC** — an item missing one can still be sold, and the GST
  return carrying it is the one that comes back.
- **Typed but not listed** — a category typed straight onto an item is not in
  the master, so a discount rule matching on category will never see it.
- **Pricing nothing** — a price list with no rates on it was named and never
  filled in; every invoice falls back to the item's own price and says nothing.

Chart of Accounts keeps Ledgers and Groups as its tabs. They are two views of
one chart rather than two statuses, but they are the choice the screen is built
around, so they take the place the status tabs hold everywhere else — and the
counts belong there for the same reason.

Item Categories keeps its two-field add row at the top of the table it adds to.
Price Lists had the tabs and search already; what it lacked was the figures,
and its export was a lone download icon parked beside the tabs where no other
list keeps one.

## Companies

Not a table, so it takes the shell's header and figures and keeps its own rows:
`DocumentListShell` grew a `surface="plain"` for exactly this — a page whose
rows are cards in their own right cannot sit inside another card.

- **Figures:** companies · GST registered · not registered · billed by the
  group · owed to the group. A page listing companies is opened to answer a
  question about the group, not about any one of them.
- **Search** matches name, GSTIN and state, and keeps a parent whose subsidiary
  matches — dropping it would leave the child indented under nothing.
- The row's figures sit in fixed-width right-aligned columns, so four companies
  read down as well as across. They used to move with the length of the name.
- A company with no GSTIN says **"No GSTIN — cannot raise a tax invoice"**
  whether or not its state is known. The old line only mentioned it when the
  state was missing too, so a company with one and not the other read as
  complete.
- The group rollup column is labelled **Group total** and only appears on a
  company that has subsidiaries.

Drafts are out of the group figures, the same rule every other total follows.
