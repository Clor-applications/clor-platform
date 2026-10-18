-- AlterTable
ALTER TABLE "AttendanceDevice" ADD COLUMN "agentId" TEXT;

-- CreateTable
CREATE TABLE "SiteAgent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "secretsEnc" TEXT,
    "pendingEnc" TEXT,
    "scimTokenId" TEXT,
    "version" TEXT,
    "hostname" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastSummary" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteAgent_tokenHash_key" ON "SiteAgent"("tokenHash");

-- CreateIndex
CREATE INDEX "SiteAgent_orgId_isActive_idx" ON "SiteAgent"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "AgentJob_agentId_status_idx" ON "AgentJob"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentJob_orgId_createdAt_idx" ON "AgentJob"("orgId", "createdAt");
