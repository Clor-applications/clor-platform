ALTER TABLE "PeopleRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PeopleRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PeopleRecord";
CREATE POLICY tenant_isolation ON "PeopleRecord"
USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));
