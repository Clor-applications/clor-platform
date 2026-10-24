-- A Health check item put aside until a date, with the reason (docs/people/02-PRD.md HLTH-03).
CREATE TABLE "HealthSnooze" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "until" TEXT NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "HealthSnooze_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HealthSnooze_orgId_checkId_until_idx" ON "HealthSnooze"("orgId", "checkId", "until");
