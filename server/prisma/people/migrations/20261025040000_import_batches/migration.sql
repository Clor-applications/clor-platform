-- An import remembered as one batch (docs/people/02-PRD.md CORE-07), so it can be undone within a day.
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'CREATE',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdIds" JSONB NOT NULL,
    "updated" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneByUserId" TEXT,
    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportBatch_orgId_createdAt_idx" ON "ImportBatch"("orgId", "createdAt");
