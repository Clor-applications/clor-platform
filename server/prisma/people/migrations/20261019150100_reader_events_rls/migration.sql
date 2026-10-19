-- Tenant isolation on reader events, same policy as Employee.

ALTER TABLE "ReaderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReaderEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReaderEvent";
CREATE POLICY tenant_isolation ON "ReaderEvent"
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
