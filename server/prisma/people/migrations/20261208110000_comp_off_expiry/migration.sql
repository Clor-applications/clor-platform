-- Comp-off that expires (services/attendance/compOff.ts). Additive; LeaveType and LeaveAdjustment already
-- have row-level security, and an older API never reads these columns.
--
-- LeaveType.compOffValidDays: how many days comp-off credited to the type lasts, from the day worked.
--   Null on every type today: comp-off does not expire, as before.
-- LeaveAdjustment.expiresOn: the last day a comp-off grant can be used. Null on every grant today, so
--   nothing already earned ever lapses.
-- LeaveAdjustment.lapsedAt / lapsedDays: set by the leave job when it lapses what is left of a grant
--   (the days come back out through a row of kind LAPSE).
-- LeaveAdjustment.expiryRemindedAt: the person was told, a week before.
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "compOffValidDays" INTEGER;
ALTER TABLE "LeaveAdjustment" ADD COLUMN IF NOT EXISTS "expiresOn" TEXT;
ALTER TABLE "LeaveAdjustment" ADD COLUMN IF NOT EXISTS "lapsedAt" TIMESTAMP(3);
ALTER TABLE "LeaveAdjustment" ADD COLUMN IF NOT EXISTS "lapsedDays" DOUBLE PRECISION;
ALTER TABLE "LeaveAdjustment" ADD COLUMN IF NOT EXISTS "expiryRemindedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "LeaveAdjustment_expiresOn_idx" ON "LeaveAdjustment" ("expiresOn");
