-- A withdrawn exit interview gets a round of its own (lifecycle/stayOn.ts), so a new leaving on the same last day
-- opens a fresh interview instead of bringing the withdrawn one back with its answers. Round 0 is the leaving in
-- progress. Safe to run again.
ALTER TABLE "ExitInterview" ADD COLUMN IF NOT EXISTS "round" INTEGER NOT NULL DEFAULT 0;

-- Data: interviews already withdrawn take their withdrawal time, in seconds, as their round (ExitInterview has
-- row-level security, so with the bypass on).
SET clor.bypass = 'on';
UPDATE "ExitInterview" SET "round" = extract(epoch FROM "withdrawnAt")::integer WHERE "withdrawnAt" IS NOT NULL AND "round" = 0;
RESET clor.bypass;

DROP INDEX IF EXISTS "ExitInterview_orgId_employeeId_leavingDate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ExitInterview_orgId_employeeId_leavingDate_round_key" ON "ExitInterview"("orgId", "employeeId", "leavingDate", "round");
