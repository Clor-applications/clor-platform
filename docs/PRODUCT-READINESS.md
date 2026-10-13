# Getting to one finished product

Seven items, worst first. Each is its own commit, verified before the next
starts — the same way the six document forms were done.

| # | Item | Why it is on the list | State |
|---|---|---|---|
| 1 | Six masters reach the server | Clear the browser and they are gone | **done** |
| 2 | CSV formula injection | An export runs code on the accountant's machine | **done** |
| 3 | Audit trail can be read | Written in 7 places, readable in none | **done** |
| 4 | Bank reconciliation | The largest genuinely missing module | **done** |
| 5 | Record Receipt as a screen | Rows 49/52 of the original validation sheet | **done** |
| 6 | Per-user module assignment | Waiting on one decision | **done** |
| 7 | The deferred shells, built for real | Admin area, dashboard, billing, SSO, subdomains | **done** |

## 1 — Six masters that live only in the browser

`units` · `item categories` · `price lists` · `discount rules` · `cost centres` ·
`account groups`

Every other collection — invoices, bills, parties, items, challans, salesmen,
fixed assets — writes through to the server. These six never did. Clearing
browser data loses them, a second user never sees them, and a second device
starts empty.

Not cosmetic: a **price list decides what rate lands on an invoice**, and cost
centres are reported on. A book whose prices live in one person's browser is a
book nobody else can raise an invoice from.

## 2 — CSV formula injection

There is no guard on any export. A party named `=cmd|'/c calc'!A1` is a formula
when the file is opened in Excel, and the export is a file this product hands to
an accountant to open on their own machine. The fix is a prefix on any cell
starting with `= + - @`, tab or carriage return.

## 3 — The audit trail nobody can read

Seven server-side write sites, no read route, no screen. It also records only
UPDATE and DELETE — a row appearing out of nowhere is exactly what an auditor
asks about, and CREATE is not recorded.

## 4 — Bank reconciliation

Cash & Bank exists. GSTR-2B reconciliation exists. Reconciling a bank statement
against the book does not, and it is the first thing an accountant asks for.

## 5 — Record Receipt

Still a modal. The original validation sheet asked for a screen, and for the
list to navigate to the receipt rather than open a dialog over it.

## 6 — Per-user module assignment

One decision, still open: do roles carry modules, or do users? Roles is the
recommendation — a CA firm assigns "Intern" once rather than ticking modules per
person — but it is not mine to decide.

## 7 — The deferred shells, built properly

Billing, the account-level admin area, a multi-company dashboard, SSO and
subdomain routing were all deferred. Building the pages now against mock data,
and wiring the real thing later, is a good trade — but with two rules.

**Nothing may look wired when it is not.** Every unconnected page states it, in
the page, where a person demoing the product cannot miss it. A screen that looks
live and is not gets shown to a customer as if it were.

**SSO gets a settings page, never a working-looking login.** A sign-in button
that does not sign anyone in is security theatre, and it is the one place a
mock is genuinely unsafe.

Two of the five need no mock at all. The account, its companies and its users
are real and already on the server, so the admin area and the multi-company
dashboard can be built against live data from the first commit. Billing is the
one that needs invented numbers, because the plans do not exist yet — and the
pricing itself stays deferred, as asked.

## 1 — done

One `OrgMaster` table rather than six. These are small lists that are always
read whole — pricing an invoice reads an entire price list, never one row of it
— so what varies per kind lives in a JSON payload and the columns are only what
every kind shares: account, org, kind, name, active.

Write-through alone would have fixed half of it. The reason the browser was the
problem is that a second device started empty, so the six are hydrated on
sign-in through the same pull the documents already used, matched by server id
first and then by name so a list the browser already has never arrives twice.

Two comments in the codebase said cost centres, discount rules and price lists
could stay in the browser because "nothing reports on them". Both were wrong on
the facts and both are corrected: Cost Centers **is** a report — P&L by branch
or project — and a price list decides what rate lands on an invoice.

Isolation is tested three ways, because the first two passed while the third was
broken: across accounts, across two companies **inside one account** (the CA firm
case), and on the routes that change a row rather than only the one that lists
them. That last pair is the worse half — one company editing another's price
list changes what the other invoices at — and it took a surviving mutation to
notice the test was missing.

## 2 — done

Not one export but seven. Two shared utilities and five hand-rolled inside
feature screens: inventory, the trial balance drill-down, the TDS/TCS report,
GSTR-2B reconciliation, the sales overview and the cash-book upload template.
Fixing only the shared ones would have left six exports still running whatever
somebody typed into a name field.

