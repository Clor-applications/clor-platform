-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "devicePin" TEXT;

-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'both',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "firmware" TEXT,
    "ip" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevicePunch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "localTime" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "kind" TEXT,
    "verifyMode" INTEGER NOT NULL DEFAULT 0,
    "employeeId" TEXT,
    "shiftDate" TEXT,
    "raw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" SERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "returnCode" INTEGER,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceUser" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "name" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnclaimedReader" (
    "serialNumber" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "info" TEXT,

    CONSTRAINT "UnclaimedReader_pkey" PRIMARY KEY ("serialNumber")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_key" ON "AttendanceDevice"("serialNumber");

-- CreateIndex
CREATE INDEX "AttendanceDevice_accountId_orgId_idx" ON "AttendanceDevice"("accountId", "orgId");

-- CreateIndex
CREATE INDEX "DevicePunch_accountId_orgId_employeeId_shiftDate_idx" ON "DevicePunch"("accountId", "orgId", "employeeId", "shiftDate");

-- CreateIndex
CREATE INDEX "DevicePunch_orgId_deviceId_at_idx" ON "DevicePunch"("orgId", "deviceId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePunch_orgId_pin_at_key" ON "DevicePunch"("orgId", "pin", "at");

-- CreateIndex
CREATE INDEX "DeviceCommand_serialNumber_status_idx" ON "DeviceCommand"("serialNumber", "status");

-- CreateIndex
CREATE INDEX "DeviceCommand_accountId_orgId_deviceId_idx" ON "DeviceCommand"("accountId", "orgId", "deviceId");

-- CreateIndex
CREATE INDEX "DeviceUser_accountId_orgId_idx" ON "DeviceUser"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceUser_deviceId_pin_key" ON "DeviceUser"("deviceId", "pin");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_orgId_devicePin_key" ON "Employee"("orgId", "devicePin");

