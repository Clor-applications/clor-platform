-- A second, off-cycle payroll in the same month (an extra pay run): a late
-- joiner's days, a bonus or arrears paid between monthly payrolls.
--
-- Safe while the previous revision still serves: both columns are added with
-- a default, so its inserts (which name neither) get a regular run and a
-- salary member, exactly what they were before. Every existing run is
-- REGULAR, so the new index holds on existing data.

-- 1. What kind of run: REGULAR (the monthly payroll) or OFF_CYCLE.
ALTER TABLE "PayrollRun" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'REGULAR';

-- 2. On an off-cycle run, what a person is in it for: SALARY (their days for
--    the month, a late joiner) or EXTRA (only the amounts entered for them).
ALTER TABLE "PayrollRunEmployee" ADD COLUMN "pays" TEXT NOT NULL DEFAULT 'SALARY';

-- 3. One regular payroll per period, pay group and branch, as before; any
--    number of off-cycle runs beside it, each told apart by its own id and
--    number (PayrollRun_orgId_number_key stays unique per company). Built
--    first, then the old index dropped, so the period is never without one.
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_regular_period_key"
  ON "PayrollRun"("orgId", "periodId", "payGroupId", "branchId")
  WHERE "kind" = 'REGULAR';
DROP INDEX IF EXISTS "PayrollRun_orgId_periodId_payGroupId_branchId_key";

-- 4. Plain lookups of a period's runs by kind.
CREATE INDEX IF NOT EXISTS "PayrollRun_orgId_periodId_kind_idx" ON "PayrollRun"("orgId", "periodId", "kind");
