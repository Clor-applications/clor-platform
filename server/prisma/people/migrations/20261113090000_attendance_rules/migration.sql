-- Attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6, B19): late-mark penalties decided
-- per month, the missing-punch notices sent, absence cases and their notices, and women's night-work
-- consent. Additive only: the new settings column defaults to {} (each rule at its default; nothing that
-- costs pay is on). Policies in the next migration.

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN     "timeRules" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AttendancePenalty" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lateMarks" INTEGER NOT NULL DEFAULT 0,
    "earlyMarks" INTEGER NOT NULL DEFAULT 0,
    "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fromLeave" JSONB NOT NULL DEFAULT '[]',
    "lossOfPayDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "ruleVersion" INTEGER NOT NULL DEFAULT 0,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePenalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceNudge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sentOn" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "days" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceNudge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceCase" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "lastAbsentDate" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "lastWorkingDay" TEXT,
    "holdReason" TEXT,
    "heldAt" TIMESTAMP(3),
    "heldByUserId" TEXT,
    "holdReleasedAt" TIMESTAMP(3),
    "holdReleaseNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsenceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceNotice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "reportBy" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emailTo" TEXT,
    "emailStatus" TEXT,
    "emailOutboxId" TEXT,
    "documentId" TEXT,
    "postRef" TEXT,
    "text" TEXT NOT NULL,
    "sentByUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NightWorkConsent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "onDate" TEXT NOT NULL,
    "note" TEXT,
    "documentId" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NightWorkConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendancePenalty_orgId_month_idx" ON "AttendancePenalty"("orgId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePenalty_orgId_employeeId_month_key" ON "AttendancePenalty"("orgId", "employeeId", "month");

-- CreateIndex
CREATE INDEX "AttendanceNudge_orgId_sentOn_idx" ON "AttendanceNudge"("orgId", "sentOn");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceNudge_orgId_employeeId_sentOn_kind_key" ON "AttendanceNudge"("orgId", "employeeId", "sentOn", "kind");

-- CreateIndex
CREATE INDEX "AbsenceCase_orgId_status_idx" ON "AbsenceCase"("orgId", "status");

-- CreateIndex
CREATE INDEX "AbsenceCase_orgId_employeeId_idx" ON "AbsenceCase"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "AbsenceNotice_orgId_employeeId_idx" ON "AbsenceNotice"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceNotice_caseId_seq_key" ON "AbsenceNotice"("caseId", "seq");

-- CreateIndex
CREATE INDEX "NightWorkConsent_orgId_employeeId_createdAt_idx" ON "NightWorkConsent"("orgId", "employeeId", "createdAt");

