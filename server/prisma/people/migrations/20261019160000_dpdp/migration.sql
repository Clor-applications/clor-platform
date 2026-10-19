-- DPDP: copies of fingerprints and faces are opt-in per company and per
-- person; the company's privacy contact; when notices were read; answer-by
-- dates on data requests; and a breach register.
ALTER TABLE "AttendanceSettings" ADD COLUMN "biometricCopy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceSettings" ADD COLUMN "biometricCopyAt" TIMESTAMP(3);
ALTER TABLE "AttendanceSettings" ADD COLUMN "biometricCopyBy" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "privacyContactName" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "privacyContactEmail" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "privacyContactPhone" TEXT;
ALTER TABLE "AttendanceSettings" ADD COLUMN "privacyNoticeAt" TIMESTAMP(3);

ALTER TABLE "Employee" ADD COLUMN "biometricOptOutAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "privacyNoticeVersion" TEXT;
ALTER TABLE "Employee" ADD COLUMN "privacyNoticeAckAt" TIMESTAMP(3);

ALTER TABLE "DataRequest" ADD COLUMN "dueAt" TIMESTAMP(3);
UPDATE "DataRequest" SET "dueAt" = "createdAt" + interval '30 days' WHERE "dueAt" IS NULL;

CREATE TABLE "DataBreach" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "occurredFrom" TIMESTAMP(3),
    "occurredTo" TIMESTAMP(3),
    "categories" TEXT NOT NULL,
    "employeeIdsJson" TEXT NOT NULL DEFAULT '[]',
    "consequences" TEXT NOT NULL,
    "mitigation" TEXT NOT NULL,
    "stepsForPeople" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "boardIntimatedAt" TIMESTAMP(3),
    "boardReportAt" TIMESTAMP(3),
    "boardReference" TEXT,
    "peopleNotifiedAt" TIMESTAMP(3),
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataBreach_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataBreach_orgId_status_idx" ON "DataBreach"("orgId", "status");
