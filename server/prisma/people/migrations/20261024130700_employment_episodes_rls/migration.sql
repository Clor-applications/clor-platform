-- Tenant isolation on employment stints, fail closed (A-35): a row is seen
-- only by its own company, or under the bypass that background work sets.
ALTER TABLE "EmploymentEpisode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmploymentEpisode" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmploymentEpisode";
CREATE POLICY tenant_isolation ON "EmploymentEpisode"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
