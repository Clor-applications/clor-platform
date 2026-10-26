-- Tenant isolation, fail closed (A-35), for the Time & Leave advanced tables.
ALTER TABLE "ApprovalStandIn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalStandIn" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ApprovalStandIn";
CREATE POLICY tenant_isolation ON "ApprovalStandIn"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "HolidayPick" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HolidayPick" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HolidayPick";
CREATE POLICY tenant_isolation ON "HolidayPick"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
ALTER TABLE "LeaveYearEnd" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveYearEnd" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaveYearEnd";
CREATE POLICY tenant_isolation ON "LeaveYearEnd"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
