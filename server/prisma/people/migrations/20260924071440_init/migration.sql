-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "dateOfJoining" TEXT,
    "dateOfLeaving" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_accountId_orgId_status_idx" ON "Employee"("accountId", "orgId", "status");

-- CreateIndex
CREATE INDEX "Employee_accountId_orgId_branchId_idx" ON "Employee"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_orgId_code_key" ON "Employee"("orgId", "code");
