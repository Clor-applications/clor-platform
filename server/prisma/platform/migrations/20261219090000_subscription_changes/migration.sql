-- Seats a customer adds to their own plan (billing/selfServe.ts). Additive only.
CREATE TABLE "SubscriptionChange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SEATS',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "unit" TEXT NOT NULL,
    "added" INTEGER NOT NULL,
    "fromQuantity" INTEGER NOT NULL,
    "toQuantity" INTEGER NOT NULL,
    "deltaList" INTEGER NOT NULL,
    "deltaPeriod" INTEGER NOT NULL,
    "proratedAmount" INTEGER NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "invoiceId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3),
    "settledByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionChange_invoiceId_key" ON "SubscriptionChange"("invoiceId");
CREATE INDEX "SubscriptionChange_accountId_createdAt_idx" ON "SubscriptionChange"("accountId", "createdAt");
CREATE INDEX "SubscriptionChange_status_dueAt_idx" ON "SubscriptionChange"("status", "dueAt");
-- One open change per account: two clicks, two tabs or two people cannot add twice.
CREATE UNIQUE INDEX "SubscriptionChange_one_open_per_account" ON "SubscriptionChange"("accountId") WHERE "status" = 'OPEN';
