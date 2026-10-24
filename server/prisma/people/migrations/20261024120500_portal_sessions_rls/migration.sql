-- Tenant isolation on portal sessions, written fail-closed (A-35).
ALTER TABLE "PortalSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PortalSession";
CREATE POLICY tenant_isolation ON "PortalSession"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
