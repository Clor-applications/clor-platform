-- A free trial started from clor.in's pricing page (roadmap item 7): the
-- pending signup behind the email link, and the account it became. Platform
-- data with no account of its own until confirm, like DemoRequest: no tenant
-- policy. Only the public signup routes write it; CLOR operators read it.
CREATE TABLE "TrialSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "app" TEXT,
    "planCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "provisioningAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "companyName" TEXT,
    "apps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" TEXT,
    "trialDays" INTEGER,
    "accountId" TEXT,
    "ownerUserId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialSignup_tokenHash_key" ON "TrialSignup"("tokenHash");
CREATE UNIQUE INDEX "TrialSignup_accountId_key" ON "TrialSignup"("accountId");
CREATE INDEX "TrialSignup_email_createdAt_idx" ON "TrialSignup"("email", "createdAt");
CREATE INDEX "TrialSignup_status_createdAt_idx" ON "TrialSignup"("status", "createdAt");