Quoting was already there and is not the fix: `"=cmd|..."` becomes the cell
value `=cmd|...` the moment the spreadsheet strips the quotes.

The one nuance worth stating: **a number is left alone.** `-500` is a credit, not
an injection, and prefixing it would turn every negative figure in the book into
text that will not sum — a worse bug than the one being fixed. The guard applies
only where the value is not a number to begin with, which still catches `+91
98765 43210` and every formula payload.

A test walks the source and fails if any file that writes a CSV does not use the
guard, so the eighth export cannot quietly arrive without it.

## 3 — done

A read route, a screen under Users & Access, and the entry that was never
written: **CREATE**. The trail carried edits, status changes and deletions, so a
document appearing out of nowhere — the first thing an auditor asks about — had
no record at all.

Three things the screen does that a plain list would not:

- **The per-field diff is shown, not the word "edited".** `total 1,180 → 118` is
  an audit entry; "Invoice edited" is a row in a table.
- **Grouped by day, newest first, paged by cursor.** The trail only grows, and a
  count query over it would get slower every month.
- **`to` covers the whole closing day.** Filtering to today with a midnight
  bound returns nothing that happened today, which reads as a missing entry
  rather than a filter — the classic version of this bug.

**Read-only is the feature, not an omission.** There is no route that writes,
changes or deletes an entry, and a test asserts that POST, PATCH and DELETE all
404. A trail its own product can rewrite is evidence of nothing.

Isolation caught the same gap as item 1, in the same way: the cross-account test
passed while a query scoped by account alone leaked one company's trail to
another company in the same account. On an audit trail that is the worse leak —
it is a list of everything a client has ever changed, and the CA firm case puts
two clients side by side. The facets endpoint had it too.

## 4 — done

The screen an accountant signs: balance per the books, less what the bank has
not seen, plus what the books have not recorded, against the balance per the
statement — and the difference, stated rather than rounded away.

What was already there was an **import**, and it was the wrong operation. It
turned statement rows into new transactions, warned that some looked like
duplicates, and imported them anyway. On a book that already records its
receipts and payments — which is the point of the product — that doubles the
money. The import is untouched; reconciliation sits beside it and creates
nothing.

The matching rules are in `utils/bankReco.js` with the reasoning in the file.
The one that matters most is **one to one**: without it a single payment quietly
reconciles three statement lines, the difference still comes to zero, and two of
the three are money nobody ever recorded.

Rejecting a suggested match puts **both** of its sides back among the leftovers.
Dropping them instead leaves the difference wrong while the screen still claims
the account reconciles, which is worse than not offering the match at all.

The statement parser moved out of the cash-book screen so importing and
reconciling read the same file the same way. Two parsers for one format is two
sets of rules about what a date looks like, and the reconciler would have
disagreed with the importer about the very rows it was meant to match.

## 5 — done, and smaller than it looked

Row 52 — Record Receipt as a screen rather than a dialog — turned out to be
already done: the Receipts screen renders the form inline with its own Back
button. Only **row 49** was outstanding, and it was the one that mattered: the
invoice list still opened the same form in a dialog over itself.

A receipt is a document with a number that posts to the ledger, not a detail of
the invoice it happens to settle. As a dialog it had no address of its own, the
browser's Back button dismissed the list behind it, and there was nowhere to
return to once the money was recorded. It now navigates to Receipts with the
invoice carried across, ticked and allocated — without that the money lands on
account and the invoice it paid stays open.

The dialog stays as the fallback where the list is rendered without a host that
can navigate, so no entry point is lost. Both paths are tested, and removing
either one fails a test.

## 6 — done, and the question answered

The open decision was whether **roles** carry modules or **users** do. The answer
turned out to be already built and already right: a role carries permissions per
module (`Permission { module, subModule, action }`), the sidebar hides what a
role cannot VIEW, and modules themselves are switched on per company. Nothing
needed inventing, and adding a second per-user layer on top would have given two
places to look when somebody cannot see a screen.

What was genuinely missing was the case that prompted the question in the first
place — **a CA firm assigning several companies to one person.** Access was
granted a company at a time: switch to that company, invite the same email
again, pick a role. It worked, and it made "what can this person see?" a
question you could only answer by visiting every company and looking. Ten
clients on an intern meant ten trips and no way to check the result.

There is now one dialog listing every company in the account with a tick each.

Two things it does deliberately:

- **The list is the complete set.** A company left unticked is access taken
  away, so the dialog states what is true rather than only adding.
