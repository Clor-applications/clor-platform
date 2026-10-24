-- Employment stints (docs/people/02-PRD.md FND-06, review R-03).
-- A rehire used to overwrite the joining date, losing service history. The
-- first joining date now stays on the person, each stint is a row, and the
-- current stint's start is what Attendance and Payroll keep reading.
ALTER TABLE "Employee" ADD COLUMN "firstJoiningDate" TEXT, ADD COLUMN "currentEpisodeSeq" INTEGER NOT NULL DEFAULT 1;
UPDATE "Employee" SET "firstJoiningDate" = "dateOfJoining" WHERE "firstJoiningDate" IS NULL;

CREATE TABLE "EmploymentEpisode" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "endType" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmploymentEpisode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmploymentEpisode_employeeId_seq_key" ON "EmploymentEpisode"("employeeId", "seq");
CREATE INDEX "EmploymentEpisode_orgId_employeeId_idx" ON "EmploymentEpisode"("orgId", "employeeId");
ALTER TABLE "EmploymentEpisode" ADD CONSTRAINT "EmploymentEpisode_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing person gets their first stint from what is on file.
INSERT INTO "EmploymentEpisode" ("id", "accountId", "orgId", "employeeId", "seq", "startDate", "endDate", "endType", "endReason", "createdAt", "updatedAt")
SELECT 'ep1_' || e."id", e."accountId", e."orgId", e."id", 1,
       COALESCE(e."dateOfJoining", to_char(e."createdAt", 'YYYY-MM-DD')),
       CASE WHEN e."status" = 'LEFT' THEN e."dateOfLeaving" END,
       CASE WHEN e."status" = 'LEFT' THEN e."leavingType" END,
       CASE WHEN e."status" = 'LEFT' THEN e."leavingReason" END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Employee" e;
