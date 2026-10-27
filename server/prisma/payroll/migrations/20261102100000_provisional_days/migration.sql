-- Provisional days (closure audit O-11, TLA-004): a run paid before the month ends counts the days after the cut-off as present, and the next month corrects them. Additive.
-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "provisionalDays" JSONB;

-- AlterTable
ALTER TABLE "PayrollInput" ADD COLUMN "provisionalDays" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollInput" ADD COLUMN "provisionalDates" JSONB;
ALTER TABLE "PayrollInput" ADD COLUMN "provisionalSettledByRunId" TEXT;

-- CreateTable
CREATE TABLE "PayrollSetting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provisionalCutoffDay" INTEGER NOT NULL DEFAULT 25,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSetting_orgId_key" ON "PayrollSetting"("orgId");

-- CreateIndex
CREATE INDEX "PayrollSetting_accountId_orgId_idx" ON "PayrollSetting"("accountId", "orgId");
