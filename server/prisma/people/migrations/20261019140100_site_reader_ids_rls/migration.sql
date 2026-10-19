-- Tenant isolation on reader IDs per site, same policy as Employee.

ALTER TABLE "ReaderIdAtSite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReaderIdAtSite" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReaderIdAtSite";
CREATE POLICY tenant_isolation ON "ReaderIdAtSite"
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
