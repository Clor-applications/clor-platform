-- Weekly wages (round 66): daily rates, weekly or fortnightly wage sheets and
-- their lines, for workers paid by the day. Their own tables: PayrollRun and
-- its unique index are not touched, and the monthly payroll is unchanged.
-- Additive: three new tables. No data is changed.

-- CreateTable
CREATE TABLE "WeeklyWageRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payGroupId" TEXT NOT NULL,
    "dailyRate" DECIMAL(65,30) NOT NULL,
    "hoursPerDay" DECIMAL(65,30) NOT NULL DEFAULT 8,
    "overtimeMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 2,
    "canteenPerDay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "advanceBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "advancePerSheet" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyWageRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyWageSheet" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "payGroupId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "wageMonth" TEXT NOT NULL,
    "lastOfMonth" BOOLEAN NOT NULL DEFAULT false,
    "paysWeeklyOff" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "gross" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "net" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidOn" TEXT,
    "paymentReference" TEXT,
    "paidByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyWageSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyWageLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "employeeCode" TEXT,
    "daysWorked" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dailyRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overtimeAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gross" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pfWage" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pfEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pfEmployer" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pfEps" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "esiEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "esiEmployer" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ptEmployee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "advanceRecovery" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "canteen" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "net" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "explanationJson" TEXT NOT NULL DEFAULT '[]',
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "uan" TEXT,
    "esiNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyWageLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyWageRate_orgId_payGroupId_idx" ON "WeeklyWageRate"("orgId", "payGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyWageRate_orgId_employeeId_key" ON "WeeklyWageRate"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "WeeklyWageSheet_orgId_wageMonth_idx" ON "WeeklyWageSheet"("orgId", "wageMonth");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyWageSheet_orgId_payGroupId_startDate_key" ON "WeeklyWageSheet"("orgId", "payGroupId", "startDate");

-- CreateIndex
CREATE INDEX "WeeklyWageLine_orgId_employeeId_idx" ON "WeeklyWageLine"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyWageLine_sheetId_employeeId_key" ON "WeeklyWageLine"("sheetId", "employeeId");

-- AddForeignKey
ALTER TABLE "WeeklyWageLine" ADD CONSTRAINT "WeeklyWageLine_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "WeeklyWageSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation, fail closed (A-35).
ALTER TABLE "WeeklyWageRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyWageRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WeeklyWageRate";
CREATE POLICY tenant_isolation ON "WeeklyWageRate"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "WeeklyWageSheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyWageSheet" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WeeklyWageSheet";
CREATE POLICY tenant_isolation ON "WeeklyWageSheet"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "WeeklyWageLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyWageLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WeeklyWageLine";
CREATE POLICY tenant_isolation ON "WeeklyWageLine"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
