# Migrations

Schema changes are versioned here and applied with `prisma migrate deploy`.

Until now the deploy ran `prisma db push --accept-data-loss`, which asks Prisma
to make the database look like the schema and work out the difference itself.
That is fine while nothing is at stake and wrong once there is data: there is no
history, no way to roll a change back, nothing to review before it runs, and no
record of what was applied to which environment and when. Two instances cannot
safely deploy at all.

## The baseline

`00000000000000_init` is the schema as it stood when migrations were introduced.
Databases that already exist — production among them — were built by `db push`
and already have every one of those tables, so the baseline must be recorded as
applied rather than run:

```bash
npx prisma migrate resolve --applied 00000000000000_init
```

That is a one-time step per existing database. Running the baseline against a
database that already has the tables would fail on the first CREATE TABLE.

A brand-new database needs nothing special: `migrate deploy` applies the
baseline like any other migration.

## Adding a change

```bash
npx prisma migrate dev --name what_it_does    # writes the migration, applies it locally
```

Read the SQL it generates before committing it. The point of this directory is
that a schema change is reviewable in a diff like any other code, so a migration
nobody read is a migration that defeats it.

## Deploying

`prisma migrate deploy` applies what is outstanding and nothing else. It never
resets and never drops — if a migration cannot be applied it stops, which is the
behaviour you want at three in the morning.
