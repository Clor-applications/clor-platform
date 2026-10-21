-- Tenant isolation, same policy as Notification.
ALTER TABLE "OrgClosure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgClosure" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OrgClosure";
CREATE POLICY tenant_isolation ON "OrgClosure"
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
