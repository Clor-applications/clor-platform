-- A working-week change made from a date (closure audit O-05): the weeks
-- before it are kept here, so closed months keep the week they were worked out
-- with. Additive and nullable; null = the current week has always applied.
ALTER TABLE "AttendanceSettings" ADD COLUMN "workingWeekEarlier" JSONB;
