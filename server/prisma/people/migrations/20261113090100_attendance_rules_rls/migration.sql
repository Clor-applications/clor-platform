-- Tenant isolation, fail closed (A-35), for the attendance-rules tables: a row shows only for its own
-- company, or to background work with `clor.bypass` on. Policies only; safe to run twice.
ALTER TABLE "AttendancePenalty" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendancePenalty" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendancePenalty";
CREATE POLICY tenant_isolation ON "AttendancePenalty"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "AttendanceNudge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceNudge" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceNudge";
CREATE POLICY tenant_isolation ON "AttendanceNudge"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "AbsenceCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AbsenceCase" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AbsenceCase";
CREATE POLICY tenant_isolation ON "AbsenceCase"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "AbsenceNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AbsenceNotice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AbsenceNotice";
CREATE POLICY tenant_isolation ON "AbsenceNotice"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "NightWorkConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NightWorkConsent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NightWorkConsent";
CREATE POLICY tenant_isolation ON "NightWorkConsent"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
