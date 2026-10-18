-- AlterTable
ALTER TABLE "AuthProvider" ADD COLUMN "domainVerifyToken" TEXT,
ADD COLUMN "verifiedDomains" TEXT;

-- CreateTable
CREATE TABLE "SsoAssertionSeen" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoAssertionSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoAssertionSeen_expiresAt_idx" ON "SsoAssertionSeen"("expiresAt");
