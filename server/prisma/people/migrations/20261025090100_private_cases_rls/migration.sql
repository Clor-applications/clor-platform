-- Tenant isolation, fail closed (A-35). Membership is checked in the service on top of this.
ALTER TABLE "PrivateCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateCase" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PrivateCase";
CREATE POLICY tenant_isolation ON "PrivateCase"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "PrivateCaseMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateCaseMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PrivateCaseMember";
CREATE POLICY tenant_isolation ON "PrivateCaseMember"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "PrivateCaseEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateCaseEvidence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PrivateCaseEvidence";
CREATE POLICY tenant_isolation ON "PrivateCaseEvidence"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "PrivateCaseAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateCaseAccess" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PrivateCaseAccess";
CREATE POLICY tenant_isolation ON "PrivateCaseAccess"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "CommitteeSetup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommitteeSetup" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CommitteeSetup";
CREATE POLICY tenant_isolation ON "CommitteeSetup"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

