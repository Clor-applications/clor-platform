# Data Boundary and RLS Baseline

## Confirmed in source

- Accounting, Platform, People and Payroll use distinct generated Prisma clients and environment variable names.
- The request tenant is carried with AsyncLocalStorage.
- Wrapped Prisma queries set `clor.org_id` with transaction-local `set_config`.
- RLS migration files exist in all four schema trees.
- Cross-database references are scalar IDs and cannot use database foreign keys.
- `/ready` checks all four logical stores.

## Not yet confirmed

- Whether production uses four physical databases, separate schemas in one database, or multiple URLs resolving to the same cluster/database.
- Whether every RLS migration has been applied to production.
- Whether the application role is subject to RLS or can bypass it through ownership, `BYPASSRLS`, superuser, or missing `FORCE ROW LEVEL SECURITY`.
- Whether every tenant table has a policy and every policy covers SELECT, INSERT, UPDATE and DELETE correctly.
- Whether background jobs intentionally running without `clor.org_id` can read all rows and whether their DB role is constrained.
- Whether object storage keys, caches, logs, exports and search indexes enforce the same tenant boundary.

## Required live evidence

1. Sanitized mapping of each Prisma URL variable to project/instance/database/schema identity.
2. `pg_class.relrowsecurity` and `relforcerowsecurity` inventory for all tenant tables.
3. `pg_policies` export with expressions, commands and roles.
4. Runtime role attributes and ownership evidence without passwords or connection strings.
5. Negative queries under the real application role for two organizations and two accounts.
6. Restore test proving each store and cross-store reconciliation can recover to a consistent checkpoint.

RLS is defense in depth. Application filters and ownership checks remain mandatory because some platform/global operations intentionally run outside a tenant scope.

