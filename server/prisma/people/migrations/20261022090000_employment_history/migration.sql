-- Employment history: effective-dated changes to where and how someone works.
CREATE TABLE "EmploymentEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "fromId" TEXT,
    "toId" TEXT,
    "fromLabel" TEXT,
    "toLabel" TEXT,
    "effectiveDate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "payrollImpact" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmploymentEvent_orgId_employeeId_effectiveDate_idx" ON "EmploymentEvent"("orgId", "employeeId", "effectiveDate");
