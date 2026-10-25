-- The Clor operator console (W-8.2): Clor's own staff, apart from every
-- customer account. Who is an operator and in what role, everything an
-- operator did (append-only), and an account an operator has suspended.

CREATE TABLE "PlatformOperator" (
    "userId" TEXT NOT NULL,
    -- SUPER_ADMIN | SUPPORT | BILLING
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "PlatformOperator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OperatorAuditEvent" (
    "id" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetAccountId" TEXT,
    "targetUserId" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperatorAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OperatorAuditEvent_at_idx" ON "OperatorAuditEvent"("at");
CREATE INDEX "OperatorAuditEvent_targetAccountId_at_idx" ON "OperatorAuditEvent"("targetAccountId", "at");

ALTER TABLE "Account" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "suspendedReason" TEXT;
