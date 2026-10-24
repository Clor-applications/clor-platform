-- Teams and seats (docs/people/02-PRD.md ORG-01, ORG-04): a team under a department with
-- a lead; approved seats per team, filled or open; a person sits in a team and a seat.
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "leadEmployeeId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Team_orgId_name_key" ON "Team"("orgId", "name");
CREATE INDEX "Team_accountId_orgId_idx" ON "Team"("accountId", "orgId");

CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" TEXT,
    "jobPositionId" TEXT,
    "budgetRef" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Seat_orgId_name_key" ON "Seat"("orgId", "name");
CREATE INDEX "Seat_orgId_teamId_idx" ON "Seat"("orgId", "teamId");
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Employee" ADD COLUMN "teamId" TEXT;
ALTER TABLE "Employee" ADD COLUMN "seatId" TEXT;
CREATE INDEX "Employee_orgId_teamId_idx" ON "Employee"("orgId", "teamId");
CREATE UNIQUE INDEX "Employee_orgId_seatId_key" ON "Employee"("orgId", "seatId");
