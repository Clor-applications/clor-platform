-- Round 55 picks (all additive): a help page link on a saved reply, the Ops
-- handover note, "Remind me tomorrow" on a notification, and "Stop these
-- emails" per person and kind.
ALTER TABLE "SupportSavedReply" ADD COLUMN IF NOT EXISTS "helpUrl" TEXT;

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "snoozedUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "OpsHandoverNote" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsHandoverNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OpsHandoverNote_createdAt_idx" ON "OpsHandoverNote"("createdAt");

-- CLOR staff's own, like notes on a customer: only the operator console,
-- which works outside any company through clor.bypass, sees them.
ALTER TABLE "OpsHandoverNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsHandoverNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_only ON "OpsHandoverNote";
CREATE POLICY staff_only ON "OpsHandoverNote"
  USING (current_setting('clor.bypass', true) = 'on')
  WITH CHECK (current_setting('clor.bypass', true) = 'on');

CREATE TABLE IF NOT EXISTS "EmailOptOut" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOptOut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailOptOut_email_templateKey_key" ON "EmailOptOut"("email", "templateKey");
