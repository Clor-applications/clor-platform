-- GAP-006: a person from another account reaches a company only through the
-- company's recorded consent (OutsideAccess). Its RLS is the next migration.

CREATE TABLE "OutsideAccess" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "homeAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "apps" TEXT,
    "expiresAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedByUserId" TEXT,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutsideAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutsideAccess_orgId_userId_key" ON "OutsideAccess"("orgId", "userId");
CREATE INDEX "OutsideAccess_userId_idx" ON "OutsideAccess"("userId");
CREATE INDEX "OutsideAccess_accountId_orgId_idx" ON "OutsideAccess"("accountId", "orgId");

-- Nobody loses access at deploy: every membership whose person signed up under
-- another account becomes an engagement, active, no end, all apps, "carried over".
SET clor.bypass = 'on';
INSERT INTO "OutsideAccess" ("id", "accountId", "orgId", "userId", "homeAccountId", "status", "updatedAt")
SELECT 'oa_' || md5(m."orgId" || ':' || m."userId"), m."accountId", m."orgId", m."userId", u."accountId", 'ACTIVE', CURRENT_TIMESTAMP
FROM "UserOrgMembership" m
JOIN "User" u ON u."id" = m."userId"
WHERE u."accountId" <> m."accountId"
ON CONFLICT ("orgId", "userId") DO NOTHING;
RESET clor.bypass;
