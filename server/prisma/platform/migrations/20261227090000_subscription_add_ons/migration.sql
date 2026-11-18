-- Apps a customer adds to their own plan (billing/selfServeApps.ts). Additive only.
ALTER TABLE "SubscriptionChange" ADD COLUMN "appCode" TEXT;
ALTER TABLE "SubscriptionChange" ADD COLUMN "addOnId" TEXT;
CREATE UNIQUE INDEX "SubscriptionChange_addOnId_key" ON "SubscriptionChange"("addOnId");

CREATE TABLE "SubscriptionAddOn" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "listAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "endedByUserId" TEXT,
    "endedReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionAddOn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SubscriptionAddOn_accountId_status_idx" ON "SubscriptionAddOn"("accountId", "status");
-- One running add-on per app per account.
CREATE UNIQUE INDEX "SubscriptionAddOn_one_active_per_app" ON "SubscriptionAddOn"("accountId", "appCode") WHERE "status" = 'ACTIVE';
