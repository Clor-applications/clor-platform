-- GAP-004 (Batch 5): one registry of the credentials CLOR issues to machines and links.

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "parentOwnerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "needsReviewReason" TEXT,
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "credentialKind" TEXT NOT NULL,
    "credentialPrefix" TEXT,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Credential_rotatedFromId_key" ON "Credential"("rotatedFromId");
CREATE INDEX "Credential_orgId_kind_status_idx" ON "Credential"("orgId", "kind", "status");
CREATE INDEX "Credential_kind_ownerId_idx" ON "Credential"("kind", "ownerId");
CREATE UNIQUE INDEX "Credential_kind_tokenHash_key" ON "Credential"("kind", "tokenHash");
CREATE INDEX "CredentialEvent_orgId_credentialId_createdAt_idx" ON "CredentialEvent"("orgId", "credentialId", "createdAt");
CREATE INDEX "CredentialEvent_orgId_createdAt_idx" ON "CredentialEvent"("orgId", "createdAt");
