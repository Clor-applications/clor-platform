-- Tenant isolation on the credential registry, written fail-closed (A-35):
-- a row is visible only to its own company, or to work that has said it reads
-- across companies (clor.bypass), such as looking a token up to learn whose it is.

ALTER TABLE "Credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Credential" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Credential";
CREATE POLICY tenant_isolation ON "Credential"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "CredentialEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CredentialEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CredentialEvent";
CREATE POLICY tenant_isolation ON "CredentialEvent"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