- **Removing access removes the role with it.** A role assignment left behind on
  a company the person can no longer open is a permission waiting to come back
  the moment anybody re-adds them — silently, at whatever level they had before.

The security test is asked of the database rather than of the listing. The
listing is scoped by account, so a membership wrongly created against another
account's company would be invisible there while being perfectly real — a row
that lets somebody walk into a company nobody invited them to. The first version
of that test passed against the broken code for exactly that reason.

## 7 — done

Five things were deferred. Three of them needed no mock at all, which is worth
saying because the plan assumed otherwise: **the account, its companies and its
people are already real and on the server**, so the admin area and the
multi-company dashboard are one screen built entirely from live data — every
company with its people, invoices, billed and outstanding, summed across the
account, against the plan's limits.

The limits are drawn as a bar rather than "8 of 10", because a number is read
and a bar is felt. Running out of seats should be visible before somebody is
refused, not at the moment they are.

**Billing** is the only page with invented figures. The plan and the usage on it
are real and read from the server; the money, the card and the receipts are
sample rows, because there is no payment provider and pricing is still yours to
set.

**SSO** carries no sign-in control at all — no button, no field, no form. Of
everything that can be mocked, an authentication control is the one that is
genuinely unsafe: a button that appears to sign somebody in and does not is
telling them something untrue about who can reach their books. The page says
what setting it up will ask for and stops there.

**Company subdomains** show the real handle each company already has, with the
routing named as the deployment step it is.

The rule from the top of this file — *nothing may look wired when it is not* —
is enforced by `src/test/preview-pages-say-so.test.js` rather than remembered:
any page with sample data must render the banner, that banner must say the data
is sample, and the SSO page must contain no interactive control. Removing any of
those fails a test.

## Two things found on the way

The bank reconciliation screen is now gated behind the `bankReconciliation`
feature key, which was already in the plan catalogue and already sold on Growth
and above. It was shipped ungated in item 4.

Editing an invoice cannot set `paidAmount`, and should not — the field-level
permission filter strips it, because money is recorded by a receipt rather than
by typing a number onto the document it settles. Found while writing a fixture,
confirmed as deliberate, and recorded in the test that hit it so the next person
does not spend the same twenty minutes.

## The cash and bank book, last of the browser-only collections

Money moving through a bank account was recorded in the browser and nowhere
else. Clearing site data lost the cash book, and the reconciliation screen —
which reads these for the book side — could match a statement line against one
and then have nothing to mark, which it said on screen rather than quietly tying
off half of what was in front of it.

`BankBookEntry` is deliberately not `Payment`. A payment is a voucher against a
party with allocations behind it; these are the account's own movements — a bank
charge, interest, a transfer between two of your own accounts — which have no
party and settle nothing. Forcing them into one table would have meant a Payment
with no payer.

The amount is stored as a magnitude and the direction carries the sign. A
negative amount with direction OUT means money coming in, said twice and
contradicting itself, and the reconciliation adds these up.

A line can only be written through once its account has a
`serverLedgerAccountId` — the browser's chart ids are its own and mean nothing on
the server. Until then the line stays local and says so, rather than being posted
against whatever id happened to be passed.

With this the reconciliation ties off both sides of its list.

### A mistake worth recording

`prisma db push --force-reset` was run against the local dev database, and it
emptied it. The push before it had already created the table, so the reset
achieved nothing. Production is a separate machine and was not touched, and the
test database is a separate file, so the loss was local development data only.
The lesson is the obvious one: `--force-reset` is not a retry.

## Audit response — 10 September 2026

Two audits arrived. The August one is stale: it predates three weeks of work and
its headline items (no CI, GSTR-1 HSN summary missing, no audit-trail reader)
are done. The September one is current and supersedes it. Worked from that.

### Verified before acting

| Finding | Verdict |
|---|---|
| **P0-1** invited users cannot discover foreign companies | **Real** — fixed |
| **P0-2** browser is a second accounting database | Real — narrowed again, not closed |
| **P0-3** no migration history | Real — next |
| **P0-4** backend test gate red | **Does not reproduce** |
| **P1-1** dependency advisories | **Real** — fixed |
| **P1-4** no server scheduler for recurring | **Real** — fixed |

**P0-4 does not reproduce.** The report says the server suite cannot bootstrap
because `globalSetup` builds an absolute `file:` URL containing the workspace
space. Running exactly what they ran — `npm --prefix server test`, same machine,
same path with the space — gives 38 files and 353 tests passing. The
space-in-URL diagnosis does not hold here; something was environmental on their
side, and it should be re-run before it drives a release sequence.

### P0-1 was the one worth having

