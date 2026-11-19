-- Statutory bonus (Payment of Bonus Act 1965): the Act's figures as editable
-- company settings, a bonus run per financial year and a line per person.
-- Additive: new columns with defaults and two new tables. No data is changed.

ALTER TABLE "PayrollSetting" ADD COLUMN "bonusEligibilityCeiling" DECIMAL(65,30) NOT NULL DEFAULT 21000;
ALTER TABLE "PayrollSetting" ADD COLUMN "bonusCalculationCeiling" DECIMAL(65,30) NOT NULL DEFAULT 7000;
ALTER TABLE "PayrollSetting" ADD COLUMN "bonusMinimumWage" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollSetting" ADD COLUMN "bonusMinPercent" DECIMAL(65,30) NOT NULL DEFAULT 8.33;
ALTER TABLE "PayrollSetting" ADD COLUMN "bonusMaxPercent" DECIMAL(65,30) NOT NULL DEFAULT 20;
ALTER TABLE "PayrollSetting" ADD COLUMN "bonusMinimumAmount" DECIMAL(65,30) NOT NULL DEFAULT 100;
ALTER TABLE "PayrollSetting" ADD COLUMN "bonusMinDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "PayrollBonusRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ratePercent" DECIMAL(65,30) NOT NULL,
    "rulesJson" TEXT NOT NULL DEFAULT '{}',
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "periodId" TEXT,
    "componentId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollBonusRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollBonusRun_orgId_financialYear_idx" ON "PayrollBonusRun"("orgId", "financialYear");

CREATE TABLE "PayrollBonusLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "daysWorked" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "wages" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bonusWages" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "monthsJson" TEXT NOT NULL DEFAULT '[]',
    "adjustmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollBonusLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollBonusLine_runId_employeeId_key" ON "PayrollBonusLine"("runId", "employeeId");
CREATE INDEX "PayrollBonusLine_orgId_employeeId_idx" ON "PayrollBonusLine"("orgId", "employeeId");

ALTER TABLE "PayrollBonusLine" ADD CONSTRAINT "PayrollBonusLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollBonusRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, fail closed (A-35).
ALTER TABLE "PayrollBonusRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollBonusRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollBonusRun";
CREATE POLICY tenant_isolation ON "PayrollBonusRun"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "PayrollBonusLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollBonusLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollBonusLine";
CREATE POLICY tenant_isolation ON "PayrollBonusLine"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
