-- CreateTable
CREATE TABLE "EmployeePayrollProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollStatus" TEXT NOT NULL DEFAULT 'IN_PAYROLL',
    "payGroupId" TEXT,
    "costCenterId" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "pan" TEXT,
    "uan" TEXT,
    "pfNumber" TEXT,
    "esiNumber" TEXT,
    "taxRegime" TEXT NOT NULL DEFAULT 'NEW',
    "professionalTaxState" TEXT,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT false,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "ptApplicable" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayGroup" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "paymentDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "paymentDate" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "fiscalYearId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryComponent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "calculationMethod" TEXT NOT NULL DEFAULT 'FIXED',
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "percentage" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "formula" TEXT,
    "calculationBase" TEXT,
    "rounding" TEXT NOT NULL DEFAULT 'NEAREST',
    "statutoryScheme" TEXT,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "prorate" BOOLEAN NOT NULL DEFAULT true,
    "includeInPfWage" BOOLEAN NOT NULL DEFAULT false,
    "includeInEsiWage" BOOLEAN NOT NULL DEFAULT false,
    "includeInGratuityWage" BOOLEAN NOT NULL DEFAULT false,
    "includeInGross" BOOLEAN NOT NULL DEFAULT true,
    "includeInNetPay" BOOLEAN NOT NULL DEFAULT true,
    "isVariable" BOOLEAN NOT NULL DEFAULT false,
    "isFlexibleBenefit" BOOLEAN NOT NULL DEFAULT false,
    "expenseLedgerId" TEXT,
    "liabilityLedgerId" TEXT,
    "costCentreBehaviour" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "payGroupId" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructureComponent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "calculationMethod" TEXT,
    "amount" DECIMAL(65,30),
    "percentage" DECIMAL(65,30),
    "formula" TEXT,
    "calculationBase" TEXT,
    "isBalancing" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructureComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "payGroupId" TEXT,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "annualCtc" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "monthlyCtc" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "costCenterId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revisionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "currentAssignmentId" TEXT,
    "currentStructureId" TEXT,
    "currentAnnualCtc" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "proposedStructureId" TEXT NOT NULL,
    "proposedAnnualCtc" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "incrementPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "effectiveFrom" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "impactJson" TEXT NOT NULL DEFAULT '{}',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAssignmentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "consumedByRunId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "number" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "payGroupId" TEXT,
    "department" TEXT,
    "payrollDate" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deductionTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "employerContributionTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "employerCostTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "engineVersion" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunEmployee" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "inclusion" TEXT NOT NULL DEFAULT 'INCLUDED',
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "assignmentId" TEXT,
    "issuesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRunEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollInput" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workingDays" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "payableDays" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lwpDays" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overtimeAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "variablePay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalarySlip" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "number" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "payrollDate" TEXT NOT NULL,
    "grossEarnings" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "employerContributions" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "previousNetPay" DECIMAL(65,30),
    "variancePercent" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "employeeSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "assignmentSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "structureSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "inputSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "adjustmentSnapshotJson" TEXT NOT NULL DEFAULT '[]',
    "statutorySnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "engineVersion" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalarySlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalarySlipLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fullAmount" DECIMAL(65,30),
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "expenseLedgerId" TEXT,
    "liabilityLedgerId" TEXT,
    "costCenterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalarySlipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCalculationTrace" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "componentId" TEXT,
    "componentCode" TEXT NOT NULL,
    "baseLabel" TEXT,
    "baseAmount" DECIMAL(65,30),
    "ruleText" TEXT,
    "formula" TEXT,
    "computedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "prorationFactor" DECIMAL(65,30),
    "roundingApplied" DECIMAL(65,30),
    "statutoryRuleId" TEXT,
    "statutoryRuleVersion" TEXT,
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollCalculationTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLoan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "number" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LOAN',
    "principal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "interestRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "startDate" TEXT NOT NULL,
    "recoveryStartPeriodId" TEXT,
    "installmentCount" INTEGER NOT NULL DEFAULT 0,
    "installmentAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "outstandingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "recoveryComponentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLoanInstallment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "periodId" TEXT,
    "sequence" INTEGER NOT NULL,
    "dueAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "principalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "slipId" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLoanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryScheme" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "registrationNumber" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatutoryScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "version" TEXT NOT NULL,
    "employeeRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "employerRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "wageCeiling" DECIMAL(65,30),
    "eligibilityThreshold" DECIMAL(65,30),
    "rounding" TEXT NOT NULL DEFAULT 'NEAREST',
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatutoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeStatutoryConfig" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "schemeCode" TEXT NOT NULL,
    "isApplicable" BOOLEAN NOT NULL DEFAULT true,
    "overrideEmployeeRate" DECIMAL(65,30),
    "overrideEmployerRate" DECIMAL(65,30),
    "jurisdiction" TEXT,
    "effectiveFrom" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeStatutoryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "number" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "paymentDate" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "ledgerAccountId" TEXT,
    "reference" TEXT,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "journalEntryId" TEXT,
    "postingStatus" TEXT NOT NULL DEFAULT 'UNPOSTED',
    "postedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPosting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "postingDate" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "totalDebit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reversedByEntryId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPostingLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "ledgerName" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "costCenterId" TEXT,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPostingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeePayrollProfile_accountId_orgId_payrollStatus_idx" ON "EmployeePayrollProfile"("accountId", "orgId", "payrollStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayrollProfile_orgId_employeeId_key" ON "EmployeePayrollProfile"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "PayGroup_accountId_orgId_isActive_idx" ON "PayGroup"("accountId", "orgId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PayGroup_orgId_name_key" ON "PayGroup"("orgId", "name");