Login and `/auth/me` filtered memberships by the signed-in user's own accountId,
while an invited membership carries the *inviting* account's. So an invited
person was authorised to work in the company and could never see it — the CA-firm
workflow the whole strategy rests on.

The existing tests in `globalIdentity.test.ts` proved a known foreign orgId could
be **used**. They said nothing about whether it could be **found**, which is
exactly how this survived them. That is the lesson worth keeping: a test that
starts from an id you already have cannot test discovery.

### Recurring invoices are a service now

`RecurringSchedule` holds the schedule, an hourly job in the API raises what is
due, and `RecurringScheduleRun` is unique on (schedule, period). That uniqueness
is the whole guarantee: a job that runs twice, runs late, or races another
instance still bills one invoice per period.

Drafts, still — nothing reaches the ledger until a person saves it, so a
forgotten schedule cannot quietly bill somebody for a year.

The draft's number is a provisional marker keyed to the schedule and period
rather than a series number, because a draft is not an issued invoice and must
not leave a hole in a consecutive series if it is discarded. A test found that
the empty number it used to carry collided on `(orgId, number)` — the marker
fixes the collision and turns that constraint into a second guarantee against
double billing.


## A correction on P0-4

I reported that the backend suite failure "does not reproduce". That was too
strong, and the way I checked was too weak: I ran it once, it passed, and I said
so.

Over roughly fifteen runs since, it has failed three times — `email.test.ts`,
`entitlements.test.ts` and `branchAccess.test.ts`, a different file each time,
always failing to *collect* rather than failing an assertion, and always passing
when run alone or on the next attempt. So the suite is intermittently red at
roughly one run in five.

The audit was right that it fails. Its diagnosis — an absolute `file:` URL
containing the space in "WEB new" — is still not what I observe, because the
failure moves between files and clears on a retry, which a malformed connection
string would not. The cause is more likely a race in test bootstrap.

Recording it rather than fixing it here: it is a real defect, it is not what the
audit says it is, and finding out what it actually is deserves its own attention
rather than being tacked onto an unrelated change.

## P1-5 was mostly wrong, and the checking was worse

The audit says invoices, payments, parties, items and ledger entries use
unbounded `findMany`. Four of those five already had ceilings. My own first scan
agreed with the audit — because it only read the first 420 characters of each
call and the `take` was further down.

One real finding: the audit trail's filter dropdown used `findMany` with
`distinct`, which on a table that only grows is a read of all of it. That is a
`groupBy` now, answered by the database.

`listsAreBounded.test.ts` guards it, scoped to the models that grow with trading
rather than every `findMany` in the routes — a first version flagged sixty,
nearly all reference reads, and a rule that fires that often is one people wave
through.

Writing that test took four attempts, each passing while the code was broken:

1. It matched `id:` anywhere in the call, so a `select: { id: true }` exempted
   the query.
2. It sliced from the word `where` to the end of the call, so
   `orderBy: [{ id: 'asc' }]` exempted it.
3. It treated `ledgerAccountId` as a bounding record id. One account's journal
   lines are every transaction it has ever carried.
4. Only then did removing a real ceiling actually fail it.

Each attempt was found by breaking the code and watching the test pass anyway.
A guard that has not been shown to fail is not a guard.

## P0-2 — journal entries reach the ledger (10 Sep 2026)

A manual journal raised in the app was written to the browser and nowhere
else, although `POST /orgs/:orgId/ledger/entries` had existed since the ledger
was built. That is worse than losing a document: a journal is a ledger
posting, so the trial balance, the P&L and the balance sheet differed by
machine, and the server's own books were missing entries somebody had made
deliberately.

- `src/utils/journalSync.js` posts the entry, mapping each line's local chart
  id to its `serverLedgerAccountId`. An entry with **any** unmapped line is not
  posted at all — half a journal would unbalance the ledger it was meant to
  correct.
- The line note is sent as `description`. The server's schema calls it that;
  under any other key zod strips it and the note is lost without a word.
- `useServerDocSync` hydrates journals back, filtered to `sourceDocType:
  MANUAL`. Every other ledger entry was posted by a document that hydrates in
  its own right, so listing those too would show one transaction twice.
- The list route now selects `ledgerAccountId` on each line — the hydration
  reads it, and it was not being sent.
- Delete became **Reverse** for a posted entry, and an edit reverses then
  reposts. A posting is never erased or rewritten in place; erasing the row
  here while the server kept the posting is the same divergence again. If the
  reversal is refused, nothing changes locally either.

Still browser-only after this: `fyLocks`, `gstRates`, `posDayCloses`. None is
ledger data.

