-- Party code numbering (Books developer change, 6 Nov 2026): codes are issued
-- from a counter on the server, optionally one series per branch, and one code
-- names one party within a company.

ALTER TABLE "Party" ADD COLUMN "codeBranchId" TEXT;

-- "Party" forces row-level security; without the bypass the clean-up below
-- would see no rows when the migration role is not a superuser, and the unique
-- index (which row security does not filter) would then fail on real data.
SET clor.bypass = 'on';

-- The unique index below would refuse a company that already has two parties
-- on one code. An empty code is no code. Where a real code repeats, the oldest
-- party keeps it and each later one gets a numbered suffix, so nothing is lost
-- and the owner can see which ones to renumber.
UPDATE "Party" SET "code" = NULL WHERE "code" IS NOT NULL AND btrim("code") = '';

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "orgId", "code" ORDER BY "createdAt", "id") AS n
  FROM "Party"
  WHERE "code" IS NOT NULL
)
UPDATE "Party" p
-- The row id keeps the renamed code from landing on a code already in use.
SET "code" = p."code" || '-DUP' || ranked.n || '-' || left(p."id", 6)
FROM ranked
WHERE p."id" = ranked."id" AND ranked.n > 1;

RESET clor.bypass;

CREATE UNIQUE INDEX "Party_orgId_code_key" ON "Party"("orgId", "code");

CREATE TABLE "PartyCodeCounter" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "branchScope" TEXT NOT NULL DEFAULT '',
    "nextNumber" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyCodeCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartyCodeCounter_orgId_kind_branchScope_key" ON "PartyCodeCounter"("orgId", "kind", "branchScope");
CREATE INDEX "PartyCodeCounter_accountId_orgId_idx" ON "PartyCodeCounter"("accountId", "orgId");
