-- The operator portal (roadmap items 13 and 14): staff invited by email, the
-- sender addresses and template wording CLOR's own mail uses, and the app
-- catalogue clor.in and the app switcher read. Platform data with no account
-- of its own, like DemoRequest: no accountId and no tenant policy. Written
-- only from the operator console, behind requireOperator and a role.

CREATE TABLE "OperatorInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "note" TEXT,
    "invitedByUserId" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperatorInvite_email_key" ON "OperatorInvite"("email");

CREATE TABLE "EmailSender" (
    "purpose" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "replyTo" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSender_pkey" PRIMARY KEY ("purpose")
);

CREATE TABLE "EmailTemplateOverride" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplateOverride_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AppCatalogueEntry" (
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppCatalogueEntry_pkey" PRIMARY KEY ("code")
);

-- The email log reads every message newest first, and the audit log filters by operator.
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");
CREATE INDEX "EmailOutbox_createdAt_idx" ON "EmailOutbox"("createdAt");
CREATE INDEX "OperatorAuditEvent_operatorUserId_at_idx" ON "OperatorAuditEvent"("operatorUserId", "at");
CREATE INDEX "OperatorAuditEvent_action_at_idx" ON "OperatorAuditEvent"("action", "at");
