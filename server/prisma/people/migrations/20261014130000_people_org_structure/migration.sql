-- People app: org structure (departments, job positions and roles, employee
-- and work types), tags and notes, and the personal/work fields on Employee.
-- Modelled after Horilla HRMS's employee and base modules (design reference;
-- no code taken). Additive only: new nullable columns and new tables.
--
-- Every new table gets the same tenant_isolation policy as Employee (see
-- 20260924120000_row_level_security for why an unset clor.org_id passes).

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contractEndDate" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "dateOfBirth" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT,
ADD COLUMN     "employeeTypeId" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "jobPositionId" TEXT,
ADD COLUMN     "jobRoleId" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "probationEndDate" TEXT,
ADD COLUMN     "reportingManagerId" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "workEmail" TEXT,
ADD COLUMN     "workLocation" TEXT,
ADD COLUMN     "workPhone" TEXT,
ADD COLUMN     "workTypeId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
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

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRole" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobPositionId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeType" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkType" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTag" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#E54F38',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTagLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EmployeeTagLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeNote" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Department_accountId_orgId_idx" ON "Department"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_name_key" ON "Department"("orgId", "name");

-- CreateIndex
CREATE INDEX "JobPosition_accountId_orgId_departmentId_idx" ON "JobPosition"("accountId", "orgId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosition_orgId_name_key" ON "JobPosition"("orgId", "name");

-- CreateIndex
CREATE INDEX "JobRole_accountId_orgId_jobPositionId_idx" ON "JobRole"("accountId", "orgId", "jobPositionId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRole_orgId_jobPositionId_name_key" ON "JobRole"("orgId", "jobPositionId", "name");

-- CreateIndex
CREATE INDEX "EmployeeType_accountId_orgId_idx" ON "EmployeeType"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeType_orgId_name_key" ON "EmployeeType"("orgId", "name");

-- CreateIndex
CREATE INDEX "WorkType_accountId_orgId_idx" ON "WorkType"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkType_orgId_name_key" ON "WorkType"("orgId", "name");

-- CreateIndex
CREATE INDEX "EmployeeTag_accountId_orgId_idx" ON "EmployeeTag"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTag_orgId_name_key" ON "EmployeeTag"("orgId", "name");

-- CreateIndex
CREATE INDEX "EmployeeTagLink_accountId_orgId_tagId_idx" ON "EmployeeTagLink"("accountId", "orgId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTagLink_employeeId_tagId_key" ON "EmployeeTagLink"("employeeId", "tagId");

-- CreateIndex
CREATE INDEX "EmployeeNote_accountId_orgId_employeeId_idx" ON "EmployeeNote"("accountId", "orgId", "employeeId");

-- CreateIndex
CREATE INDEX "Employee_accountId_orgId_departmentId_idx" ON "Employee"("accountId", "orgId", "departmentId");

-- CreateIndex
CREATE INDEX "Employee_accountId_orgId_reportingManagerId_idx" ON "Employee"("accountId", "orgId", "reportingManagerId");

-- AddForeignKey
ALTER TABLE "EmployeeTagLink" ADD CONSTRAINT "EmployeeTagLink_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTagLink" ADD CONSTRAINT "EmployeeTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "EmployeeTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
