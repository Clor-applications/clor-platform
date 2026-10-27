-- PF nominees (EPF Form 2), filled from a checked joining form or by Payroll. Additive.
-- CreateTable
CREATE TABLE "PfNominee" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "dateOfBirth" TEXT,
    "source" TEXT NOT NULL DEFAULT 'PAYROLL',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PfNominee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PfNominee_accountId_orgId_idx" ON "PfNominee"("accountId", "orgId");

-- CreateIndex
CREATE INDEX "PfNominee_orgId_employeeId_idx" ON "PfNominee"("orgId", "employeeId");
