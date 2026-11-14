-- Kept apart from the table itself so the test setup, which builds tables with
-- `db push`, can apply the policy on its own.
-- Tenant isolation, fail-closed, the same shape every Books table carries.
ALTER TABLE "PartyCodeCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartyCodeCounter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PartyCodeCounter";
CREATE POLICY tenant_isolation ON "PartyCodeCounter"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
