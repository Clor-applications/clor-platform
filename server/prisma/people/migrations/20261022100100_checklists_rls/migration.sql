-- Tenant isolation on checklist templates and tasks, same policy as Employee.
ALTER TABLE "ChecklistTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChecklistTemplate";
CREATE POLICY tenant_isolation ON "ChecklistTemplate"
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

ALTER TABLE "ChecklistTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChecklistTask" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChecklistTask";
CREATE POLICY tenant_isolation ON "ChecklistTask"
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

