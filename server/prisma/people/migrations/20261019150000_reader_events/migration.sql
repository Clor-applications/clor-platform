-- The original of every line that became a punch, was refused or set aside.
CREATE TABLE "ReaderEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "sourceEventId" TEXT,
    "pin" TEXT,
    "localTime" TEXT,
    "original" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "parser" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReaderEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReaderEvent_orgId_deviceId_receivedAt_idx" ON "ReaderEvent"("orgId", "deviceId", "receivedAt");
CREATE INDEX "ReaderEvent_orgId_payloadHash_idx" ON "ReaderEvent"("orgId", "payloadHash");
CREATE INDEX "ReaderEvent_receivedAt_idx" ON "ReaderEvent"("receivedAt");
