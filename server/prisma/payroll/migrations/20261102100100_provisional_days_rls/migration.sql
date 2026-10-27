-- Tenant isolation, fail closed (A-35), for payroll settings.
ALTER TABLE "PayrollSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollSetting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollSetting";
CREATE POLICY tenant_isolation ON "PayrollSetting"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
