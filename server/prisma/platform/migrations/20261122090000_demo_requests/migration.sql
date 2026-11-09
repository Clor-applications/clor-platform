-- "Request a demo" from clor.in (roadmap items 3 and 4). Platform data with no
-- account yet, so no accountId and no tenant policy: only the public form
-- writes a row, and only CLOR operators read or change one.
CREATE TABLE "DemoRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "companySize" TEXT NOT NULL,
    "users" INTEGER NOT NULL,
    "apps" TEXT[],
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedByUserId" TEXT,
    "provisioningAt" TIMESTAMP(3),
    "accountId" TEXT,
    "ownerUserId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemoRequest_accountId_key" ON "DemoRequest"("accountId");
CREATE INDEX "DemoRequest_status_createdAt_idx" ON "DemoRequest"("status", "createdAt");
CREATE INDEX "DemoRequest_createdAt_idx" ON "DemoRequest"("createdAt");
CREATE INDEX "DemoRequest_email_createdAt_idx" ON "DemoRequest"("email", "createdAt");
