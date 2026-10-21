-- Tenant isolation on employment history, same policy as Employee.

ALTER TABLE "EmploymentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmploymentEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmploymentEvent";
CREATE POLICY tenant_isolation ON "EmploymentEvent"
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
