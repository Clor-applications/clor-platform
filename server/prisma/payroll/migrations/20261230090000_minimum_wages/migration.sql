-- Minimum wages per state (round 66 pick): a table of rates by state, zone and
-- skill level with the date each applies from, and each person's skill level.
-- Additive: a new table and two new columns with defaults. No data is changed.

ALTER TABLE "EmployeePayrollProfile" ADD COLUMN "skillLevel" TEXT NOT NULL DEFAULT 'UNSKILLED';
ALTER TABLE "EmployeePayrollProfile" ADD COLUMN "minimumWageZone" TEXT;

CREATE TABLE "PayrollMinimumWage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zone" TEXT NOT NULL DEFAULT '',
    "skill" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "monthlyRate" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollMinimumWage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollMinimumWage_orgId_state_idx" ON "PayrollMinimumWage"("orgId", "state");

-- Tenant isolation, fail closed (A-35).
ALTER TABLE "PayrollMinimumWage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollMinimumWage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollMinimumWage";
CREATE POLICY tenant_isolation ON "PayrollMinimumWage"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
