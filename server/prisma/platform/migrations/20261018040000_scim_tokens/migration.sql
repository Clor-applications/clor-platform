-- CreateTable
CREATE TABLE "ScimToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "defaultRoleId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimToken_tokenHash_key" ON "ScimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScimToken_accountId_orgId_idx" ON "ScimToken"("accountId", "orgId");
