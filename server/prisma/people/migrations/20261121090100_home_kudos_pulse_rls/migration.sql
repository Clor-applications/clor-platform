-- Tenant isolation, fail closed (A-35), for People Home's kudos and pulse: a row shows only for its own company,
-- or to background work with `clor.bypass` on. Policies only; safe to run twice.
ALTER TABLE "Kudos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Kudos" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Kudos";
CREATE POLICY tenant_isolation ON "Kudos"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "PulseQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PulseQuestion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PulseQuestion";
CREATE POLICY tenant_isolation ON "PulseQuestion"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "PulseAnswer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PulseAnswer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PulseAnswer";
CREATE POLICY tenant_isolation ON "PulseAnswer"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

