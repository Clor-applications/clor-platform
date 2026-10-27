-- Joining: statutory details from the joiner (held until HR approves), employee app sends, offers with an accept link. Additive.
-- CreateTable
CREATE TABLE "JoinStatutory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "bankOutcome" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoinStatutory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppAccessSend" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppAccessSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT,
    "candidateId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "joiningDate" TEXT,
    "acceptBy" TEXT NOT NULL,
    "annualCtc" DECIMAL(14,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "linesFrom" TEXT NOT NULL DEFAULT 'TYPED',
    "structureId" TEXT,
    "letterText" TEXT NOT NULL,
    "documentId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedIp" TEXT,
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JoinStatutory_inviteId_key" ON "JoinStatutory"("inviteId");

-- CreateIndex
CREATE INDEX "JoinStatutory_orgId_employeeId_idx" ON "JoinStatutory"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "JoinStatutory_orgId_status_idx" ON "JoinStatutory"("orgId", "status");

-- CreateIndex
CREATE INDEX "AppAccessSend_orgId_employeeId_createdAt_idx" ON "AppAccessSend"("orgId", "employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_tokenHash_key" ON "Offer"("tokenHash");

-- CreateIndex
CREATE INDEX "Offer_orgId_status_idx" ON "Offer"("orgId", "status");

-- CreateIndex
CREATE INDEX "Offer_orgId_employeeId_idx" ON "Offer"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "Offer_orgId_candidateId_idx" ON "Offer"("orgId", "candidateId");
