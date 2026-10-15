-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "geofenceId" TEXT,
ADD COLUMN     "mobilePunch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portalPasswordHash" TEXT,
ADD COLUMN     "portalPasswordSetAt" TIMESTAMP(3),
ADD COLUMN     "portalSetupExpires" TIMESTAMP(3),
ADD COLUMN     "portalSetupHash" TEXT;

-- AlterTable
ALTER TABLE "DevicePunch" ADD COLUMN     "accuracyM" DOUBLE PRECISION,
ADD COLUMN     "geofenceId" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "photoId" TEXT;

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN     "photoRetentionDays" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "Geofence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,
    "areaId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Geofence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchPhoto" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Geofence_accountId_orgId_idx" ON "Geofence"("accountId", "orgId");

-- CreateIndex
CREATE INDEX "PunchPhoto_orgId_createdAt_idx" ON "PunchPhoto"("orgId", "createdAt");

