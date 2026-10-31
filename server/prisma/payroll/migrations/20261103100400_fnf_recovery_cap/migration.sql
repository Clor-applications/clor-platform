-- Full and final recovery limit (owner, 31 Oct 2026): loans and advances come
-- off a leaver's final pay only up to a share (50% by default, never more) of
-- the final wages (Code on Wages 2019 s.18(3)); the rest stays owed by the
-- person. Additive: one setting with a default and one nullable column. No
-- data is changed: paid settlements keep their figures, and a settlement made
-- before this is held to the limit when it is approved or paid.

-- AlterTable
ALTER TABLE "PayrollSetting" ADD COLUMN "fnfRecoveryCapPercent" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "FinalSettlement" ADD COLUMN "recoveryCap" JSONB;
