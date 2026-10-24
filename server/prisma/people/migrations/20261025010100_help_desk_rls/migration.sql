-- Tenant isolation, fail closed (A-35).
ALTER TABLE "DeskCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeskCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeskCategory";
CREATE POLICY tenant_isolation ON "DeskCategory"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "DeskRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeskRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeskRequest";
CREATE POLICY tenant_isolation ON "DeskRequest"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "DeskMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeskMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeskMessage";
CREATE POLICY tenant_isolation ON "DeskMessage"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "DeskTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeskTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeskTemplate";
CREATE POLICY tenant_isolation ON "DeskTemplate"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

