-- Opening year-to-date figures (audit 7 Nov 2026, #2): what a company paid
-- someone earlier in a financial year, before its payroll ran on CLOR, so
-- income tax for the rest of the year starts from the right place. Plus the
-- owner's "this is our first year of paying salaries" on the settings row.
-- Additive: a new table and four nullable columns. No data is changed.

-- CreateTable
CREATE TABLE "PayrollOpeningYtd" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "grossPay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxablePay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tds" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "professionalTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "employeePf" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "throughMonth" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollOpeningYtd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollOpeningYtd_accountId_orgId_financialYear_idx" ON "PayrollOpeningYtd"("accountId", "orgId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollOpeningYtd_orgId_employeeId_financialYear_key" ON "PayrollOpeningYtd"("orgId", "employeeId", "financialYear");

-- AlterTable
ALTER TABLE "PayrollSetting" ADD COLUMN "firstPayrollYear" TEXT,
ADD COLUMN "firstPayrollYearAt" TIMESTAMP(3),
ADD COLUMN "firstPayrollYearBy" TEXT,
ADD COLUMN "firstPayrollYearReason" TEXT;
