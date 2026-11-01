-- Stand-in merge, workflow engine phase 2b (docs/people/workflow-engine/SPEC.md sections 5.3, 6 and 9): one table
-- for every stand-in. "StandIn" (People approval stand-ins, by sign-in) gains the People record ids, what is handed
-- on ("requestTypes"), a note, who named it, and the "ApprovalStandIn" row it is linked to ("legacyId").
--
-- 1. Every People stand-in already here hands on People requests only, as it always did: ['PEOPLE'], never leave or
--    attendance. (A row an older API writes during the deploy gets the column default, an empty list, which the
--    application also reads as ['PEOPLE'].)
-- 2. Every leave delegate in "ApprovalStandIn" is copied in once, handing on leave and attendance as it always did.
--    Its sign-ins stay empty: the older engine and People list select stand-ins by sign-in and expect both, so they
--    never see a leave delegate; the application fills them in from the People records. The old row is kept and
--    linked, so an older API (a rollback) still sees every leave delegate; phase 3c drops the table.
--
-- Safe to run again: columns and indexes are added only when missing, step 1 touches only rows with no list, and a
-- row already copied (same "legacyId") is skipped. Both tables have row-level security, so the data steps run with
-- the bypass on. No existing column loses data: "userId" and "standInUserId" only become optional.

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

UPDATE "StandIn" SET "requestTypes" = ARRAY['PEOPLE']::TEXT[]
WHERE "legacyId" IS NULL AND COALESCE(cardinality("requestTypes"), 0) = 0;

INSERT INTO "StandIn" ("id", "accountId", "orgId", "userId", "standInUserId", "employeeId", "standInEmployeeId", "fromDate", "toDate", "requestTypes", "createdByUserId", "legacyId", "createdAt")
SELECT 'lsi_' || a."id", a."accountId", a."orgId", NULL, NULL, a."managerEmployeeId", a."standInEmployeeId", a."fromDate", a."toDate",
       ARRAY['LEAVE', 'ATTENDANCE']::TEXT[], a."createdByUserId", a."id", a."createdAt"
FROM "ApprovalStandIn" a
WHERE NOT EXISTS (SELECT 1 FROM "StandIn" x WHERE x."legacyId" = a."id")
ON CONFLICT DO NOTHING;

RESET clor.bypass;
