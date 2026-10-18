-- Tenant isolation on HrConnection, same policy as Employee.

ALTER TABLE "HrConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrConnection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HrConnection";
CREATE POLICY tenant_isolation ON "HrConnection"
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
-- Tenant isolation on HrOutbox, same policy as Employee.

ALTER TABLE "HrOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrOutbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HrOutbox";
CREATE POLICY tenant_isolation ON "HrOutbox"
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
-- Tenant isolation on HrSyncLog, same policy as Employee.

ALTER TABLE "HrSyncLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrSyncLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HrSyncLog";
CREATE POLICY tenant_isolation ON "HrSyncLog"
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