### The period lock, same day

A closed year was closed in one browser. The server already refuses to post
into a locked period (`fiscalYear.lockedThrough`) and nothing ever set it, so a
year the accountant had closed stayed open to every other user and every other
machine.

- Closing, partial-closing and reopening now write the lock through
  `POST /ledger/fiscal-years/:name/lock` first, and change nothing locally if
  the server refuses — the screen never shows a year as closed that the server
  would still accept postings into.
- Reopening still has to name a year, so the year comes from the existing
  lock's date, not from the value being written. Passing no name reopened
  nothing.
- Hydration takes the furthest `lockedThrough` across the org's fiscal years
  and replaces the local row, rather than appending beside it.

### The last two browser-only collections (10 Sep 2026)

**GST rates** became a seventh org master (`GST_RATE`). A rate a company added
was known only to the browser that added it, so an invoice raised anywhere else
could not charge it. The kind list is asserted against the real map in
`src/api/masterKinds.test.js` — every other test of the reference lists mocks
that module and supplies its own map, so a missing collection passed all of
them while `saveMaster` returned early and quietly.

**POS day closes** got their own table, route and screen. The over/short figure
is a cash control: the cashier cannot be the only person holding it, and on any
other machine the day looked never closed. One row per branch per day, enforced
by the database — a second close of the same day is answered with the one that
stands rather than an error, because the cashier pressed the button twice.
The counts are now listed back on the POS screen (a control nobody can read is
a number typed into a form) and are carried in the tenant data export.

With this, nothing that belongs on the server is written only to the browser.

## Two defects behind "why set the company up twice?" (10 Sep 2026)

**Backup did not appear in Settings.** The nav entry is gated on
`SETTINGS::Company data::VIEW`. That permission is seeded into the Owner role
when an org is created — so every org created *before* the permission was added
to the catalogue never received it. Four of six live orgs were short 92 grants
between them, which is why a settings page added after somebody's signup simply
never appeared in their menu. `scripts/backfillOwnerPermissions.ts` existed to
fix this and was never wired to anything; `deploy.sh --api` now runs it after
the migrations, and it prints "nothing to do" when the grants and the catalogue
agree.

**Signup collected a company master and threw most of it away.** The wizard
asks eleven questions — trade name, entity type, industries, financial year,
currency, registered address — and `setup-company` parsed them into a `profile`
object that nothing read. Only the name, state and GSTIN survived, so the
profile screen greeted the owner empty.

**And the browser could not ask what company it was looking at.** `/auth/me`
returned an org id and a name; nothing returned the master. A machine that had
never seen these books started from an empty local store, fell back to the
placeholder company the app invents (`{ id: 1, name: 'Company' }`) and offered
to set the company up again — against books that were on the server the whole
time. That is the screen the user was looking at when they asked what the point
of creating a company at signup was.

- `setup-company` stores the profile on `org.profileJson`, with the state and
  GSTIN alongside it.
- `/auth/me` returns each org's name, handle and parsed profile.
- `src/hooks/useCompanyFromServer.js` rebuilds the local company record from
  it. **Local edits win** — it fills blanks and replaces the placeholder, and
  never overwrites something typed here, because a corrected trade name is an
  answer rather than a gap.

## What the live test pass found (10–11 Sep 2026)

Driven against production with a signed-in session.

**Every invoice was stored on the server as a Draft.** The catalogue puts an
invoice's `status`, `discount` and `paidAmount` at field level 1, so a clerk can
raise an invoice without settling it. Role grants are written at level 0 — the
seeder has no reason to pick anything else — so `filterFieldsByLevel` stripped
those three fields from **every** request, the account owner's included. Nothing
was refused: the field was dropped and the server fell back to its default. The
browser kept its own copy as Unpaid, so nothing looked wrong until a second
device hydrated the books, or a server-side report counted only what it thought
was live. Proven on the live site: the client sent `status: "Unpaid"`, the row
came back `Draft`. An ADMIN role now carries the maximum field level rather than
the level somebody remembered to type; restricted roles are untouched.

**An item created from the Items screen never reached the server.** The same
item created from the picker on an invoice line did. So whether a company's
catalogue survived a change of machine depended on which screen it was typed
into — and hydration matches on `backendItemId`, so a browser-only item is
invisible to it.

**The wizard's first customer never reached the server either.** The one
customer the product itself walks somebody through creating was the one that
could not survive a new device.

Both now write through on the rule every other master follows: the row is kept
locally whatever the server says, and a refusal is reported rather than
swallowed.
