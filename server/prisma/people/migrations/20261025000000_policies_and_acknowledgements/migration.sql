-- Policies with versions and who they apply to (docs/people/02-PRD.md POL-01..06), and
-- acknowledgements of a policy version or a document (DOC-05, POL-04).
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Policy_orgId_category_idx" ON "Policy"("orgId", "category");

CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT,
    "documentId" TEXT,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "appliesTo" JSONB NOT NULL,
    "needsAcceptance" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "requestId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolicyVersion_policyId_version_key" ON "PolicyVersion"("policyId", "version");
CREATE INDEX "PolicyVersion_orgId_status_effectiveFrom_idx" ON "PolicyVersion"("orgId", "status", "effectiveFrom");
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Acknowledgement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "askedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "remindCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Acknowledgement_targetType_targetId_employeeId_key" ON "Acknowledgement"("targetType", "targetId", "employeeId");
CREATE INDEX "Acknowledgement_orgId_employeeId_acceptedAt_idx" ON "Acknowledgement"("orgId", "employeeId", "acceptedAt");
CREATE INDEX "Acknowledgement_orgId_targetType_targetId_idx" ON "Acknowledgement"("orgId", "targetType", "targetId");
