-- Tenant isolation on ReportSchedule, same policy as Employee.

ALTER TABLE "ReportSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSchedule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReportSchedule";
CREATE POLICY tenant_isolation ON "ReportSchedule"
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
