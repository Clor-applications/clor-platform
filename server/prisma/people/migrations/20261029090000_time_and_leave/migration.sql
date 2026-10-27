-- Time & Leave (People): private leave types, linked parts of leave across a period end, the company's working week. Additive.
ALTER TABLE "LeaveType" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaveRequest" ADD COLUMN "groupId" TEXT;
CREATE INDEX "LeaveRequest_orgId_fromDate_toDate_idx" ON "LeaveRequest"("orgId", "fromDate", "toDate");
ALTER TABLE "AttendanceSettings" ADD COLUMN "weeklyOffDays" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "AttendanceSettings" ADD COLUMN "offSaturdays" TEXT NOT NULL DEFAULT '';
