-- Pricing as its own engine (roadmap item 9): versioned price books, their
-- prices, and CLOR's own seller settings. Platform data with no account, so no
-- accountId and no tenant policy: clor.in reads the published book, and only
-- CLOR operators change one.
CREATE TABLE "PriceBook" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "note" TEXT,
    "copiedFromId" TEXT,
    "createdByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanPrice" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "includedUnits" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "gstApplies" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "PriceBook_version_key" ON "PriceBook"("version");
CREATE INDEX "PriceBook_status_idx" ON "PriceBook"("status");
CREATE UNIQUE INDEX "PlanPrice_priceBookId_appCode_tier_period_key" ON "PlanPrice"("priceBookId", "appCode", "tier", "period");

ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
