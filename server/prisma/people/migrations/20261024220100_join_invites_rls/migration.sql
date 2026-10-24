-- Tenant isolation, fail closed (A-35).
ALTER TABLE "JoinInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JoinInvite" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JoinInvite";
CREATE POLICY tenant_isolation ON "JoinInvite"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
