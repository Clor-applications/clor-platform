-- Expense claims with advances, and salary advances asked from the employee app
-- (WORKFLOW-GAP-RESEARCH 30 Oct 2026, 4.1 and 4.2). New tables only; safe to run twice.

CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limitPerBill" DECIMAL(12,2),
    "creditBlocked" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseCategory_orgId_name_key" ON "ExpenseCategory"("orgId", "name");

CREATE TABLE IF NOT EXISTS "ExpenseBill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpenseBill_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExpenseBill_orgId_employeeId_idx" ON "ExpenseBill"("orgId", "employeeId");
CREATE INDEX IF NOT EXISTS "ExpenseBill_orgId_sha256_idx" ON "ExpenseBill"("orgId", "sha256");

CREATE TABLE IF NOT EXISTS "ExpenseClaim" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "advanceId" TEXT,
    "approvalRequestId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "claimedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "approvedTotal" DECIMAL(12,2),
    "advanceSettled" DECIMAL(12,2),
    "payMode" TEXT,
    "paidOn" TEXT,
    "paidMethod" TEXT,
    "paidReference" TEXT,
    "paidByUserId" TEXT,
    "payrollAdjustmentId" TEXT,
    "payrollPeriodName" TEXT,
    "booksStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseClaim_orgId_number_key" ON "ExpenseClaim"("orgId", "number");
CREATE INDEX IF NOT EXISTS "ExpenseClaim_orgId_employeeId_status_idx" ON "ExpenseClaim"("orgId", "employeeId", "status");
CREATE INDEX IF NOT EXISTS "ExpenseClaim_orgId_status_idx" ON "ExpenseClaim"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ExpenseClaim_orgId_approvalRequestId_idx" ON "ExpenseClaim"("orgId", "approvalRequestId");

CREATE TABLE IF NOT EXISTS "ExpenseLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "spentOn" TEXT NOT NULL,
    "categoryId" TEXT,
    "categoryName" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "approvedAmount" DECIMAL(12,2),
    "cutReason" TEXT,
    "note" TEXT,
    "billId" TEXT,
    "companyGstin" BOOLEAN NOT NULL DEFAULT false,
    "supplierGstin" TEXT,
    "taxAmount" DECIMAL(12,2),
    "duplicateOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExpenseLine_orgId_claimId_idx" ON "ExpenseLine"("orgId", "claimId");
CREATE INDEX IF NOT EXISTS "ExpenseLine_orgId_employeeId_spentOn_idx" ON "ExpenseLine"("orgId", "employeeId", "spentOn");
DO $$ BEGIN
  ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EmployeeAdvance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "neededBy" TEXT,
    "settleBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "approvalRequestId" TEXT,
    "paidOn" TEXT,
    "paidMethod" TEXT,
    "paidReference" TEXT,
    "paidByUserId" TEXT,
    "booksStatus" TEXT,
    "settledAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returnedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "recoveredAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payrollAdjustmentId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeAdvance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeAdvance_orgId_number_key" ON "EmployeeAdvance"("orgId", "number");
CREATE INDEX IF NOT EXISTS "EmployeeAdvance_orgId_employeeId_status_idx" ON "EmployeeAdvance"("orgId", "employeeId", "status");
CREATE INDEX IF NOT EXISTS "EmployeeAdvance_orgId_status_idx" ON "EmployeeAdvance"("orgId", "status");

CREATE TABLE IF NOT EXISTS "SalaryAdvanceAsk" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "approvalRequestId" TEXT,
    "loanId" TEXT,
    "payrollNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryAdvanceAsk_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SalaryAdvanceAsk_orgId_employeeId_status_idx" ON "SalaryAdvanceAsk"("orgId", "employeeId", "status");
CREATE INDEX IF NOT EXISTS "SalaryAdvanceAsk_orgId_status_idx" ON "SalaryAdvanceAsk"("orgId", "status");
