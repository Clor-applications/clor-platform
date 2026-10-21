-- LX-07 part 2: closing a company (notice period, then deletion).
CREATE TABLE "OrgClosure" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedCounts" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgClosure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgClosure_orgId_key" ON "OrgClosure"("orgId");
CREATE INDEX "OrgClosure_status_deleteAfter_idx" ON "OrgClosure"("status", "deleteAfter");
