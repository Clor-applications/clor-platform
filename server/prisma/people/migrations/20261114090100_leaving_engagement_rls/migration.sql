-- Tenant isolation, fail closed (A-35), for the leaving and engagement tables: a row shows only for its own
-- company, or to background work with `clor.bypass` on. Policies only; safe to run twice.
ALTER TABLE "ClearanceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClearanceLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClearanceLine";
CREATE POLICY tenant_isolation ON "ClearanceLine"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "ExitInterview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExitInterview" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExitInterview";
CREATE POLICY tenant_isolation ON "ExitInterview"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "EngagementSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EngagementSettings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EngagementSettings";
CREATE POLICY tenant_isolation ON "EngagementSettings"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "AutomationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AutomationRun";
CREATE POLICY tenant_isolation ON "AutomationRun"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "CelebrationOptOut" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CelebrationOptOut" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CelebrationOptOut";
CREATE POLICY tenant_isolation ON "CelebrationOptOut"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "GreetingPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GreetingPost" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GreetingPost";
CREATE POLICY tenant_isolation ON "GreetingPost"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
