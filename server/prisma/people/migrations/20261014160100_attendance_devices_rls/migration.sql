-- Tenant isolation on the reader tables, same policy as Employee.
-- UnclaimedReader has no tenant (a serial no company has claimed) and no policy.

ALTER TABLE "AttendanceDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceDevice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceDevice";
CREATE POLICY tenant_isolation ON "AttendanceDevice"
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

ALTER TABLE "DevicePunch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DevicePunch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DevicePunch";
CREATE POLICY tenant_isolation ON "DevicePunch"
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

ALTER TABLE "DeviceCommand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceCommand" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeviceCommand";
CREATE POLICY tenant_isolation ON "DeviceCommand"
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

ALTER TABLE "DeviceUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceUser" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeviceUser";
CREATE POLICY tenant_isolation ON "DeviceUser"
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
