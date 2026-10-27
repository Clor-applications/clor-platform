-- Tenant isolation, fail closed (A-35), for PF nominees.
ALTER TABLE "PfNominee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PfNominee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PfNominee";
CREATE POLICY tenant_isolation ON "PfNominee"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
