-- Payments set up in the operator console: the providers, and what became of
-- each payment event (the Payments log).
ALTER TABLE "PaymentEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'RECORDED',
ADD COLUMN "detail" TEXT,
ADD COLUMN "amount" INTEGER,
ADD COLUMN "reference" TEXT,
ADD COLUMN "normalized" JSONB,
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processedAt" TIMESTAMP(3),
ADD COLUMN "recordedByUserId" TEXT;

-- Events already applied before this column existed.
UPDATE "PaymentEvent" SET "status" = 'APPLIED' WHERE "processed" = true;

CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");
CREATE INDEX "PaymentEvent_status_idx" ON "PaymentEvent"("status");

CREATE TABLE "PaymentProvider" (
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'TEST',
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretsEnc" TEXT,
    "secretHints" JSONB NOT NULL DEFAULT '{}',
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastTestMode" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProvider_pkey" PRIMARY KEY ("code")
);
