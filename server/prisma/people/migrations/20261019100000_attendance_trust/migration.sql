-- AlterTable
ALTER TABLE "AttendanceRequest" ADD COLUMN     "beforeCheckIn" TIMESTAMP(3),
ADD COLUMN     "beforeCheckOut" TIMESTAMP(3),
ADD COLUMN     "beforeStatus" TEXT,
ADD COLUMN     "reasonCode" TEXT;

-- CreateTable
CREATE TABLE "AttendanceRecordHistory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "recordId" TEXT,
    "action" TEXT NOT NULL,
    "source" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecordHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceMonthSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rowsJson" TEXT NOT NULL,
    "readinessJson" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceMonthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceExceptionState" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceExceptionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRuleVersion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rulesJson" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT,
    "channel" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "recipients" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhonePunchAttempt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,

    CONSTRAINT "PhonePunchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceRecordHistory_orgId_employeeId_date_idx" ON "AttendanceRecordHistory"("orgId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRecordHistory_accountId_orgId_at_idx" ON "AttendanceRecordHistory"("accountId", "orgId", "at");

-- CreateIndex
CREATE INDEX "AttendanceMonthSnapshot_accountId_orgId_idx" ON "AttendanceMonthSnapshot"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMonthSnapshot_orgId_month_version_key" ON "AttendanceMonthSnapshot"("orgId", "month", "version");

-- CreateIndex
CREATE INDEX "AttendanceExceptionState_accountId_orgId_status_idx" ON "AttendanceExceptionState"("accountId", "orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceExceptionState_orgId_key_key" ON "AttendanceExceptionState"("orgId", "key");

-- CreateIndex
CREATE INDEX "AttendanceRuleVersion_accountId_orgId_idx" ON "AttendanceRuleVersion"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRuleVersion_orgId_version_key" ON "AttendanceRuleVersion"("orgId", "version");

-- CreateIndex
CREATE INDEX "IngestRun_orgId_deviceId_at_idx" ON "IngestRun"("orgId", "deviceId", "at");

-- CreateIndex
CREATE INDEX "IngestRun_accountId_orgId_at_idx" ON "IngestRun"("accountId", "orgId", "at");

-- CreateIndex
CREATE INDEX "ReportRun_orgId_scheduleId_at_idx" ON "ReportRun"("orgId", "scheduleId", "at");

-- CreateIndex
CREATE INDEX "PhonePunchAttempt_orgId_at_idx" ON "PhonePunchAttempt"("orgId", "at");

-- CreateIndex
CREATE INDEX "PhonePunchAttempt_orgId_employeeId_at_idx" ON "PhonePunchAttempt"("orgId", "employeeId", "at");

