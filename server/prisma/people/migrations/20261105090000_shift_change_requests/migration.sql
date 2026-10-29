-- Shift change requests (owner, 29 Oct 2026, from ERPNext's Shift Request): a
-- person asks to work another shift for some days; approved, it is kept as a
-- temporary schedule, which wins over every other schedule for those days.
-- Additive and nullable: every request already saved keeps null. Safe to run
-- twice.
ALTER TABLE "AttendanceRequest" ADD COLUMN IF NOT EXISTS "shiftId" TEXT;
ALTER TABLE "AttendanceRequest" ADD COLUMN IF NOT EXISTS "temporaryScheduleId" TEXT;
