-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "areaId" TEXT,
ADD COLUMN     "attendanceRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cardNumber" TEXT,
ADD COLUMN     "contractorId" TEXT,
ADD COLUMN     "devicePassword" TEXT,
ADD COLUMN     "devicePrivilege" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "guardianName" TEXT,
ADD COLUMN     "leavingReason" TEXT,
ADD COLUMN     "leavingType" TEXT;

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "licenceNo" TEXT,
    "licenceValidTo" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_accountId_orgId_idx" ON "Area"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_orgId_name_key" ON "Area"("orgId", "name");

-- CreateIndex
CREATE INDEX "Contractor_accountId_orgId_idx" ON "Contractor"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_orgId_name_key" ON "Contractor"("orgId", "name");

-- CreateIndex
CREATE INDEX "Employee_accountId_orgId_areaId_idx" ON "Employee"("accountId", "orgId", "areaId");

-- CreateIndex
CREATE INDEX "Employee_accountId_orgId_contractorId_idx" ON "Employee"("accountId", "orgId", "contractorId");

