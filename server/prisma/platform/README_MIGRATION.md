# Platform database — one-time dev data move

The 27 platform models (accounts, orgs, branches, users, sessions, roles,
permissions, the audit trail, entitlements and the auth/email plumbing) used to
live in the accounting database. They now have their own: `PLATFORM_DATABASE_URL`.
This note moves the existing dev data across. Do it once, per environment.

> No connection strings or secrets live in this repo. Everywhere below, the URLs
> come from your environment: `$DATABASE_URL` is the current accounting database
> (clor_main) and `$PLATFORM_DATABASE_URL` is the new platform database
> (clor_platform). Set them in your shell before running anything; do not paste
> real credentials into these files.

The 27 tables:

```
Account, Org, Branch, User, UserOrgMembership, UserBranchMembership,
UserWarehouseAccess, Role, Permission, RolePermission, UserRoleAssignment,
RoleProfile, RoleProfileRole, UserRoleProfile, UserPermission, AuditLog,
AccountEntitlement, FeatureSetting, Session, PasswordResetToken, AuthEvent,
EmailVerificationToken, NotificationSetting, EmailSetting, EmailOutbox,
AuthPolicy, AuthProvider
```

## Sequence

Do these in order. Nothing is dropped from accounting until the data is proven
to be in platform.

### 1. Create the platform database and its schema

Create an empty `clor_platform` database on the same server, point
`PLATFORM_DATABASE_URL` at it, then lay down the tables and policies:

```sh
# tables
npm --prefix server run platform:deploy      # prisma migrate deploy --schema prisma/platform/schema.prisma
# row-level security policies (not carried by migrate deploy)
psql "$PLATFORM_DATABASE_URL" -f server/prisma/platform/migrations/20260924120000_row_level_security/migration.sql
```

### 2. Dump the 27 tables from accounting (data only)

The tables already exist in platform from step 1, so dump rows only, and dump
them in FK-safe order (pg_dump with an explicit table list preserves insert
order within the dump):

```sh
pg_dump "$DATABASE_URL" \
  --data-only --no-owner --no-privileges --disable-triggers \
  -t '"Account"' -t '"Org"' -t '"Branch"' -t '"User"' \
  -t '"UserOrgMembership"' -t '"UserBranchMembership"' -t '"UserWarehouseAccess"' \
  -t '"Role"' -t '"Permission"' -t '"RolePermission"' -t '"UserRoleAssignment"' \
  -t '"RoleProfile"' -t '"RoleProfileRole"' -t '"UserRoleProfile"' \
  -t '"UserPermission"' -t '"AuditLog"' -t '"AccountEntitlement"' \
  -t '"FeatureSetting"' -t '"Session"' -t '"PasswordResetToken"' \
  -t '"AuthEvent"' -t '"EmailVerificationToken"' -t '"NotificationSetting"' \
  -t '"EmailSetting"' -t '"EmailOutbox"' -t '"AuthPolicy"' -t '"AuthProvider"' \
  > /tmp/platform_data.sql
```

`--disable-triggers` lets the data-only restore load rows without the
platform↔platform foreign keys fighting insert order.

### 3. Restore into platform

```sh
psql "$PLATFORM_DATABASE_URL" -f /tmp/platform_data.sql
```

### 4. Verify, table by table

For each of the 27 tables, the counts must match before anything is dropped:

```sh
for t in Account Org Branch User UserOrgMembership UserBranchMembership \
  UserWarehouseAccess Role Permission RolePermission UserRoleAssignment \
  RoleProfile RoleProfileRole UserRoleProfile UserPermission AuditLog \
  AccountEntitlement FeatureSetting Session PasswordResetToken AuthEvent \
  EmailVerificationToken NotificationSetting EmailSetting EmailOutbox \
  AuthPolicy AuthProvider; do
  a=$(psql "$DATABASE_URL"          -tAc "SELECT count(*) FROM \"$t\"")
  p=$(psql "$PLATFORM_DATABASE_URL" -tAc "SELECT count(*) FROM \"$t\"")
  printf '%-24s main=%-8s platform=%-8s %s\n' "$t" "$a" "$p" \
    "$([ "$a" = "$p" ] && echo OK || echo MISMATCH)"
done
```

Do not continue while any row says `MISMATCH`.

### 5. Drop the 27 tables from accounting

Only now, and against clor_main:

```sh
psql "$DATABASE_URL" -f server/prisma/platform/MIGRATE_DATA.sql
```

`MIGRATE_DATA.sql` drops each table `CASCADE`, which also removes the old
cross-database foreign keys that accounting tables held into these (for example
`OrgMaster.accountId → Account`). The scalar id columns (`accountId`, `orgId`,
`branchId`, `userId`, `warehouseId`) stay on the accounting rows — they are how
the two databases now refer to each other.

### 6. Afterwards

- The accounting Prisma schema no longer declares these 27 models, so a later
  `prisma migrate` / `db push` against accounting will not try to recreate or
  re-drop them.
- Application code reaches platform data through `platformPrisma`
  (`server/src/utils/platformPrisma.ts`); accounting data still goes through
  `prisma`. A single transaction can no longer span both — see the note in
  `platformPrisma.ts`.

## Rollback

Until step 5 runs, the accounting database is untouched and the platform
database is additive — drop `clor_platform` and nothing is lost. After step 5,
restore the dropped tables into clor_main from the step-2 dump (and a matching
schema-only dump) before pointing the app back at the pre-split code.
