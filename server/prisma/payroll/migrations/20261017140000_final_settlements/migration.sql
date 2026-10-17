-- CreateTable
CREATE TABLE "FinalSettlement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "leavingDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "netPayable" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,

    CONSTRAINT "FinalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinalSettlement_accountId_orgId_status_idx" ON "FinalSettlement"("accountId", "orgId", "status");
-- CreateIndex
CREATE INDEX "FinalSettlement_orgId_employeeId_idx" ON "FinalSettlement"("orgId", "employeeId");
