# Clor's databases, and why there are several

Clor is several applications sharing a shell. Each keeps its own database:

| Database | Holds | State |
| --- | --- | --- |
| accounting | ledger, documents, tenancy, masters | live |
| people | who works here | live |
| payroll | salaries, payslips, statutory | live |
| attendance | time and presence | planned |
| projects & timesheets | work, and time against it | planned |

The rule is that a field belongs to the module that has to be **right** about
it. A bank account is payroll's, not a staff directory's. A joining date is
people's, and payroll reads it rather than keeping its own copy.

Every module holds the others' identifiers as plain strings — `employeeId`,
`orgId`, `ledgerAccountId` — with no cross-database foreign keys, because there
is no such thing. Referential integrity across a boundary is the application's
job, enforced where the two meet.

## People

One person record, shared by payroll and by attendance, timesheets and leave
when they arrive, owned by none of them. The failure it prevents is five modules
each growing their own staff list: five spellings of one name, five joining
dates, and no answer to which is right.

`Employee` lives there. `EmployeePayrollProfile` — the bank account, the PAN,
the statutory numbers — stays in payroll, because those are the fields that make
payroll worth stealing and a directory should not be a place to read them.

# Payroll — a separate application inside Clor

Payroll is its own bounded context. It has its own database, its own generated
Prisma client, its own migrations, and shares no table with accounting. It is
reached through the same shell, the same sign-in and the same permission model,
so to a user it is part of Clor; underneath, it is a second application.

## Why the boundary exists

**Blast radius.** Payroll holds what every person earns, their bank account and
their PAN. The strongest guarantee that none of it appears in a sales report is
not a code review — it is that the join which would leak it cannot be written.
A query against the accounting client cannot reach a salary, because the salary
is not in that database.

**Different lifecycle.** Payroll data is usually retained, exported, audited and
restored on a schedule of its own. One file means that can happen without
touching accounting, and without an accounting restore rolling back payroll.

**Room to move.** Payroll can be given its own server, or its own Postgres, by
changing one environment variable. No accounting query changes.

## What is NOT separate: the ledger

There is one set of books. Payroll does not keep a journal, a ledger account or
a trial balance of its own, and the payroll database contains no such table.
When a pay run is posted it calls the accounting posting service, exactly as
sales and purchases do, and the resulting journal lives in the accounting
database like every other entry.

`PayrollPosting` records **which** journal a run produced — the entry id, the
totals, who posted it and when. It is a receipt, not a second ledger.

## How the two are joined

Payroll stores Clor identifiers as plain strings, with no cross-database foreign
keys, because no such constraint can exist:

| Field | Points at |
| --- | --- |
| `accountId`, `orgId`, `branchId` | Clor tenancy |
| `ledgerAccountId` | `LedgerAccount` in accounting |
| `journalEntryId` | `JournalEntry` in accounting |
| `costCenterId` | `OrgMaster` of kind `COST_CENTER` |

Referential integrity across the boundary is the application's job, enforced at
the one place the two meet: posting. Inside payroll, foreign keys are real and
enforced as usual.

## The cost, stated plainly

**A transaction cannot span both databases.** Anything writing to both does it
in two steps, each idempotent, ordered so a crash in between leaves a state the
next attempt recognises and finishes.

For posting, the order is: write the journal in accounting, then record the
`PayrollPosting` in payroll. A crash between them leaves a journal with no
receipt. That is recoverable and visible — the run still reads as unposted, and
the next attempt finds the existing journal by its source document rather than
writing a second one. The reverse order would be worse: a receipt for a journal
that does not exist looks posted and is not.

`PayrollPosting` carries `@@unique([orgId, runId])`, so a run posts once however
many times the button is pressed.

## Files

| Path | What it is |
| --- | --- |
| `server/prisma/schema.prisma` | Accounting. No payroll or people model appears here. |
| `server/prisma/people/schema.prisma` | People. The person record. |
| `server/src/utils/peoplePrisma.ts` | The people client, and `PeopleDb`. |
| `server/prisma/payroll/schema.prisma` | Payroll. 25 models. |
| `server/prisma/payroll/migrations/` | Payroll migration history. |
| `server/src/generated/payroll/` | Payroll client. Generated, not committed. |
| `server/src/utils/payrollPrisma.ts` | The payroll client, and `PayrollDb`. |
| `server/src/utils/prisma.ts` | The accounting client. Unchanged. |

## Operating it

`PAYROLL_DATABASE_URL` and `PEOPLE_DATABASE_URL` must both be set wherever the
API runs. `scripts/migrate.ts` refuses to finish a deploy without either, rather
than starting an API whose routes throw on first use.

```bash
npm run payroll:migrate    # develop against it
npm run payroll:deploy     # apply migrations
npm run people:migrate     # and the person record
npm run prisma:generate    # generates ALL THREE clients
```

All three clients are generated in CI and on deploy. **A backup that copies only the
accounting database is not a backup** — `deploy/backup.sh` takes all three, each
as its own archive, each verified against the live row counts. Separate archives
on purpose: restoring accounting to last Tuesday must not drag payroll or the
staff list back with it.

## History

Payroll's tables were briefly created in the accounting schema
(`20260921060104_payroll_foundation`) and moved out in
`20260921062126_remove_payroll_from_accounting`. `Employee` was likewise created
in payroll and moved to people in `employee_moves_to_people`. The migrations are
kept because that is what happened; only local development ever applied the
earlier ones.

## Adding the next database

Attendance and timesheets follow the same shape, and the checklist is what this
document exists to record: a schema folder with its own `generator` output and
`datasource`, a client in `server/src/utils/`, a `*_DATABASE_URL` in
`.env.example`, generate in CI and `deploy.sh`, deploy in `scripts/migrate.ts`
with a refusal when the URL is missing, per-run files in `vitest.config.ts` and
`globalSetup.ts`, and its own archive in `deploy/backup.sh`. Miss the last one
and the data is not backed up; miss the fifth and the deploy starts an API whose
routes throw.
