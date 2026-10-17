-- Tenant isolation on final settlements, same policy as Employee.

ALTER TABLE "FinalSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinalSettlement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinalSettlement";
CREATE POLICY tenant_isolation ON "FinalSettlement"
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

