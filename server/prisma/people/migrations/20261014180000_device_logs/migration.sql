-- CreateTable
CREATE TABLE "DeviceLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "operator" TEXT,
    "localTime" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceLog_accountId_orgId_deviceId_localTime_idx" ON "DeviceLog"("accountId", "orgId", "deviceId", "localTime");

-- CreateIndex
CREATE INDEX "DeviceLog_orgId_kind_localTime_idx" ON "DeviceLog"("orgId", "kind", "localTime");
