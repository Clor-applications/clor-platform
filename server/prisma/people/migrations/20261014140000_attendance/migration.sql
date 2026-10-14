-- Native attendance (after Horilla HRMS attendance + base shifts; design
-- reference only): shifts, shift assignments, holidays, daily records, clock
-- activity and correction requests. New tables only.

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "earlyOutGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,
    "fullDayMinutes" INTEGER NOT NULL DEFAULT 480,
    "overtimeAfterMinutes" INTEGER,
    "weeklyOffDays" TEXT NOT NULL DEFAULT '0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "branchId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shiftId" TEXT,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyOutMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeApproved" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "validatedByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceActivity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CLOCK',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_accountId_orgId_idx" ON "Shift"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_orgId_name_key" ON "Shift"("orgId", "name");

-- CreateIndex
CREATE INDEX "ShiftAssignment_accountId_orgId_employeeId_idx" ON "ShiftAssignment"("accountId", "orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_employeeId_effectiveFrom_key" ON "ShiftAssignment"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Holiday_accountId_orgId_date_idx" ON "Holiday"("accountId", "orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_orgId_date_name_key" ON "Holiday"("orgId", "date", "name");

-- CreateIndex
CREATE INDEX "AttendanceRecord_accountId_orgId_date_idx" ON "AttendanceRecord"("accountId", "orgId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRecord_accountId_orgId_employeeId_date_idx" ON "AttendanceRecord"("accountId", "orgId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceActivity_accountId_orgId_employeeId_at_idx" ON "AttendanceActivity"("accountId", "orgId", "employeeId", "at");

-- CreateIndex
CREATE INDEX "AttendanceRequest_accountId_orgId_status_idx" ON "AttendanceRequest"("accountId", "orgId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRequest_accountId_orgId_employeeId_date_idx" ON "AttendanceRequest"("accountId", "orgId", "employeeId", "date");
