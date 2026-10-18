-- Tenant isolation on ScimToken, same policy as AuthProvider.

ALTER TABLE "ScimToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScimToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ScimToken";
CREATE POLICY tenant_isolation ON "ScimToken"
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
