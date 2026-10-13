-- Billing / subscriptions (gateway-agnostic)
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "billingInterval" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gatewayName" TEXT,
    "gatewayCustomerId" TEXT,
    "gatewaySubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_accountId_key" ON "Subscription"("accountId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

CREATE TABLE "SubscriptionItem" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "tier" TEXT,
    "seats" INTEGER,
    "unitAmount" INTEGER,
    "priceModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionItem_subscriptionId_appCode_key" ON "SubscriptionItem"("subscriptionId", "appCode");
CREATE INDEX "SubscriptionItem_appCode_idx" ON "SubscriptionItem"("appCode");
ALTER TABLE "SubscriptionItem" ADD CONSTRAINT "SubscriptionItem_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountId" TEXT,
    "payload" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentEvent_gateway_eventId_key" ON "PaymentEvent"("gateway", "eventId");
CREATE INDEX "PaymentEvent_accountId_idx" ON "PaymentEvent"("accountId");
