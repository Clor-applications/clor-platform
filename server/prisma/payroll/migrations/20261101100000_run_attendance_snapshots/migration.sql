-- The Attendance month snapshots a run's days were taken from (closure audit O-04). Additive.
-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "attendanceSnapshots" JSONB;
