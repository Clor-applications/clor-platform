-- The full-day rule fix (attendance audit 7 Nov 2026, PR #141): an index for its scan of half days and
-- absences, and a table of the days it looked at (corrected, or held with why), with the tenant policy
-- every People table has. Additive; an older API never reads it. Safe to run twice.
CREATE INDEX IF NOT EXISTS "AttendanceRecord_orgId_status_date_idx" ON "AttendanceRecord"("orgId", "status", "date");

CREATE TABLE IF NOT EXISTS "AttendanceFullDayReview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "settledAs" TEXT,
    "settledByUserId" TEXT,
    "settledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceFullDayReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceFullDayReview_recordId_key" ON "AttendanceFullDayReview"("recordId");
CREATE INDEX IF NOT EXISTS "AttendanceFullDayReview_orgId_outcome_settledAt_idx" ON "AttendanceFullDayReview"("orgId", "outcome", "settledAt");
CREATE INDEX IF NOT EXISTS "AttendanceFullDayReview_orgId_employeeId_idx" ON "AttendanceFullDayReview"("orgId", "employeeId");

ALTER TABLE "AttendanceFullDayReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceFullDayReview" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceFullDayReview";
-- Fails closed (20261024100000_rls_fail_closed): a row shows only for its own company, or to background work with the bypass on.
CREATE POLICY tenant_isolation ON "AttendanceFullDayReview"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
