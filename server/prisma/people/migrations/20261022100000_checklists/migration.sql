-- Joining and leaving checklists: templates per company, tasks per person.
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChecklistTemplate_orgId_kind_key" ON "ChecklistTemplate"("orgId", "kind");

CREATE TABLE "ChecklistTask" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "dueDate" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChecklistTask_orgId_employeeId_idx" ON "ChecklistTask"("orgId", "employeeId");
CREATE INDEX "ChecklistTask_orgId_doneAt_dueDate_idx" ON "ChecklistTask"("orgId", "doneAt", "dueDate");
