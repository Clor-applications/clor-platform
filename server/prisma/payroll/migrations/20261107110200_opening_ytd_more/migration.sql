-- Opening year-to-date figures, review of #146 (items 4 and 6). Additive:
-- three amounts Form 16 and the monthly TDS need (Basic and DA, HRA received,
-- employer NPS), and a removal time, so removing someone's figures is a
-- change a calculated payroll can see rather than a row that vanishes.
ALTER TABLE "PayrollOpeningYtd" ADD COLUMN IF NOT EXISTS "basicDa" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollOpeningYtd" ADD COLUMN IF NOT EXISTS "hraReceived" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollOpeningYtd" ADD COLUMN IF NOT EXISTS "employerNps" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollOpeningYtd" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
