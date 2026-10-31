-- Whether late-mark penalties count toward the share of wages deductions may
-- take (review of PR #82, 30 Oct 2026). Counted by default. Additive: one
-- column with a default, no new table, so no new policy.

-- AlterTable
ALTER TABLE "PayrollSetting" ADD COLUMN "deductionCapCountsPenalties" BOOLEAN NOT NULL DEFAULT true;
