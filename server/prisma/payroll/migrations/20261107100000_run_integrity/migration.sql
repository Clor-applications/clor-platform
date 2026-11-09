-- Payroll run integrity (audit 7 Nov 2026, #3 and #5).
--
-- 1. PayrollRun.statutoryWaiver: the owner's record that a statutory scheme on
--    the payslips does not apply to the company (PF under 20 people, ESI under
--    10, a state's LWF headcount), given against one calculation. Additive and
--    nullable; an older API never reads it.
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "statutoryWaiver" JSONB;

-- 2. One live payment per payslip, held by the database and not only by the
--    read before the write (payment.ts createPayment), which two batches made
--    at the same moment could both pass: two bank files for one salary.
--
--    A line is live while it is PENDING or PAID. A FAILED line has released its
--    slip for the next batch. Lines of a cancelled batch were left PENDING, so
--    they are marked CANCELLED first (the batch's cancel now does the same);
--    nothing was paid on them, since a batch with a paid line cannot be cancelled.
--
--    SQL only: Prisma cannot express a partial index, so schema.prisma carries a
--    comment and server/src/__tests__/globalSetup.ts replays this file after
--    `prisma db push`.
--
--    PayrollPaymentLine forces row-level security, so without the bypass the
--    owner (clor_app at API start) would see no rows and change nothing.
SET clor.bypass = 'on';

UPDATE "PayrollPaymentLine" l
SET "status" = 'CANCELLED'
FROM "PayrollPayment" p
WHERE p."id" = l."paymentId" AND p."status" = 'CANCELLED' AND l."status" = 'PENDING';

-- A payslip already in two live batches is money somebody has to sort out by
-- hand (one of the two files must not be sent); a migration cannot choose which.
-- Then the index is not built and the API still starts: the payment service's
-- own check, now under a lock per payroll, keeps a third from being made, and a
-- warning gives the count. Clean data, the usual case, gets the index.
DO $$
DECLARE dupes integer;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT "slipId" FROM "PayrollPaymentLine" WHERE "status" IN ('PENDING', 'PAID') GROUP BY "slipId" HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE WARNING 'PayrollPaymentLine_live_slip_key not built: % payslip(s) are in two live salary payments. Cancel the extra batch, then build the index by hand (see this migration).', dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPaymentLine_live_slip_key" ON "PayrollPaymentLine"("slipId") WHERE "status" IN ('PENDING', 'PAID');
  END IF;
END $$;

RESET clor.bypass;
