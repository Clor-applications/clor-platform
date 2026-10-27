-- How long probation runs for an employment type (Workforce audit O22). Additive; blank means not assumed.
ALTER TABLE "EmployeeType" ADD COLUMN "probationMonths" INTEGER;
