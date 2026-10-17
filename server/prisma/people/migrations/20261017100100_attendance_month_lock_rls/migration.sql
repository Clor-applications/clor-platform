-- Tenant isolation on closed attendance months, same policy as Employee.

ALTER TABLE "AttendanceMonthLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceMonthLock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceMonthLock";
CREATE POLICY tenant_isolation ON "AttendanceMonthLock"
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
