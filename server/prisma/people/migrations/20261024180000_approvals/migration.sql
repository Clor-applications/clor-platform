-- The approval engine (docs/people/02-PRD.md APR-01..07): rules with versions, requests, steps, stand-ins.
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL, "requestType" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "active" BOOLEAN NOT NULL DEFAULT true,
    "steps" JSONB NOT NULL, "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApprovalRule_orgId_requestType_version_key" ON "ApprovalRule"("orgId", "requestType", "version");
CREATE INDEX "ApprovalRule_orgId_requestType_active_idx" ON "ApprovalRule"("orgId", "requestType", "active");

CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "orgId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL, "subjectEmployeeId" TEXT, "requesterUserId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL, "ruleVersion" INTEGER NOT NULL, "title" TEXT NOT NULL, "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING', "currentStep" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT, "decisionId" TEXT, "outcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApprovalRequest_orgId_idempotencyKey_key" ON "ApprovalRequest"("orgId", "idempotencyKey");
CREATE INDEX "ApprovalRequest_orgId_status_createdAt_idx" ON "ApprovalRequest"("orgId", "status", "createdAt");
CREATE INDEX "ApprovalRequest_orgId_subjectEmployeeId_idx" ON "ApprovalRequest"("orgId", "subjectEmployeeId");
CREATE INDEX "ApprovalRequest_orgId_requesterUserId_idx" ON "ApprovalRequest"("orgId", "requesterUserId");

CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "orgId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
    "order" INTEGER NOT NULL, "candidateUserIds" JSONB NOT NULL, "approverUserId" TEXT, "standInForUserId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'WAITING', "comment" TEXT,
    "decidedByUserId" TEXT, "decidedAt" TIMESTAMP(3), "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApprovalStep_orgId_status_dueAt_idx" ON "ApprovalStep"("orgId", "status", "dueAt");
CREATE INDEX "ApprovalStep_requestId_order_idx" ON "ApprovalStep"("requestId", "order");
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StandIn" (
    "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL, "standInUserId" TEXT NOT NULL, "fromDate" TEXT NOT NULL, "toDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StandIn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StandIn_orgId_userId_fromDate_toDate_idx" ON "StandIn"("orgId", "userId", "fromDate", "toDate");
