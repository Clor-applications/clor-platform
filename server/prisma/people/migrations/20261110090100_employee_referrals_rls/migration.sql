-- Tenant isolation, fail closed (A-35), for referrals and referral links: a row shows only for
-- its own company, or to background work with `clor.bypass` on. Policies only; safe to run twice.
ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Referral" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Referral";
CREATE POLICY tenant_isolation ON "Referral"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "ReferralLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReferralLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReferralLink";
CREATE POLICY tenant_isolation ON "ReferralLink"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
