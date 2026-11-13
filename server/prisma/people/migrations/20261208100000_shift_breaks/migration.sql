-- Shifts: several breaks, fixed or taken from punches (services/attendance/breaks.ts). Additive; Shift and
-- AttendanceRecord already have row-level security, and an older API never reads these columns.
--
-- Shift.breaks: the named breaks, [{ name, startTime?, endTime?, minutes, paid }]. '[]' on every shift
--   today, which reads as the one unpaid break of "breakMinutes" each already has.
-- Shift.breakMode: FIXED (every shift today) or PUNCHED (break time comes from break out / in punches).
-- AttendanceRecord.breakMinutes: the unpaid break time taken from a day's punches. Null on every day
--   today and on any day scored with the fixed breaks.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "breaks" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "breakMode" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "breakMinutes" INTEGER;
