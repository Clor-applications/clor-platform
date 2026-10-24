-- Workspace W-6.1: serialise plan-counted creates per account (services/quotaLock.ts).
CREATE TABLE "AccountQuotaLock" (
    "accountId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "holder" TEXT NOT NULL,
    CONSTRAINT "AccountQuotaLock_pkey" PRIMARY KEY ("accountId", "metric")
);
