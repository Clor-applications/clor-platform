-- At most one published price book, as a partial unique index. `prisma db
-- push` cannot build one, so the test setup applies this file as well
-- (__tests__/globalSetup.ts). Amounts are paise and never negative. Safe to
-- run twice.
CREATE UNIQUE INDEX IF NOT EXISTS "PriceBook_one_published" ON "PriceBook"("status") WHERE "status" = 'PUBLISHED';

ALTER TABLE "PlanPrice" DROP CONSTRAINT IF EXISTS "PlanPrice_amounts_sane";
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_amounts_sane" CHECK ("basePrice" >= 0 AND "extraUnitPrice" >= 0);
ALTER TABLE "PricePlan" DROP CONSTRAINT IF EXISTS "PricePlan_counts_sane";
ALTER TABLE "PricePlan" ADD CONSTRAINT "PricePlan_counts_sane" CHECK ("includedUnits" >= 1 AND "trialDays" >= 0 AND ("yearlyDiscountPct" IS NULL OR "yearlyDiscountPct" BETWEEN 0 AND 90));
