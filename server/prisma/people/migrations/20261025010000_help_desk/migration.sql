-- Help desk (docs/people/02-PRD.md DESK-01..06): requests with a thread, categories
-- with reply-by and resolve-by times, and templates for common answers.
CREATE TABLE "DeskCategory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "leadUserId" TEXT,
    "replyHours" INTEGER NOT NULL DEFAULT 24,
    "resolveDays" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeskCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeskCategory_orgId_key_key" ON "DeskCategory"("orgId", "key");

CREATE TABLE "DeskRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
    "replyChannel" TEXT,
    "assigneeUserId" TEXT,
    "queue" TEXT NOT NULL,
    "replyBy" TIMESTAMP(3) NOT NULL,
    "resolveBy" TIMESTAMP(3) NOT NULL,
    "firstReplyAt" TIMESTAMP(3),
    "replyEscalatedAt" TIMESTAMP(3),
    "resolveEscalatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "movedToCaseAt" TIMESTAMP(3),
    "movedToCaseId" TEXT,
    "raisedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeskRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeskRequest_orgId_status_resolveBy_idx" ON "DeskRequest"("orgId", "status", "resolveBy");
CREATE INDEX "DeskRequest_orgId_employeeId_idx" ON "DeskRequest"("orgId", "employeeId");
CREATE INDEX "DeskRequest_orgId_queue_status_idx" ON "DeskRequest"("orgId", "queue", "status");
ALTER TABLE "DeskRequest" ADD CONSTRAINT "DeskRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeskMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorEmployeeId" TEXT,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "attachmentDocId" TEXT,
    "templateId" TEXT,
    "policyVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeskMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeskMessage_orgId_requestId_createdAt_idx" ON "DeskMessage"("orgId", "requestId", "createdAt");
ALTER TABLE "DeskMessage" ADD CONSTRAINT "DeskMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DeskRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeskTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "policyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeskTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeskTemplate_orgId_isActive_idx" ON "DeskTemplate"("orgId", "isActive");

-- The HR Cases register's open questions move across, so nothing an employee asked is lost.
INSERT INTO "DeskRequest" ("id", "accountId", "orgId", "employeeId", "category", "subject", "description", "urgency", "queue", "replyBy", "resolveBy", "status", "resolution", "resolvedAt", "createdAt", "updatedAt")
SELECT 'desk_' || r."id", r."accountId", r."orgId", r."employeeId",
       CASE COALESCE(r."details"->>'category', 'GENERAL') WHEN 'GENERAL' THEN 'OTHER' ELSE r."details"->>'category' END,
       r."title", COALESCE(r."details"->>'description', ''), COALESCE(r."details"->>'priority', 'NORMAL'),
       CASE COALESCE(r."details"->>'category', 'GENERAL') WHEN 'PAYROLL' THEN 'Payroll' ELSE 'HR' END,
       r."createdAt" + INTERVAL '1 day',
       COALESCE(to_timestamp(r."dueDate", 'YYYY-MM-DD'), r."createdAt" + INTERVAL '3 days'),
       CASE r."status" WHEN 'RESOLVED' THEN 'RESOLVED' WHEN 'CLOSED' THEN 'RESOLVED' ELSE 'OPEN' END,
       NULLIF(r."details"->>'resolution', ''),
       CASE WHEN r."status" IN ('RESOLVED', 'CLOSED') THEN r."updatedAt" ELSE NULL END,
       r."createdAt", r."updatedAt"
FROM "PeopleRecord" r
WHERE r."kind" = 'helpdesk' AND r."employeeId" IS NOT NULL;
