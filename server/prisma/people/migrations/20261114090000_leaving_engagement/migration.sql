-- Leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.3, 4.7, 4.8, 4.9): no-dues sign-off lines on a
-- leaving, exit interviews, the company's exit questions and automations, what each automation sent,
-- celebration opt-outs and the day's greetings. New tables only; policies in the next migration.

-- CreateTable
CREATE TABLE "ClearanceLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leavingDate" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "direction" TEXT NOT NULL DEFAULT 'NONE',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "signedByUserId" TEXT,
    "signedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitInterview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leavingDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "hideFromManager" BOOLEAN NOT NULL DEFAULT false,
    "enteredBy" TEXT,
    "enteredByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "couldKeep" TEXT,
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "outcomeByUserId" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "remindedOn" TEXT,
    "keepUntil" TEXT,
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementSettings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "exitQuestions" JSONB NOT NULL DEFAULT '[]',
    "automations" JSONB NOT NULL DEFAULT '{}',
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ranOn" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CelebrationOptOut" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CelebrationOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GreetingPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "onDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "employeeId" TEXT,
    "years" INTEGER,
    "holidayId" TEXT,
    "holidayDate" TEXT,
    "areaId" TEXT,
    "branchId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GreetingPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClearanceLine_orgId_employeeId_idx" ON "ClearanceLine"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceLine_orgId_employeeId_leavingDate_dept_label_key" ON "ClearanceLine"("orgId", "employeeId", "leavingDate", "dept", "label");

-- CreateIndex
CREATE INDEX "ExitInterview_orgId_submittedAt_idx" ON "ExitInterview"("orgId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExitInterview_orgId_employeeId_leavingDate_key" ON "ExitInterview"("orgId", "employeeId", "leavingDate");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementSettings_orgId_key" ON "EngagementSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_orgId_key_ranOn_key" ON "AutomationRun"("orgId", "key", "ranOn");

-- CreateIndex
CREATE UNIQUE INDEX "CelebrationOptOut_orgId_employeeId_key" ON "CelebrationOptOut"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "GreetingPost_orgId_onDate_idx" ON "GreetingPost"("orgId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "GreetingPost_orgId_onDate_key_key" ON "GreetingPost"("orgId", "onDate", "key");

