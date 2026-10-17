-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN "leaveApproval" TEXT NOT NULL DEFAULT 'HR',
ADD COLUMN "correctionApproval" TEXT NOT NULL DEFAULT 'HR';

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN "managerApprovedAt" TIMESTAMP(3),
ADD COLUMN "managerApprovedById" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRequest" ADD COLUMN "managerApprovedAt" TIMESTAMP(3),
ADD COLUMN "managerApprovedById" TEXT;

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "expiresOn" TEXT,
    "visibleToEmployee" BOOLEAN NOT NULL DEFAULT true,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolution" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDocument_orgId_employeeId_idx" ON "EmployeeDocument"("orgId", "employeeId");
CREATE INDEX "DataRequest_orgId_status_idx" ON "DataRequest"("orgId", "status");
CREATE INDEX "DataRequest_orgId_employeeId_idx" ON "DataRequest"("orgId", "employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
