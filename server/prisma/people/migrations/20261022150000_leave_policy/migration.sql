-- The leave policy HR sets, and the balance ledger (founder, 22 Oct 2026).
ALTER TABLE "LeaveType"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "color" TEXT,
  ADD COLUMN "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "minNoticeDays" INTEGER,
  ADD COLUMN "maxDaysPerRequest" DOUBLE PRECISION,
  ADD COLUMN "backdatedDays" INTEGER,
  ADD COLUMN "negativeDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "employeeTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "availableAfterDays" INTEGER,
  ADD COLUMN "sandwich" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "encashable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxEncashDays" DOUBLE PRECISION;

CREATE TABLE "LeaveAdjustment" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "days" DOUBLE PRECISION NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'ADJUST',
  "reason" TEXT NOT NULL,
  "paidInRunId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeaveAdjustment_accountId_orgId_year_idx" ON "LeaveAdjustment"("accountId", "orgId", "year");
CREATE INDEX "LeaveAdjustment_orgId_employeeId_leaveTypeId_idx" ON "LeaveAdjustment"("orgId", "employeeId", "leaveTypeId");
