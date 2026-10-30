-- Leave policy rules owners expect from Keka, Zoho and greytHR
-- (TIME-LEAVE-DECISIONS.md, "Leave policy rules"): hourly leave, over-balance
-- as loss of pay, clubbing, sandwich options, leave while serving notice; and
-- on a request, its hours and the paid request an unpaid overflow came from.
-- Half days at both ends, documents above N days and carried-day expiry are
-- main's own (startHalf/endHalf rows, attachmentAfterDays, carryExpiresAfterDays).
-- Additive only: every default keeps a type and a request as they were.
ALTER TABLE "LeaveType" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'DAY';
ALTER TABLE "LeaveType" ADD COLUMN "overBalance" TEXT NOT NULL DEFAULT 'REFUSE';
ALTER TABLE "LeaveType" ADD COLUMN "notWithTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LeaveType" ADD COLUMN "sandwichMinDays" INTEGER;
ALTER TABLE "LeaveType" ADD COLUMN "sandwichWeekOffs" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LeaveType" ADD COLUMN "sandwichHolidays" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LeaveType" ADD COLUMN "sandwichIgnoreHalf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaveType" ADD COLUMN "onNotice" TEXT NOT NULL DEFAULT 'ALLOW';

ALTER TABLE "LeaveRequest" ADD COLUMN "fromTime" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "toTime" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "minutes" INTEGER;
ALTER TABLE "LeaveRequest" ADD COLUMN "overflowOfId" TEXT;
CREATE INDEX "LeaveRequest_orgId_overflowOfId_idx" ON "LeaveRequest"("orgId", "overflowOfId");
