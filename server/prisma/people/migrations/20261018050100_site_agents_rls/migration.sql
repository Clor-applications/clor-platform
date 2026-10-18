-- Tenant isolation on SiteAgent and AgentJob, same policy as Employee.

ALTER TABLE "SiteAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteAgent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteAgent";
CREATE POLICY tenant_isolation ON "SiteAgent"
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

ALTER TABLE "AgentJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AgentJob";
CREATE POLICY tenant_isolation ON "AgentJob"
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
