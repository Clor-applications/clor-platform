-- Tenant isolation, fail closed (A-35).
ALTER TABLE "DecisionRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DecisionRecord";
CREATE POLICY tenant_isolation ON "DecisionRecord"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
