-- At most one active payment provider, as a partial unique index. `prisma db
-- push` cannot build one, so the test setup applies this file as well
-- (__tests__/globalSetup.ts). An active provider is an enabled one. Safe to
-- run twice.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentProvider_one_active" ON "PaymentProvider"("active") WHERE "active" = true;

ALTER TABLE "PaymentProvider" DROP CONSTRAINT IF EXISTS "PaymentProvider_sane";
ALTER TABLE "PaymentProvider" ADD CONSTRAINT "PaymentProvider_sane" CHECK ("code" IN ('cashfree', 'razorpay', 'manual') AND "mode" IN ('TEST', 'LIVE') AND (NOT "active" OR "enabled"));
