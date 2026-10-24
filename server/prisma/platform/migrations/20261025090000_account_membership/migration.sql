-- Workspace W-1.1: a person's account-level role, and the account's own audit trail
-- (docs/workspace/WORKSPACE_IMPLEMENTATION_CHECKLIST.md, decision D-2).
CREATE TABLE "AccountMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountMembership_role_check" CHECK ("role" IN ('OWNER', 'ADMIN', 'BILLING_ADMIN', 'MEMBER')),
    CONSTRAINT "AccountMembership_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED'))
);
CREATE UNIQUE INDEX "AccountMembership_accountId_userId_key" ON "AccountMembership"("accountId", "userId");
CREATE INDEX "AccountMembership_userId_idx" ON "AccountMembership"("userId");
CREATE INDEX "AccountMembership_accountId_role_idx" ON "AccountMembership"("accountId", "role");

CREATE TABLE "AccountAuditEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'OK',
    "message" TEXT,
    "metadata" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccountAuditEvent_accountId_createdAt_idx" ON "AccountAuditEvent"("accountId", "createdAt");

-- Backfill, reading company tables across companies (fail-closed RLS needs the bypass).
SET clor.bypass = 'on';

-- 1. Everyone whose home is the account belongs to it; one who cannot sign in is suspended.
INSERT INTO "AccountMembership" ("id", "accountId", "userId", "role", "status", "updatedAt")
SELECT 'am_' || md5(u."accountId" || ':' || u."id"), u."accountId", u."id", 'MEMBER',
       CASE WHEN u."isActive" THEN 'ACTIVE' ELSE 'SUSPENDED' END, CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("accountId", "userId") DO NOTHING;

-- 2. An administrator of any of the account's companies (directly or through a role profile)
--    administers the account: that is the rule company creation used until now (auth.ts, A-04).
UPDATE "AccountMembership" m SET "role" = 'ADMIN'
WHERE m."status" = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM "Role" r
  WHERE r."accountId" = m."accountId" AND r."roleType" = 'ADMIN' AND r."branchId" IS NULL
    AND (
      EXISTS (SELECT 1 FROM "UserRoleAssignment" a
              WHERE a."roleId" = r."id" AND a."userId" = m."userId" AND a."branchId" IS NULL)
      OR EXISTS (SELECT 1 FROM "RoleProfileRole" pr JOIN "UserRoleProfile" up ON up."profileId" = pr."profileId"
                 WHERE pr."roleId" = r."id" AND up."userId" = m."userId" AND up."branchId" IS NULL)
    )
);

-- 3. Each account's first person who can still sign in (who signed up) owns it.
UPDATE "AccountMembership" m SET "role" = 'OWNER'
FROM (
  SELECT DISTINCT ON (u."accountId") u."accountId", u."id" AS "userId"
  FROM "User" u WHERE u."isActive" = true
  ORDER BY u."accountId", u."createdAt" ASC, u."id" ASC
) first
WHERE m."accountId" = first."accountId" AND m."userId" = first."userId";

RESET clor.bypass;
