-- Tenant isolation, fail closed (A-35).
ALTER TABLE "EmployeeDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeDraft" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmployeeDraft";
CREATE POLICY tenant_isolation ON "EmployeeDraft"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
