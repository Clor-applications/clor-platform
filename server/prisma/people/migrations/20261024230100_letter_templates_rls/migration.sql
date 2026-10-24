-- Tenant isolation, fail closed (A-35).
ALTER TABLE "LetterTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LetterTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LetterTemplate";
CREATE POLICY tenant_isolation ON "LetterTemplate"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
