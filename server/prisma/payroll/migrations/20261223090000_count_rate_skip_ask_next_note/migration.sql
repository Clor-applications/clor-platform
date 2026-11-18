-- Count × rate on adjustments and payslip lines, an employee's ask to skip a loan instalment, and a note for next month's run (server picks batch 2). Additive.
ALTER TABLE "PayrollAdjustment" ADD COLUMN "quantity" DECIMAL(65,30);
ALTER TABLE "PayrollAdjustment" ADD COLUMN "rate" DECIMAL(65,30);
ALTER TABLE "PayrollAdjustment" ADD COLUMN "unit" TEXT;
ALTER TABLE "SalarySlipLine" ADD COLUMN "quantity" DECIMAL(65,30);
ALTER TABLE "SalarySlipLine" ADD COLUMN "rate" DECIMAL(65,30);
ALTER TABLE "SalarySlipLine" ADD COLUMN "unit" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "noteForNext" TEXT;
ALTER TABLE "PayrollLoanInstallment" ADD COLUMN "skipAskedAt" TIMESTAMP(3);
ALTER TABLE "PayrollLoanInstallment" ADD COLUMN "skipAskedReason" TEXT;
ALTER TABLE "PayrollLoanInstallment" ADD COLUMN "skipAskedByUserId" TEXT;
