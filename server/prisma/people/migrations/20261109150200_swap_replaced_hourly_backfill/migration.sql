-- Shift swaps: the temporary schedules a swap cut around, so cancelling puts them back (review of PR #75, blocker 1).
ALTER TABLE "ShiftSwap" ADD COLUMN IF NOT EXISTS "replacedSchedules" JSONB;

-- Hourly leave types made before "hours in a day" existed were charged an hour as a share of the
-- day's shift (its length less the break). Their day is set here to the company's default shift the
-- same way, else the standard 09:00-18:00 day less an hour (8), so they keep charging what they did
-- (review of PR #75, should-fix 6). Only types still without a value; safe to run twice.
SET clor.bypass = 'on';
UPDATE "LeaveType" lt
SET "hoursPerDay" = COALESCE((
  SELECT GREATEST(1, LEAST(24, ROUND(((
    (split_part(sh."endTime", ':', 1)::int * 60 + split_part(sh."endTime", ':', 2)::int)
    - (split_part(sh."startTime", ':', 1)::int * 60 + split_part(sh."startTime", ':', 2)::int)
    + CASE WHEN sh."endTime" <= sh."startTime" THEN 1440 ELSE 0 END
    - COALESCE(sh."breakMinutes", 0)
  ) / 60.0)::numeric, 2)))
  FROM "AttendanceSettings" s
  JOIN "Shift" sh ON sh."id" = s."defaultShiftId" AND sh."orgId" = s."orgId"
  WHERE s."orgId" = lt."orgId"
), 8)
WHERE lt."unit" = 'HOUR' AND lt."hoursPerDay" IS NULL;
RESET clor.bypass;
