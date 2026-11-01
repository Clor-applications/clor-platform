-- Stand-in merge, workflow engine phase 2b (docs/people/workflow-engine/SPEC.md sections 5.3, 6 and 9): one table
-- for every stand-in. "StandIn" (People approval stand-ins, by sign-in) gains the People record ids, what is handed
-- on, a note and who named it. Every leave delegate in "ApprovalStandIn" (by People record) is copied in once, with
-- the sign-ins its people have today, handing on leave and attendance requests as it always did. Nothing writes to
-- "ApprovalStandIn" any more. It is still read as a fallback, for a row an older API writes during the deploy,
-- until phase 3c drops it.
--
-- Safe to run again: the columns and indexes are added only when missing, and a row already copied (same
-- "legacyId") is skipped. Both tables have row-level security, so the copy runs with the bypass on. No existing
-- column loses data: "userId" and "standInUserId" only become optional, as a leave delegate may have no sign-in.

ALTER TABLE "StandIn" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "StandIn" ALTER COLUMN "standInUserId" DROP NOT NULL;
ALTER TABLE "StandIn" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;
ALTER TABLE "StandIn" ADD COLUMN IF NOT EXISTS "standInEmployeeId" TEXT;
ALTER TABLE "StandIn" ADD COLUMN IF NOT EXISTS "requestTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "StandIn" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "StandIn" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "StandIn" ADD COLUMN IF NOT EXISTS "legacyId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StandIn_legacyId_key" ON "StandIn"("legacyId");
CREATE INDEX IF NOT EXISTS "StandIn_orgId_employeeId_fromDate_toDate_idx" ON "StandIn"("orgId", "employeeId", "fromDate", "toDate");
CREATE INDEX IF NOT EXISTS "StandIn_orgId_standInEmployeeId_fromDate_toDate_idx" ON "StandIn"("orgId", "standInEmployeeId", "fromDate", "toDate");
CREATE INDEX IF NOT EXISTS "StandIn_orgId_standInUserId_fromDate_toDate_idx" ON "StandIn"("orgId", "standInUserId", "fromDate", "toDate");

SET clor.bypass = 'on';

INSERT INTO "StandIn" ("id", "accountId", "orgId", "userId", "standInUserId", "employeeId", "standInEmployeeId", "fromDate", "toDate", "requestTypes", "createdByUserId", "legacyId", "createdAt")
SELECT 'lsi_' || a."id", a."accountId", a."orgId", m."userId", s."userId", a."managerEmployeeId", a."standInEmployeeId", a."fromDate", a."toDate",
       ARRAY['LEAVE', 'ATTENDANCE']::TEXT[], a."createdByUserId", a."id", a."createdAt"
FROM "ApprovalStandIn" a
LEFT JOIN "Employee" m ON m."id" = a."managerEmployeeId" AND m."orgId" = a."orgId"
LEFT JOIN "Employee" s ON s."id" = a."standInEmployeeId" AND s."orgId" = a."orgId"
WHERE NOT EXISTS (SELECT 1 FROM "StandIn" x WHERE x."legacyId" = a."id")
ON CONFLICT DO NOTHING;

RESET clor.bypass;
