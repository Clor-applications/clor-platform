-- Statutory registrations asked for in payroll setup (roadmap 15). Additive:
-- professional tax registration numbers by state, the Form 24Q deductor type
-- and responsible person, and when the question was answered.
ALTER TABLE "PayrollSetting" ADD COLUMN IF NOT EXISTS "ptRegistrationsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "PayrollSetting" ADD COLUMN IF NOT EXISTS "tdsDeductorType" TEXT;
ALTER TABLE "PayrollSetting" ADD COLUMN IF NOT EXISTS "tdsResponsibleName" TEXT;
ALTER TABLE "PayrollSetting" ADD COLUMN IF NOT EXISTS "tdsResponsibleDesignation" TEXT;
ALTER TABLE "PayrollSetting" ADD COLUMN IF NOT EXISTS "statutoryRegistrationsAt" TIMESTAMP(3);
