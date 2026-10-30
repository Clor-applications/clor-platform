-- A withdrawn exit interview gets a round of its own (lifecycle/stayOn.ts), so a new leaving on the same last day
-- opens a fresh interview instead of bringing the withdrawn one back with its answers. Round 0 is the leaving in
-- progress; withdrawn ones are numbered 1, 2, 3… per person and last day, in the order they were withdrawn.
-- Safe to run again.
ALTER TABLE "ExitInterview" ADD COLUMN IF NOT EXISTS "round" INTEGER NOT NULL DEFAULT 0;

-- Data: interviews already withdrawn and still on round 0 take the next rounds after any already numbered
-- (ExitInterview has row-level security, so with the bypass on).
SET clor.bypass = 'on';
UPDATE "ExitInterview" AS t
SET "round" = n."next"
FROM (
  SELECT w."id",
         COALESCE((SELECT max(x."round") FROM "ExitInterview" AS x WHERE x."orgId" = w."orgId" AND x."employeeId" = w."employeeId" AND x."leavingDate" = w."leavingDate"), 0)
           + row_number() OVER (PARTITION BY w."orgId", w."employeeId", w."leavingDate" ORDER BY w."withdrawnAt", w."id") AS "next"
  FROM "ExitInterview" AS w
  WHERE w."withdrawnAt" IS NOT NULL AND w."round" = 0
) AS n
WHERE t."id" = n."id";
RESET clor.bypass;

DROP INDEX IF EXISTS "ExitInterview_orgId_employeeId_leavingDate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ExitInterview_orgId_employeeId_leavingDate_round_key" ON "ExitInterview"("orgId", "employeeId", "leavingDate", "round");
