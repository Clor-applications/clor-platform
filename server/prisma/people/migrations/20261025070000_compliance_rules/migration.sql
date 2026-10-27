-- Compliance rule library and obligations (docs/people/02-PRD.md COMP-01..06):
-- versioned rules never overwritten; obligations worked out per establishment.
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "establishmentKinds" JSONB NOT NULL,
    "employeeCategories" JSONB NOT NULL,
    "legalSource" TEXT NOT NULL,
    "notificationRef" TEXT,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "supersedesVersion" INTEGER,
    "obligation" TEXT NOT NULL,
    "threshold" JSONB,
    "ownerRole" TEXT NOT NULL DEFAULT 'HR',
    "dueRule" JSONB NOT NULL,
    "requiredProof" JSONB NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "checkedByUserId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComplianceRule_orgId_ruleId_version_key" ON "ComplianceRule"("orgId", "ruleId", "version");
CREATE INDEX "ComplianceRule_orgId_active_idx" ON "ComplianceRule"("orgId", "active");

CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "establishmentId" TEXT,
    "period" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "proofDocIds" JSONB NOT NULL,
    "note" TEXT,
    "dueToldAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "checkedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Obligation_orgId_ruleId_establishmentId_period_key" ON "Obligation"("orgId", "ruleId", "establishmentId", "period");
CREATE INDEX "Obligation_orgId_status_dueOn_idx" ON "Obligation"("orgId", "status", "dueOn");
