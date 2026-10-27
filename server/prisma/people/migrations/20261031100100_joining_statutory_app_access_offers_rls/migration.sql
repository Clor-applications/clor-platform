-- Tenant isolation, fail closed (A-35), for joining statutory details, employee app sends and offers.
ALTER TABLE "JoinStatutory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JoinStatutory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JoinStatutory";
CREATE POLICY tenant_isolation ON "JoinStatutory"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "AppAccessSend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppAccessSend" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AppAccessSend";
CREATE POLICY tenant_isolation ON "AppAccessSend"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "Offer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Offer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Offer";
CREATE POLICY tenant_isolation ON "Offer"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
