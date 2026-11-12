-- Attendance audit, 7 Nov 2026 (#5, #6, #11). Additive; AttendanceSettings and DevicePunch already have
-- row-level security, and an older API never reads these columns.
--
-- #5: the first day a company kept attendance on CLOR. Days before it with no record are not counted as
--     absent or loss of pay, and month close does not list them. Null (every company today) changes nothing.
-- #6: clock-in from a browser: a company switch (on, as today) and an optional address allow-list.
-- #11: a reader punch whose time is ahead of the server's is held (reviewStatus HELD) with its reason,
--      instead of writing a day in the future.
ALTER TABLE "AttendanceSettings" ADD COLUMN IF NOT EXISTS "attendanceStartDate" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN IF NOT EXISTS "webClockAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AttendanceSettings" ADD COLUMN IF NOT EXISTS "webClockIps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DevicePunch" ADD COLUMN IF NOT EXISTS "heldReason" TEXT;
