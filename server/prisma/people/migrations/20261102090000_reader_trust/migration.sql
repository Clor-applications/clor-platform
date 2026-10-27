-- Per-day reader trust (closure audit O-11, TLA-005), an optional company
-- feature (attendanceReaderTrust), off by default. Additive and nullable: a day
-- written while the feature is off keeps null, exactly as before.
ALTER TABLE "AttendanceRecord" ADD COLUMN "trust" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN "trustReasons" JSONB;
CREATE INDEX "AttendanceRecord_orgId_trust_date_idx" ON "AttendanceRecord"("orgId", "trust", "date");

-- The late-upload window: a punch arriving later than this is a "Check".
ALTER TABLE "AttendanceSettings" ADD COLUMN "readerLateUploadHours" INTEGER NOT NULL DEFAULT 24;
