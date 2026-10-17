-- CreateTable
CREATE TABLE "BankDetailChange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "oldAccountName" TEXT,
    "oldAccountNumber" TEXT,
    "oldIfsc" TEXT,
    "oldBankName" TEXT,
    "newAccountName" TEXT,
    "newAccountNumber" TEXT,
    "newIfsc" TEXT,
    "newBankName" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "BankDetailChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankDetailChange_accountId_orgId_status_idx" ON "BankDetailChange"("accountId", "orgId", "status");
-- CreateIndex
CREATE INDEX "BankDetailChange_orgId_employeeId_idx" ON "BankDetailChange"("orgId", "employeeId");
