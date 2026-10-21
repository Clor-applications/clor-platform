-- The recycle bin: deleted rows kept for RECYCLE_BIN_DAYS (default 30).
CREATE TABLE "DeletedItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeletedItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeletedItem_orgId_deletedAt_idx" ON "DeletedItem"("orgId", "deletedAt");
CREATE INDEX "DeletedItem_purgeAfter_idx" ON "DeletedItem"("purgeAfter");
