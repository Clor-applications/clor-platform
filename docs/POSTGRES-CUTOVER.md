# Moving to Postgres

The application code is ready. The datasource is not switched yet, and this
records exactly where the line is so nobody has to guess.

## What is already true

**Every raw SQL statement is gone.** There were twenty, across `invoices.ts`,
`governance.ts`, `parties.ts`, `payments.ts`, `revaluation.ts` and
`approvals.ts`, all using SQLite's `?` placeholder — which Postgres does not
accept. They are Prisma queries now, and Prisma writes the right placeholder for
whichever datasource is configured.

Two things came with that, both worth having on their own:

- The duplicate-invoice-number check read SQLite's error *text*. It reads
  Prisma's `P2002` now, which every database reports the same way.
- Reading through the client instead of raw SQL made money a typed `Decimal`,
  and the compiler immediately found two places that had been quietly coercing
  it. Raw SQL had been hiding them.

**Schema changes are versioned migrations.** See
`server/prisma/migrations/README.md`.

**The whole suite has been run against Postgres.** 39 files, 376 tests, all
passing, with the datasource flipped and the schema pushed to a real Postgres
instance. Not a guess — the same tests, a different database:

```bash
createdb neev_pg_probe
# flip `provider` to "postgresql" in schema.prisma, then:
TEST_DATABASE_URL=postgresql://you@localhost:5432/neev_pg_probe npm test
```

`TEST_DATABASE_URL` exists for exactly this. Nothing in the tests knows which
database it is talking to, which is what makes the result evidence.

## What is left, and why it is not done here

**Moving the data.** Production holds a live SQLite file. Copying it into
Postgres is a data migration with real books on the other side: every table, in
dependency order, with ids, decimals and dates preserved, verified row-count and
control-total by control-total against the source, and a rehearsed rollback.
That deserves its own pass, a maintenance window and a restore drill — not a
step tacked onto a code change.

**Where Postgres runs.** A managed instance or a container on the box, with
credentials, backups, and a restore that has actually been tested. That is an
operations decision, not a code one.

**One database everywhere.** Once the provider flips, dev and CI need Postgres
too — SQLite and Postgres differ in ways the schema does not show, so keeping
SQLite for development would mean testing against something production is not.
CI needs a Postgres service container.

## The order

1. Stand up Postgres and prove a backup can be restored into it.
2. Write the data migration; run it against a **copy** of production; compare
   row counts and control totals with the trial balance, not by eye.
3. Flip `provider`, add the Postgres service to CI, and run the suite there.
4. Cut over in a window, with the SQLite file kept untouched as the rollback.

Steps 1, 2 and 4 are operational and want a person watching. Step 3 is the small
one, and it is small **because** the raw SQL is already gone.
