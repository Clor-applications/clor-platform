-- Tenant isolation on biometric templates, same policy as Employee.

ALTER TABLE "BiometricTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BiometricTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BiometricTemplate";
CREATE POLICY tenant_isolation ON "BiometricTemplate"
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
