-- People's own identifiers (masked, last four of Aadhaar only) and the access log (docs/people/02-PRD.md CORE-04, PRV-07).
CREATE TABLE "EmployeeIdentity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "aadhaarLast4" TEXT,
    "passportNumber" TEXT,
    "passportExpiry" TEXT,
    "workPermitNumber" TEXT,
    "workPermitExpiry" TEXT,
    "statutoryCategory" TEXT,
    "categoryFrom" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeIdentity_employeeId_key" ON "EmployeeIdentity"("employeeId");
CREATE INDEX "EmployeeIdentity_orgId_employeeId_idx" ON "EmployeeIdentity"("orgId", "employeeId");

CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "employeeId" TEXT,
    "field" TEXT,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessLog_orgId_employeeId_at_idx" ON "AccessLog"("orgId", "employeeId", "at");
CREATE INDEX "AccessLog_orgId_userId_at_idx" ON "AccessLog"("orgId", "userId", "at");
