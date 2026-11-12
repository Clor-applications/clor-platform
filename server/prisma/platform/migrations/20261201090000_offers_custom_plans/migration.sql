-- Offers, custom plans, and the deal on a subscription (operator console, Money).
ALTER TABLE "Subscription"
  ADD COLUMN "planSource" TEXT,
  ADD COLUMN "planRef" TEXT,
  ADD COLUMN "planName" TEXT,
  ADD COLUMN "planUnit" TEXT,
  ADD COLUMN "quantity" INTEGER,
  ADD COLUMN "listAmount" INTEGER,
  ADD COLUMN "periodAmount" INTEGER,
  ADD COLUMN "offerId" TEXT,
  ADD COLUMN "offerCode" TEXT,
  ADD COLUMN "offerEndsAt" TIMESTAMP(3);

CREATE TABLE "Offer" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "planCodes" TEXT[],
  "periods" TEXT[],
  "durationPeriods" INTEGER,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER,
  "redemptions" INTEGER NOT NULL DEFAULT 0,
  "pausedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Offer_code_key" ON "Offer"("code");
CREATE INDEX "Offer_archivedAt_idx" ON "Offer"("archivedAt");

CREATE TABLE "CustomPlan" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "apps" TEXT[],
  "unit" TEXT NOT NULL,
  "includedUnits" INTEGER NOT NULL DEFAULT 1,
  "monthlyPrice" INTEGER,
  "monthlyExtra" INTEGER NOT NULL DEFAULT 0,
  "yearlyPrice" INTEGER,
  "yearlyExtra" INTEGER NOT NULL DEFAULT 0,
  "gstApplies" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomPlan_accountId_idx" ON "CustomPlan"("accountId");
