-- CreateTable
CREATE TABLE "HrConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "secretsEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pushPunches" BOOLEAN NOT NULL DEFAULT true,
    "pullEmployees" BOOLEAN NOT NULL DEFAULT false,
    "createEmployees" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastSummary" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrOutbox" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSyncLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrConnection_orgId_enabled_idx" ON "HrConnection"("orgId", "enabled");
CREATE UNIQUE INDEX "HrOutbox_connectionId_key_key" ON "HrOutbox"("connectionId", "key");
CREATE INDEX "HrOutbox_orgId_status_nextAttemptAt_idx" ON "HrOutbox"("orgId", "status", "nextAttemptAt");
CREATE INDEX "HrSyncLog_orgId_connectionId_createdAt_idx" ON "HrSyncLog"("orgId", "connectionId", "createdAt");
