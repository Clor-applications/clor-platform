-- GAP-006: tenant isolation on OutsideAccess, fail-closed (A-35). Looking up a
-- person's engagements across companies (sign-in, the company list) says so (clor.bypass).

ALTER TABLE "OutsideAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutsideAccess" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OutsideAccess";
CREATE POLICY tenant_isolation ON "OutsideAccess"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
