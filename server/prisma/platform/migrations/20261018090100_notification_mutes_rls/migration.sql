-- Tenant isolation, same policy as Notification.
ALTER TABLE "NotificationMute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationMute" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationMute";
CREATE POLICY tenant_isolation ON "NotificationMute"
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
