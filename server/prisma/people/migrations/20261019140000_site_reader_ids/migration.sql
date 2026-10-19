-- Reader IDs per site: a person's ID at one site's readers, and punches and
-- templates keyed so two sites can reuse an ID for different people.

CREATE TABLE "ReaderIdAtSite" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReaderIdAtSite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReaderIdAtSite_orgId_areaId_pin_key" ON "ReaderIdAtSite"("orgId", "areaId", "pin");
CREATE UNIQUE INDEX "ReaderIdAtSite_orgId_areaId_employeeId_key" ON "ReaderIdAtSite"("orgId", "areaId", "employeeId");
CREATE INDEX "ReaderIdAtSite_orgId_employeeId_idx" ON "ReaderIdAtSite"("orgId", "employeeId");

DROP INDEX IF EXISTS "DevicePunch_orgId_pin_at_key";
CREATE UNIQUE INDEX "DevicePunch_orgId_deviceId_pin_at_key" ON "DevicePunch"("orgId", "deviceId", "pin", "at");
CREATE INDEX "DevicePunch_orgId_employeeId_at_idx" ON "DevicePunch"("orgId", "employeeId", "at");

ALTER TABLE "BiometricTemplate" ADD COLUMN "scope" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "BiometricTemplate_orgId_pin_type_no_key";
CREATE UNIQUE INDEX "BiometricTemplate_orgId_scope_pin_type_no_key" ON "BiometricTemplate"("orgId", "scope", "pin", "type", "no");
