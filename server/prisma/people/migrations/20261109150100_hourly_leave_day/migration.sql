-- Hourly leave said in hours (FEATURE-UI-AUDIT gap 23): an hourly type's day, in
-- hours. Its allowance and balance are kept in days as before and shown in hours
-- with this; an hour of leave is 1/hoursPerDay of a day. Null reads as 8.
-- Additive only: existing types keep working unchanged.
ALTER TABLE "LeaveType" ADD COLUMN "hoursPerDay" DOUBLE PRECISION;
