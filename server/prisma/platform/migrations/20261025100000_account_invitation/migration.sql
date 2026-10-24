-- Workspace W-3: invitations into an account (docs/workspace/WORKSPACE_IMPLEMENTATION_CHECKLIST.md).
CREATE TABLE "AccountInvitation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accountRole" TEXT NOT NULL DEFAULT 'MEMBER',
    "grants" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountInvitation_role_check" CHECK ("accountRole" IN ('ADMIN', 'BILLING_ADMIN', 'MEMBER')),
    CONSTRAINT "AccountInvitation_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'))
);
CREATE UNIQUE INDEX "AccountInvitation_tokenHash_key" ON "AccountInvitation"("tokenHash");
CREATE INDEX "AccountInvitation_accountId_status_idx" ON "AccountInvitation"("accountId", "status");
CREATE INDEX "AccountInvitation_accountId_email_idx" ON "AccountInvitation"("accountId", "email");
-- One live invitation per person per account.
CREATE UNIQUE INDEX "AccountInvitation_one_pending" ON "AccountInvitation"("accountId", "email") WHERE "status" = 'PENDING';
