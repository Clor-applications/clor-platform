-- Overtime hours at each day's rate from the company's overtime policy (audit, 17 Nov 2026). Additive.
ALTER TABLE "PayrollInput" ADD COLUMN "overtimeHoursAtRate" DECIMAL(65,30);
