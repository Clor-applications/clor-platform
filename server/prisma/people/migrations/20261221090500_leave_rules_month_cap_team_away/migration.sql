-- Leave type rules (round 42 picks, 18 Nov 2026). Additive; both null by default, so every type stays as it was.
-- maxDaysPerMonth: most days of the type in one calendar month (work from home style).
-- teamAwayWarnAt: warn on the form when this many of the team are already away on those days.
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "maxDaysPerMonth" DOUBLE PRECISION;
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "teamAwayWarnAt" INTEGER;
