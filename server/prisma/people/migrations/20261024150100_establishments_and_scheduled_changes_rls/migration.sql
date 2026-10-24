-- Tenant isolation, fail closed (A-35).
ALTER TABLE "LegalEntity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalEntity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LegalEntity";
CREATE POLICY tenant_isolation ON "LegalEntity"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "Establishment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Establishment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Establishment";
CREATE POLICY tenant_isolation ON "Establishment"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "ScheduledChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduledChange" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ScheduledChange";
CREATE POLICY tenant_isolation ON "ScheduledChange"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
