-- Tenant isolation, fail closed (A-35).
ALTER TABLE "RetentionRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RetentionRule";
CREATE POLICY tenant_isolation ON "RetentionRule"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "DeletionReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeletionReview" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeletionReview";
CREATE POLICY tenant_isolation ON "DeletionReview"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "AuditorGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditorGrant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditorGrant";
CREATE POLICY tenant_isolation ON "AuditorGrant"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

