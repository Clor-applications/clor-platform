-- Row-level security: the database's own opinion about which company a query
-- may see.
--
-- Every tenant route filters by orgId, and every one of them is correct today.
-- The problem is the word "today": one forgotten `where` across 52 route files
-- shows another company's invoices, with nothing between the mistake and the
-- customer. Application filtering is a convention, and a convention cannot be
-- enforced. This can.
--
-- The policy compares a row's orgId against `clor.org_id` on the connection,
-- which src/utils/tenantDb.ts sets with SET LOCAL inside a transaction — LOCAL
-- because a plain SET outlives the request on a pooled connection and the next
-- company inherits it.
--
-- FORCE matters: a table's owner is exempt from its own policies unless forced,
-- and the application connects as the owner. Without it these policies would be
-- real, enforced against nobody, and comfortable to believe in.
--
-- ## Why the setting being unset is allowed through
--
-- A policy that denied everything without the setting would be correct and
-- would also take the product down the moment it shipped, because the routes
-- are not converted yet. So an unset setting means "no opinion" and the query
-- proceeds as before, while a setting that is present is enforced exactly.
--
-- That makes conversion incremental and safe: a route moved onto withTenant()
-- gains real enforcement immediately, and a route not yet moved cannot break.
-- The endgame is to delete the first two clauses of each USING, at which point
-- a query that has not said which company it is for sees nothing. Do that when
-- `grep -rn "prisma\." src/routes` returns only converted call sites.

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Employee";
CREATE POLICY tenant_isolation ON "Employee"
  USING (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  )
  WITH CHECK (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  );
