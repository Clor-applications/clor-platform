-- Overtime: a pay rate for each kind of day (working day, weekly off, holiday) and caps on overtime
-- hours a day, a week and a quarter (services/attendance/overtimePolicy.ts). Additive: one JSON column
-- on AttendanceSettings, which already has row-level security. '{}' reads as the defaults (every rate
-- 2, every cap off), so a company that changes nothing keeps the hours it has today. An older API
-- never reads the column.
ALTER TABLE "AttendanceSettings" ADD COLUMN IF NOT EXISTS "overtimePolicy" JSONB NOT NULL DEFAULT '{}';
