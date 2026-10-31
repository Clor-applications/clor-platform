-- What an advance had recovered when People sent its recovery to Payroll
-- (re-review of PR #82, 31 Oct 2026), so People's figures are worked out
-- from the recovery's rows alone and a correction or a cut cannot be counted
-- twice. Additive: one nullable column on an existing table, no new policy.

-- AlterTable
ALTER TABLE "PayrollAdjustment" ADD COLUMN "recoveryBase" DECIMAL(65,30);
