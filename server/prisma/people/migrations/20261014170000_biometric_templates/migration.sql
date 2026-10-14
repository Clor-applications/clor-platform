-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "faceMajorVer" INTEGER,
ADD COLUMN     "faceMinorVer" INTEGER,
ADD COLUMN     "faceSupported" BOOLEAN,
ADD COLUMN     "fingerSupported" BOOLEAN;

-- AlterTable
ALTER TABLE "DeviceCommand" ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 999;

-- AlterTable
ALTER TABLE "DeviceUser" ADD COLUMN     "card" TEXT,
ADD COLUMN     "password" TEXT,
ADD COLUMN     "privilege" INTEGER;

-- CreateTable
CREATE TABLE "BiometricTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "employeeId" TEXT,
    "type" INTEGER NOT NULL,
    "no" INTEGER NOT NULL DEFAULT 0,
    "data" TEXT NOT NULL,
    "valid" INTEGER NOT NULL DEFAULT 1,
    "duress" INTEGER NOT NULL DEFAULT 0,
    "majorVer" INTEGER NOT NULL DEFAULT 0,
    "minorVer" INTEGER NOT NULL DEFAULT 0,
    "format" INTEGER NOT NULL DEFAULT 0,
    "indexNo" INTEGER NOT NULL DEFAULT 0,
    "sourceDeviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiometricTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiometricTemplate_accountId_orgId_employeeId_idx" ON "BiometricTemplate"("accountId", "orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricTemplate_orgId_pin_type_no_key" ON "BiometricTemplate"("orgId", "pin", "type", "no");

-- CreateIndex
CREATE INDEX "DeviceCommand_deviceId_status_sequence_idx" ON "DeviceCommand"("deviceId", "status", "sequence");

