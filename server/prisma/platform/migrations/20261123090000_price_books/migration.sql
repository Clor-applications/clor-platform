-- Pricing as its own engine (roadmap item 9): versioned price books, their
-- plans and per-period prices, and CLOR's own seller settings. Platform data
-- with no account, so no accountId and no tenant policy: clor.in reads the
-- published book, and only CLOR operators change one.
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

CREATE TABLE "PricePlan" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "apps" TEXT[],
    "unit" TEXT NOT NULL,
    "includedUnits" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "periods" TEXT[],
    "yearlyDiscountPct" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "showOnWebsite" BOOLEAN NOT NULL DEFAULT true,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "gstApplies" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanPrice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "extraUnitPrice" INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX "PricePlan_priceBookId_code_key" ON "PricePlan"("priceBookId", "code");
CREATE UNIQUE INDEX "PlanPrice_planId_period_key" ON "PlanPrice"("planId", "period");

ALTER TABLE "PricePlan" ADD CONSTRAINT "PricePlan_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PricePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
