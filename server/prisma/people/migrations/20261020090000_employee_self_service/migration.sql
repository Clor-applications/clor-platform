-- Employee self-service: month confirmation, overtime and comp-off requests.
ALTER TABLE "AttendanceSettings" ADD COLUMN "confirmCutoffDay" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "AttendanceSettings" ADD COLUMN "overtimeRequests" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AttendanceSettings" ADD COLUMN "compOffEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceSettings" ADD COLUMN "compOffLeaveTypeId" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "overtimeApproval" TEXT NOT NULL DEFAULT 'HR';

CREATE TABLE "AttendanceMonthConfirmation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "unresolved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceMonthConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttendanceMonthConfirmation_orgId_employeeId_month_key" ON "AttendanceMonthConfirmation"("orgId", "employeeId", "month");
CREATE INDEX "AttendanceMonthConfirmation_orgId_month_idx" ON "AttendanceMonthConfirmation"("orgId", "month");

CREATE TABLE "OvertimeRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "managerApprovedAt" TIMESTAMP(3),
    "managerApprovedById" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OvertimeRequest_orgId_status_idx" ON "OvertimeRequest"("orgId", "status");
CREATE INDEX "OvertimeRequest_orgId_employeeId_date_idx" ON "OvertimeRequest"("orgId", "employeeId", "date");
