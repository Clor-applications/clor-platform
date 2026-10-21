-- Tenant isolation on the compliance calendar, same policy as Employee.

ALTER TABLE "ComplianceTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceTask" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ComplianceTask";
CREATE POLICY tenant_isolation ON "ComplianceTask"
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
