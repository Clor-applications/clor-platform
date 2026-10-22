-- Tenant isolation on the leave ledger, same policy as Employee.
ALTER TABLE "LeaveAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveAdjustment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaveAdjustment";
CREATE POLICY tenant_isolation ON "LeaveAdjustment"
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
