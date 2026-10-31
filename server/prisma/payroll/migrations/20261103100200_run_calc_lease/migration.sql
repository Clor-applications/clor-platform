-- Who is calculating a payroll run right now (re-review of PR #82, 30 Oct
-- 2026). The calculation held a transaction open for its whole length to
-- keep an advisory lock, and with production's payroll pool of one it waited
-- on itself. A lease on the run's own row holds no connection. Additive: two
-- nullable columns on an existing table, so no new policy.

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "calcLeaseToken" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "calcLeaseUntil" TIMESTAMP(3);
