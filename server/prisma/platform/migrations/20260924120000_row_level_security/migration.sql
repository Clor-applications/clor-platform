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

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
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

ALTER TABLE "AuthPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthPolicy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuthPolicy";
CREATE POLICY tenant_isolation ON "AuthPolicy"
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

ALTER TABLE "AuthProvider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthProvider" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuthProvider";
CREATE POLICY tenant_isolation ON "AuthProvider"
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

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Branch";
CREATE POLICY tenant_isolation ON "Branch"
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

ALTER TABLE "EmailOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailOutbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmailOutbox";
CREATE POLICY tenant_isolation ON "EmailOutbox"
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

ALTER TABLE "EmailSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailSetting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmailSetting";
CREATE POLICY tenant_isolation ON "EmailSetting"
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

ALTER TABLE "FeatureSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureSetting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeatureSetting";
CREATE POLICY tenant_isolation ON "FeatureSetting"
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

ALTER TABLE "NotificationSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationSetting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationSetting";
CREATE POLICY tenant_isolation ON "NotificationSetting"
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

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Role";
CREATE POLICY tenant_isolation ON "Role"
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

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RolePermission";
CREATE POLICY tenant_isolation ON "RolePermission"
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

ALTER TABLE "RoleProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RoleProfile";
CREATE POLICY tenant_isolation ON "RoleProfile"
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

ALTER TABLE "RoleProfileRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleProfileRole" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RoleProfileRole";
CREATE POLICY tenant_isolation ON "RoleProfileRole"
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

ALTER TABLE "UserBranchMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserBranchMembership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserBranchMembership";
CREATE POLICY tenant_isolation ON "UserBranchMembership"
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

ALTER TABLE "UserOrgMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserOrgMembership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserOrgMembership";
CREATE POLICY tenant_isolation ON "UserOrgMembership"
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

ALTER TABLE "UserPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserPermission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserPermission";
CREATE POLICY tenant_isolation ON "UserPermission"
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

ALTER TABLE "UserRoleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRoleAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserRoleAssignment";
CREATE POLICY tenant_isolation ON "UserRoleAssignment"
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

ALTER TABLE "UserRoleProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRoleProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserRoleProfile";
CREATE POLICY tenant_isolation ON "UserRoleProfile"
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

ALTER TABLE "UserWarehouseAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserWarehouseAccess" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserWarehouseAccess";
CREATE POLICY tenant_isolation ON "UserWarehouseAccess"
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

-- The company row itself.
--
-- `Org` carries no orgId — it *is* the org — so the loop above skipped it, and
-- the one table whose name is the tenant was the one table without a policy.
-- Keyed on its own id, same rule.
ALTER TABLE "Org" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Org" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Org";
CREATE POLICY tenant_isolation ON "Org"
  USING (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "id" = current_setting('clor.org_id', true)
  )
  WITH CHECK (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "id" = current_setting('clor.org_id', true)
  );
