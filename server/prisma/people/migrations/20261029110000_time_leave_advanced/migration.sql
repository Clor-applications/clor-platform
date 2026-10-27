-- Time & Leave advanced build (TIME-LEAVE-DECISIONS.md "Advanced build"): entitlement rules, probation,
-- per-type workflow, request history, attendance request kinds, stand-ins, restricted holidays, year end. Additive.
ALTER TABLE "LeaveType" ADD COLUMN "entitlements" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "LeaveType" ADD COLUMN "probationRule" TEXT NOT NULL DEFAULT 'ACCRUE';
ALTER TABLE "LeaveType" ADD COLUMN "approval" TEXT;
ALTER TABLE "LeaveType" ADD COLUMN "autoApproveUpToDays" DOUBLE PRECISION;
ALTER TABLE "LeaveType" ADD COLUMN "handOnAfterDays" INTEGER;
ALTER TABLE "LeaveRequest" ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "LeaveRequest" ADD COLUMN "autoApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'MISSED_PUNCH';
ALTER TABLE "AttendanceRequest" ADD COLUMN "toDate" TEXT;
ALTER TABLE "AttendanceRequest" ADD COLUMN "place" TEXT;
ALTER TABLE "AttendanceRequest" ADD COLUMN "minutes" INTEGER;
ALTER TABLE "AttendanceRequest" ADD COLUMN "halfDay" TEXT;
ALTER TABLE "AttendanceRequest" ADD COLUMN "managerNote" TEXT;
ALTER TABLE "AttendanceRequest" ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AttendanceRecord" ADD COLUMN "dayKind" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN "attendanceRequestId" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "requestRules" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "AttendanceSettings" ADD COLUMN "restrictedHolidayQuota" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LeaveAdjustment" ADD COLUMN "workedOn" TEXT;
ALTER TABLE "LeaveAdjustment" ADD COLUMN "yearEndId" TEXT;

CREATE TABLE "ApprovalStandIn" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "managerEmployeeId" TEXT NOT NULL,
  "standInEmployeeId" TEXT NOT NULL,
  "fromDate" TEXT NOT NULL,
  "toDate" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalStandIn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApprovalStandIn_orgId_managerEmployeeId_fromDate_toDate_idx" ON "ApprovalStandIn"("orgId", "managerEmployeeId", "fromDate", "toDate");

CREATE TABLE "HolidayPick" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "holidayId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HolidayPick_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HolidayPick_employeeId_holidayId_key" ON "HolidayPick"("employeeId", "holidayId");
CREATE INDEX "HolidayPick_orgId_employeeId_year_idx" ON "HolidayPick"("orgId", "employeeId", "year");

CREATE TABLE "LeaveYearEnd" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "summaryJson" TEXT NOT NULL,
  "ranByUserId" TEXT NOT NULL,
  "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  "undoneByUserId" TEXT,
  CONSTRAINT "LeaveYearEnd_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeaveYearEnd_orgId_year_idx" ON "LeaveYearEnd"("orgId", "year");
