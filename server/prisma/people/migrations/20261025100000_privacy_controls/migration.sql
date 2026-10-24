-- Retention with legal hold and a deletion review (docs/people/02-PRD.md PRV-03), and
-- time-boxed auditor access to named evidence (PRV-06).
CREATE TABLE "RetentionRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "keepYears" INTEGER NOT NULL,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "basis" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionRule_orgId_dataType_key" ON "RetentionRule"("orgId", "dataType");

CREATE TABLE "DeletionReview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dueSince" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeletionReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeletionReview_orgId_dataType_entityId_key" ON "DeletionReview"("orgId", "dataType", "entityId");
CREATE INDEX "DeletionReview_orgId_status_idx" ON "DeletionReview"("orgId", "status");

CREATE TABLE "AuditorGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "documentIds" JSONB NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "untilAt" TIMESTAMP(3) NOT NULL,
    "grantedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditorGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditorGrant_orgId_userId_untilAt_idx" ON "AuditorGrant"("orgId", "userId", "untilAt");
