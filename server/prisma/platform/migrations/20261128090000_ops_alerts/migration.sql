-- Alerts for CLOR staff (Ops plan P1). Platform data read only by CLOR
-- operators; no account policy. One open alert per key (partial unique index),
-- so two instances of the alerts job cannot both raise the same one.
CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "accountId" TEXT,
    "link" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpsAlert_resolvedAt_severity_idx" ON "OpsAlert"("resolvedAt", "severity");
CREATE INDEX "OpsAlert_key_resolvedAt_idx" ON "OpsAlert"("key", "resolvedAt");
CREATE UNIQUE INDEX "OpsAlert_one_open_per_key" ON "OpsAlert"("key") WHERE "resolvedAt" IS NULL;
