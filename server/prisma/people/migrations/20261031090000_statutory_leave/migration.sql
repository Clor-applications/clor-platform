-- Statutory leave, opt-in per leave type (TIME-LEAVE-MARKET-RESEARCH.md G1-G3): earned leave by days worked,
-- the OSH Code carry-forward, calendar-day counting and days-worked eligibility (maternity).
-- Additive: every default keeps an existing type working as it did, so no balance changes.
ALTER TABLE "LeaveType" ADD COLUMN "accrualBasis" TEXT NOT NULL DEFAULT 'CALENDAR';
ALTER TABLE "LeaveType" ADD COLUMN "perDaysWorked" DOUBLE PRECISION;
ALTER TABLE "LeaveType" ADD COLUMN "minDaysWorked" DOUBLE PRECISION;
ALTER TABLE "LeaveType" ADD COLUMN "oshCarry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaveType" ADD COLUMN "countsCalendarDays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaveType" ADD COLUMN "availableAfterBasis" TEXT NOT NULL DEFAULT 'JOINING';
