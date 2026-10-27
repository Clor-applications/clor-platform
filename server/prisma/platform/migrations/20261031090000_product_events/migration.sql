-- Product events (PRODUCT-VIEW §7): activation and habit, written by the
-- server (services/productEvents.ts). Additive; policies and the append-only
-- trigger are the next migration.
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "userRole" TEXT,
    "app" TEXT,
    "name" TEXT NOT NULL,
    "props" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductEvent_orgId_name_createdAt_idx" ON "ProductEvent"("orgId", "name", "createdAt");
CREATE INDEX "ProductEvent_name_createdAt_idx" ON "ProductEvent"("name", "createdAt");
