-- Tenant isolation on the recycle bin, same policy as Employee.

ALTER TABLE "DeletedItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeletedItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeletedItem";
CREATE POLICY tenant_isolation ON "DeletedItem"
  USING (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  )
  WITH CHECK (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  );
