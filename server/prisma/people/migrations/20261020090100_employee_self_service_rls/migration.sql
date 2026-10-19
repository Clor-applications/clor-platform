-- Tenant isolation on month confirmations, same policy as Employee.

ALTER TABLE "AttendanceMonthConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceMonthConfirmation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceMonthConfirmation";
CREATE POLICY tenant_isolation ON "AttendanceMonthConfirmation"
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


ALTER TABLE "OvertimeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OvertimeRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OvertimeRequest";
CREATE POLICY tenant_isolation ON "OvertimeRequest"
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
