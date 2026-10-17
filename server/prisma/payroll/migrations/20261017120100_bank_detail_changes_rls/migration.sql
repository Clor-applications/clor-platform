-- Tenant isolation on bank detail changes, same policy as Employee.

ALTER TABLE "BankDetailChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankDetailChange" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BankDetailChange";
CREATE POLICY tenant_isolation ON "BankDetailChange"
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

