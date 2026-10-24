-- Tenant isolation, fail closed (A-35).
ALTER TABLE "ComplianceRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ComplianceRule";
CREATE POLICY tenant_isolation ON "ComplianceRule"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "Obligation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Obligation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Obligation";
CREATE POLICY tenant_isolation ON "Obligation"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

