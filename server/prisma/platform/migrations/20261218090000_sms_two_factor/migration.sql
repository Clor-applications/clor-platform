-- Two-step sign-in by a code sent in a text message, beside the authenticator
-- app (owner, 17 Nov 2026). Off for everyone until a person turns it on, and
-- the option shows only once CLOR's SMS sender is set up in the operator
-- console. Platform data with no account of its own: no tenant policy; only
-- the sign-in and security routes read or write a code, by the user's id.
ALTER TABLE "User" ADD COLUMN "smsPhone" TEXT;
ALTER TABLE "User" ADD COLUMN "smsTwoFactorEnabledAt" TIMESTAMP(3);

CREATE TABLE "SmsCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsCode_userId_purpose_createdAt_idx" ON "SmsCode"("userId", "purpose", "createdAt");
CREATE INDEX "SmsCode_phone_createdAt_idx" ON "SmsCode"("phone", "createdAt");
