-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "code" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "offSaturdays" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ShiftAssignment" ADD COLUMN     "effectiveTo" TEXT;

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "areaId" TEXT;

-- CreateTable
CREATE TABLE "TemporarySchedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemporarySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentSchedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 7,
    "anchorDate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "slotOffset" INTEGER NOT NULL DEFAULT 0,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "defaultShiftId" TEXT,
    "lateAllowancePerMonth" INTEGER NOT NULL DEFAULT 0,
    "latePenaltyEvery" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemporarySchedule_accountId_orgId_employeeId_fromDate_idx" ON "TemporarySchedule"("accountId", "orgId", "employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "DepartmentSchedule_accountId_orgId_idx" ON "DepartmentSchedule"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentSchedule_departmentId_effectiveFrom_key" ON "DepartmentSchedule"("departmentId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShiftRotation_accountId_orgId_idx" ON "ShiftRotation"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotation_orgId_name_key" ON "ShiftRotation"("orgId", "name");

-- CreateIndex
CREATE INDEX "RotationAssignment_accountId_orgId_rotationId_idx" ON "RotationAssignment"("accountId", "orgId", "rotationId");

-- CreateIndex
CREATE UNIQUE INDEX "RotationAssignment_employeeId_rotationId_startsOn_key" ON "RotationAssignment"("employeeId", "rotationId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSettings_orgId_key" ON "AttendanceSettings"("orgId");

