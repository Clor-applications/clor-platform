-- Tenant isolation, same policy as Employee.
ALTER TABLE "DeviceLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeviceLog";
CREATE POLICY tenant_isolation ON "DeviceLog"
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
