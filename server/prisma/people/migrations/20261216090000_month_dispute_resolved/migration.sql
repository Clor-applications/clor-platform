-- HR answers an employee's disputed month (Attendance, 13 Nov 2026). Additive; the table already has row-level security.
-- Cleared when the employee disputes the month again, so an open dispute is DISPUTED with no resolvedAt.
ALTER TABLE "AttendanceMonthConfirmation" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceMonthConfirmation" ADD COLUMN IF NOT EXISTS "resolvedByUserId" TEXT;
ALTER TABLE "AttendanceMonthConfirmation" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
