-- Professional tax and Labour Welfare Fund for every levying state.
-- Additive: nullable columns and settings with defaults. No figures change
-- here; the new rules reach existing companies through the seed step
-- (services/payroll/statutory/resolve.ts ensureStatutoryCatalogue), which
-- never touches a version a company published itself.

-- AlterTable: where a rule's figures come from, who made it, and whether a
-- rule CLOR could not confirm has been checked against the state's notice.
ALTER TABLE "StatutoryRule" ADD COLUMN "note" TEXT;
ALTER TABLE "StatutoryRule" ADD COLUMN "origin" TEXT;
ALTER TABLE "StatutoryRule" ADD COLUMN "checkedAt" TIMESTAMP(3);
ALTER TABLE "StatutoryRule" ADD COLUMN "checkedByUserId" TEXT;

-- AlterTable: LWF size thresholds and managerial exclusions, per company.
ALTER TABLE "PayrollSetting" ADD COLUMN "lwfCoverage" TEXT NOT NULL DEFAULT 'BY_HEADCOUNT';
ALTER TABLE "PayrollSetting" ADD COLUMN "lwfManagerDesignations" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "PayrollSetting" ADD COLUMN "statutoryCatalogue" TEXT;
