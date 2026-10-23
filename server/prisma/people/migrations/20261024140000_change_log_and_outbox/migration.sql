-- Change log with before and after, and the outbox (docs/people/02-PRD.md FND-04, FND-05).
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "employeeId" TEXT,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "correlationId" TEXT NOT NULL,
    "requestId" TEXT,
    "decisionId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeLog_orgId_entity_entityId_at_idx" ON "ChangeLog"("orgId", "entity", "entityId", "at");
CREATE INDEX "ChangeLog_orgId_employeeId_at_idx" ON "ChangeLog"("orgId", "employeeId", "at");
CREATE INDEX "ChangeLog_correlationId_idx" ON "ChangeLog"("correlationId");

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboxEvent_orgId_deliveredAt_nextAttemptAt_idx" ON "OutboxEvent"("orgId", "deliveredAt", "nextAttemptAt");
CREATE INDEX "OutboxEvent_orgId_employeeId_occurredAt_idx" ON "OutboxEvent"("orgId", "employeeId", "occurredAt");
