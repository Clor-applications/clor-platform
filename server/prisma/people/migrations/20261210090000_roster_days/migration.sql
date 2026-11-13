-- The roster planner (platform audit 11 Nov 2026, Shifts: "Roster planner: partial"). Additive; an older API
-- never reads either. Safe to run twice.
-- A shift's minimum staffing, read only by the roster's coverage row.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "minStaff" INTEGER;

-- One person's day on the roster: a draft being planned, or the published day the schedule resolver reads.
CREATE TABLE IF NOT EXISTS "RosterDay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "kind" TEXT NOT NULL,
    "shiftId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "RosterDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RosterDay_employeeId_date_state_key" ON "RosterDay"("employeeId", "date", "state");
CREATE INDEX IF NOT EXISTS "RosterDay_orgId_state_date_idx" ON "RosterDay"("orgId", "state", "date");
CREATE INDEX IF NOT EXISTS "RosterDay_orgId_shiftId_idx" ON "RosterDay"("orgId", "shiftId");

ALTER TABLE "RosterDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RosterDay" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RosterDay";
-- Fails closed (20261024100000_rls_fail_closed): a row shows only for its own company, or to background work with the bypass on.
CREATE POLICY tenant_isolation ON "RosterDay"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