-- CreateIndex
CREATE INDEX "PayrollPeriod_accountId_orgId_startDate_idx" ON "PayrollPeriod"("accountId", "orgId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_orgId_name_key" ON "PayrollPeriod"("orgId", "name");

-- CreateIndex
CREATE INDEX "SalaryComponent_accountId_orgId_type_isActive_idx" ON "SalaryComponent"("accountId", "orgId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryComponent_orgId_code_key" ON "SalaryComponent"("orgId", "code");

-- CreateIndex
CREATE INDEX "SalaryStructure_accountId_orgId_status_idx" ON "SalaryStructure"("accountId", "orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_orgId_name_effectiveFrom_key" ON "SalaryStructure"("orgId", "name", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryStructureComponent_accountId_orgId_idx" ON "SalaryStructureComponent"("accountId", "orgId");

-- CreateIndex
CREATE INDEX "SalaryStructureComponent_structureId_idx" ON "SalaryStructureComponent"("structureId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructureComponent_structureId_componentId_key" ON "SalaryStructureComponent"("structureId", "componentId");

-- CreateIndex
CREATE INDEX "SalaryAssignment_accountId_orgId_employeeId_effectiveFrom_idx" ON "SalaryAssignment"("accountId", "orgId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryAssignment_accountId_orgId_status_idx" ON "SalaryAssignment"("accountId", "orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAssignment_orgId_employeeId_effectiveFrom_key" ON "SalaryAssignment"("orgId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryRevision_accountId_orgId_employeeId_idx" ON "SalaryRevision"("accountId", "orgId", "employeeId");

-- CreateIndex
CREATE INDEX "SalaryRevision_accountId_orgId_status_idx" ON "SalaryRevision"("accountId", "orgId", "status");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_accountId_orgId_periodId_status_idx" ON "PayrollAdjustment"("accountId", "orgId", "periodId", "status");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_accountId_orgId_employeeId_periodId_idx" ON "PayrollAdjustment"("accountId", "orgId", "employeeId", "periodId");

-- CreateIndex
CREATE INDEX "PayrollRun_accountId_orgId_status_idx" ON "PayrollRun"("accountId", "orgId", "status");

-- CreateIndex
CREATE INDEX "PayrollRun_accountId_orgId_periodId_idx" ON "PayrollRun"("accountId", "orgId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_orgId_number_key" ON "PayrollRun"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_orgId_periodId_payGroupId_branchId_key" ON "PayrollRun"("orgId", "periodId", "payGroupId", "branchId");

-- CreateIndex
CREATE INDEX "PayrollRunEmployee_accountId_orgId_runId_state_idx" ON "PayrollRunEmployee"("accountId", "orgId", "runId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunEmployee_runId_employeeId_key" ON "PayrollRunEmployee"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollInput_accountId_orgId_runId_idx" ON "PayrollInput"("accountId", "orgId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollInput_runId_employeeId_key" ON "PayrollInput"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "SalarySlip_accountId_orgId_employeeId_periodId_idx" ON "SalarySlip"("accountId", "orgId", "employeeId", "periodId");

-- CreateIndex
CREATE INDEX "SalarySlip_accountId_orgId_status_idx" ON "SalarySlip"("accountId", "orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalarySlip_orgId_number_key" ON "SalarySlip"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SalarySlip_runId_employeeId_key" ON "SalarySlip"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "SalarySlipLine_accountId_orgId_slipId_idx" ON "SalarySlipLine"("accountId", "orgId", "slipId");

-- CreateIndex
CREATE INDEX "SalarySlipLine_slipId_idx" ON "SalarySlipLine"("slipId");

-- CreateIndex
CREATE INDEX "PayrollCalculationTrace_accountId_orgId_slipId_idx" ON "PayrollCalculationTrace"("accountId", "orgId", "slipId");

-- CreateIndex
CREATE INDEX "PayrollCalculationTrace_slipId_idx" ON "PayrollCalculationTrace"("slipId");

-- CreateIndex
CREATE INDEX "PayrollLoan_accountId_orgId_employeeId_status_idx" ON "PayrollLoan"("accountId", "orgId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLoan_orgId_number_key" ON "PayrollLoan"("orgId", "number");

-- CreateIndex
CREATE INDEX "PayrollLoanInstallment_accountId_orgId_loanId_status_idx" ON "PayrollLoanInstallment"("accountId", "orgId", "loanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLoanInstallment_loanId_sequence_key" ON "PayrollLoanInstallment"("loanId", "sequence");

-- CreateIndex
CREATE INDEX "StatutoryScheme_accountId_orgId_isEnabled_idx" ON "StatutoryScheme"("accountId", "orgId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryScheme_orgId_code_key" ON "StatutoryScheme"("orgId", "code");

-- CreateIndex
CREATE INDEX "StatutoryRule_accountId_orgId_schemeId_status_idx" ON "StatutoryRule"("accountId", "orgId", "schemeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryRule_schemeId_jurisdiction_effectiveFrom_version_key" ON "StatutoryRule"("schemeId", "jurisdiction", "effectiveFrom", "version");

-- CreateIndex
CREATE INDEX "EmployeeStatutoryConfig_accountId_orgId_schemeCode_idx" ON "EmployeeStatutoryConfig"("accountId", "orgId", "schemeCode");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeStatutoryConfig_orgId_employeeId_schemeCode_key" ON "EmployeeStatutoryConfig"("orgId", "employeeId", "schemeCode");

-- CreateIndex
CREATE INDEX "PayrollPayment_accountId_orgId_runId_status_idx" ON "PayrollPayment"("accountId", "orgId", "runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_orgId_number_key" ON "PayrollPayment"("orgId", "number");

-- CreateIndex
CREATE INDEX "PayrollPaymentLine_accountId_orgId_paymentId_status_idx" ON "PayrollPaymentLine"("accountId", "orgId", "paymentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentLine_paymentId_slipId_key" ON "PayrollPaymentLine"("paymentId", "slipId");

-- CreateIndex
CREATE INDEX "PayrollPosting_accountId_orgId_status_idx" ON "PayrollPosting"("accountId", "orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPosting_orgId_runId_key" ON "PayrollPosting"("orgId", "runId");

-- CreateIndex
CREATE INDEX "PayrollPostingLine_accountId_orgId_postingId_idx" ON "PayrollPostingLine"("accountId", "orgId", "postingId");

-- CreateIndex
CREATE INDEX "PayrollPostingLine_postingId_idx" ON "PayrollPostingLine"("postingId");

-- AddForeignKey
ALTER TABLE "SalaryStructureComponent" ADD CONSTRAINT "SalaryStructureComponent_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "SalaryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunEmployee" ADD CONSTRAINT "PayrollRunEmployee_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlip" ADD CONSTRAINT "SalarySlip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlipLine" ADD CONSTRAINT "SalarySlipLine_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "SalarySlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCalculationTrace" ADD CONSTRAINT "PayrollCalculationTrace_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "SalarySlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLoanInstallment" ADD CONSTRAINT "PayrollLoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "PayrollLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatutoryRule" ADD CONSTRAINT "StatutoryRule_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "StatutoryScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentLine" ADD CONSTRAINT "PayrollPaymentLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PayrollPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPostingLine" ADD CONSTRAINT "PayrollPostingLine_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "PayrollPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
