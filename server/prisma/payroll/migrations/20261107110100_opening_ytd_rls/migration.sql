-- Tenant isolation, fail closed (A-35), for opening year-to-date figures.
ALTER TABLE "PayrollOpeningYtd" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollOpeningYtd" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollOpeningYtd";
CREATE POLICY tenant_isolation ON "PayrollOpeningYtd"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
