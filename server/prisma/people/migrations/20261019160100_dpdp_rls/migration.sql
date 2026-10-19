-- Tenant isolation on the breach register, same policy as Employee.

ALTER TABLE "DataBreach" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataBreach" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DataBreach";
CREATE POLICY tenant_isolation ON "DataBreach"
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
