-- Compliance calendar: statutory and company deadlines per period, with evidence.
CREATE TABLE "ComplianceTask" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "owner" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "evidenceName" TEXT,
    "evidenceMime" TEXT,
    "evidenceData" BYTEA,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComplianceTask_orgId_code_period_key" ON "ComplianceTask"("orgId", "code", "period");
CREATE INDEX "ComplianceTask_orgId_dueDate_idx" ON "ComplianceTask"("orgId", "dueDate");
