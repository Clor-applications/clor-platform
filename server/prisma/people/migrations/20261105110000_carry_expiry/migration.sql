-- Carried leave that must be used in time (owner, 29 Oct 2026, from ERPNext's
-- "expire carry-forwarded leaves"): days carried into a leave period are used
-- first, and what is left of them lapses this many days after the period
-- starts. Additive and nullable: every type keeps its carried days for the
-- whole period, as before. Safe to run twice.
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "carryExpiresAfterDays" INTEGER;
