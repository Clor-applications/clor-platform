-- Tenant isolation on geofences and punch photos, same policy as Employee.

ALTER TABLE "Geofence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Geofence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Geofence";
CREATE POLICY tenant_isolation ON "Geofence"
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

ALTER TABLE "PunchPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PunchPhoto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PunchPhoto";
CREATE POLICY tenant_isolation ON "PunchPhoto"
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
