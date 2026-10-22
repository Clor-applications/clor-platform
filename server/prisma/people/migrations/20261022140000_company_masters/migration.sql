-- Company master data: business units, grades, cost centres, and where each employee sits.
ALTER TABLE "Employee" ADD COLUMN "businessUnitId" TEXT, ADD COLUMN "gradeId" TEXT, ADD COLUMN "costCenterId" TEXT;

CREATE TABLE "BusinessUnit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessUnit_orgId_name_key" ON "BusinessUnit"("orgId", "name");
CREATE INDEX "BusinessUnit_accountId_orgId_idx" ON "BusinessUnit"("accountId", "orgId");

CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Grade_orgId_name_key" ON "Grade"("orgId", "name");
CREATE INDEX "Grade_accountId_orgId_idx" ON "Grade"("accountId", "orgId");

CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostCenter_orgId_name_key" ON "CostCenter"("orgId", "name");
CREATE INDEX "CostCenter_accountId_orgId_idx" ON "CostCenter"("accountId", "orgId");
