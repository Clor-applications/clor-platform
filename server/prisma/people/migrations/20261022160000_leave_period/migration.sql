-- The company's leave period, and when each leave type's credits land (founder, 22 Oct 2026).
ALTER TABLE "AttendanceSettings"
  ADD COLUMN "leavePeriodStartMonth" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "leavePeriodStartDay" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LeaveType"
  ADD COLUMN "creditOn" TEXT NOT NULL DEFAULT 'START',
  ADD COLUMN "creditDay" INTEGER;
