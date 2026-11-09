-- Explore (roadmap item 6): a 14-day link to the shared sample company, read-only.
-- Platform data with no account of its own, like DemoRequest: no tenant policy;
-- only the public demo form writes a pass, the public exchange reads one by its
-- token's hash, and CLOR operators list, resend and end them.
CREATE TABLE "ExplorePass" (
    "id" TEXT NOT NULL,
    "demoRequestId" TEXT,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "app" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExplorePass_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExplorePass_tokenHash_key" ON "ExplorePass"("tokenHash");
CREATE INDEX "ExplorePass_demoRequestId_idx" ON "ExplorePass"("demoRequestId");
CREATE INDEX "ExplorePass_email_idx" ON "ExplorePass"("email");

-- The session an Explore pass opened, carried through every rotation.
ALTER TABLE "Session" ADD COLUMN "explorePassId" TEXT;
CREATE INDEX "Session_explorePassId_idx" ON "Session"("explorePassId");
