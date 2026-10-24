-- Before day one (docs/people/02-PRD.md LIFE-01): an invite the joiner opens once,
-- good for fourteen days, with what they sent held until HR checks it.
CREATE TABLE "JoinInvite" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "message" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "submitted" JSONB,
    "startedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "checkedByUserId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JoinInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JoinInvite_tokenHash_key" ON "JoinInvite"("tokenHash");
CREATE INDEX "JoinInvite_orgId_employeeId_idx" ON "JoinInvite"("orgId", "employeeId");
CREATE INDEX "JoinInvite_orgId_status_idx" ON "JoinInvite"("orgId", "status");
ALTER TABLE "JoinInvite" ADD CONSTRAINT "JoinInvite_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
