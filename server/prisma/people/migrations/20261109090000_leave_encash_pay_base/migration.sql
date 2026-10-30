-- What a paid-out leave day is worth (time depth, gap 19): the policy names
-- the monthly wages it is worked on and the days the month is divided by.
-- Additive only: every type keeps paying out as before until HR sends one.
ALTER TABLE "LeaveType" ADD COLUMN "encashBase" TEXT NOT NULL DEFAULT 'BASIC_DA';
ALTER TABLE "LeaveType" ADD COLUMN "encashDivisor" INTEGER NOT NULL DEFAULT 26;
