-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "clockCheckedAt" TIMESTAMP(3),
ADD COLUMN     "clockOffsetSec" INTEGER,
ADD COLUMN     "faceCount" INTEGER,
ADD COLUMN     "fingerCount" INTEGER,
ADD COLUMN     "infoAt" TIMESTAMP(3),
ADD COLUMN     "mac" TEXT,
ADD COLUMN     "maxFaces" INTEGER,
ADD COLUMN     "maxFingers" INTEGER,
ADD COLUMN     "maxPunches" INTEGER,
ADD COLUMN     "maxUsers" INTEGER,
ADD COLUMN     "punchCount" INTEGER,
ADD COLUMN     "userCount" INTEGER;

-- AlterTable
ALTER TABLE "DeviceCommand" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT;

-- AlterTable
ALTER TABLE "DeviceUser" ADD COLUMN     "face" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fingers" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN     "alertEmails" TEXT,
ADD COLUMN     "noPunchAfterHour" INTEGER NOT NULL DEFAULT 11,
ADD COLUMN     "offlineAlertMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "ReaderAlert" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "deviceId" TEXT,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "resolvedNotifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReaderAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReaderAlert_orgId_resolvedAt_idx" ON "ReaderAlert"("orgId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReaderAlert_orgId_key_resolvedAt_idx" ON "ReaderAlert"("orgId", "key", "resolvedAt");

