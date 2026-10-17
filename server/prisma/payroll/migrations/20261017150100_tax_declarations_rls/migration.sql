-- Tenant isolation on tax declarations, same policy as Employee.

ALTER TABLE "TaxDeclaration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxDeclaration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TaxDeclaration";
CREATE POLICY tenant_isolation ON "TaxDeclaration"
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

