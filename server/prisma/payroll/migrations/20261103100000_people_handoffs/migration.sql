-- People hand-offs (30 Oct 2026): settlement holds, advances and claims in the
-- full and final, the 50% deduction limit at run time, and late-mark penalties
-- after an early cut-off. Additive: new nullable columns and two settings with
-- defaults. No new tables, so no new policies.

-- AlterTable
ALTER TABLE "FinalSettlement" ADD COLUMN "sourcesClosedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PayrollAdjustment" ADD COLUMN "carriedFromId" TEXT;
ALTER TABLE "PayrollAdjustment" ADD COLUMN "carriedByRunId" TEXT;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "deductionCap" JSONB;

-- AlterTable
ALTER TABLE "SalarySlip" ADD COLUMN "deductionNote" JSONB;

-- AlterTable
ALTER TABLE "PayrollLoanInstallment" ADD COLUMN "carriedFromId" TEXT;
ALTER TABLE "PayrollLoanInstallment" ADD COLUMN "carriedByRunId" TEXT;
ALTER TABLE "PayrollLoanInstallment" ADD COLUMN "carriedFromPeriodId" TEXT;

-- AlterTable
ALTER TABLE "PayrollSetting" ADD COLUMN "deductionCapPercent" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "PayrollSetting" ADD COLUMN "deductionCapCountsStatutory" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "PayrollAdjustment_orgId_carriedByRunId_idx" ON "PayrollAdjustment"("orgId", "carriedByRunId");

-- CreateIndex
CREATE INDEX "PayrollLoanInstallment_orgId_carriedByRunId_idx" ON "PayrollLoanInstallment"("orgId", "carriedByRunId");
