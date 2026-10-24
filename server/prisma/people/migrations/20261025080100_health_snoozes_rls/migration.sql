-- Tenant isolation, fail closed (A-35).
ALTER TABLE "HealthSnooze" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HealthSnooze" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HealthSnooze";
CREATE POLICY tenant_isolation ON "HealthSnooze"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
