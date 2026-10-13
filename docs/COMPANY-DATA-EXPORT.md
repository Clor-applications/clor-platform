# Company data export

A copy of one company's own books, for the people whose books they are.

**Settings → Account → Data Backup**, gated on `SETTINGS::Company data::EXPORT`.

## Why it is separate from the system backup

The system backup is the whole SQLite database: every customer's books in one
file. It belongs to whoever runs the service, and no customer should ever hold
one. It is also useless to a customer even if they had it — it cannot be read
without the server.

This is the other thing. One company, its own records, in a file the owner can
keep, open, read and take elsewhere. Beyond convenience it is two other things:
a customer who cannot get their data out is locked in, and under the DPDP Act a
data principal is entitled to their data in a portable form.

## Two kinds, because they answer two different questions

**Data** — what the business did. Customers and vendors with their addresses and
contacts, items, invoices, bills, quotations, orders, challans, credit and debit
notes, expenses, receipts and payments with their allocations, every journal
entry and line, salesmen, fixed assets and the cash book.

Large, only grows, and the copy you would hand an accountant.

**Configuration** — how the company is set up. The company profile, branches and
warehouses, the chart of accounts, numbering series, roles and their
permissions, feature settings, approval rules, fiscal years, the six reference
lists, email and e-invoice settings, and recurring schedules.

Small, rarely changed, and the thing you want when somebody has altered the
invoice numbering, or when a practice is setting up its eleventh client company
the way it set up the tenth.

Keeping them apart matters: a configuration restore should not have to carry a
year of invoices, and a data file should not be the thing you copy between
companies.

`?scope=data`, `?scope=configuration`, or both. Readable JSON with a header
saying which scope it is, which company it came from, when it was taken and how
many of each record it holds — so a file found on a shared drive in two years
can explain itself.

## What is deliberately not in it

- **Any other company's data.** Every query is scoped to the account *and* the
  org. Tests assert that a second company's records — including a sibling
  company on the same account — never appear.
- **Credentials.** No users, passwords, sessions or API secrets. The email and
  e-invoice settings are exported — a configuration backup that loses the SMTP
  host is not one — but `passwordEnc`, `clientSecretEnc` and the signing key are
  stripped. A configuration file is meant to be read and copied between
  companies, which is nowhere for a credential to be, even an encrypted one.

  The test for this originally proved nothing: it asserted `passwordEnc` was
  absent from a company that had no email settings at all, which passes whatever
  the code does. It now creates one with a real secret first.

## What is not built, and why it says so on the page

**Sending it somewhere automatically.** A nightly copy to SharePoint, Google
Drive, a network share or object storage needs an account to send it to and
permission to write there. Neither exists, so nothing is scheduled and the page
says exactly that rather than implying a copy is going out.

**Restoring.** Reading a backup back in has to decide what happens to every
record that exists in both the file and the company — and a restore that
silently duplicates a year of invoices is worse than no restore at all. The page
says it is not offered rather than leaving a button that half works.

Until those exist, the honest description is: a record you can read, audit and
hand to an accountant, not a one-click undo.
