-- Tenant isolation, fail closed (A-35). The access log is append-only like the change log.
ALTER TABLE "EmployeeIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeIdentity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmployeeIdentity";
CREATE POLICY tenant_isolation ON "EmployeeIdentity"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "AccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccessLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AccessLog";
CREATE POLICY tenant_isolation ON "AccessLog"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON "AccessLog"
  FOR EACH ROW EXECUTE FUNCTION people_refuse_change();
