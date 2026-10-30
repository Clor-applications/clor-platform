-- Tenant isolation, fail closed (A-35), for the proof files of an obligation.
ALTER TABLE "ObligationProof" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ObligationProof" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ObligationProof";
CREATE POLICY tenant_isolation ON "ObligationProof"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
