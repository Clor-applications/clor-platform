-- Punch window on a shift, the first punch picking the shift (ERPNext gaps 5-6, batch 2).
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "checkInBeforeMinutes" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "checkOutAfterMinutes" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "autoPick" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceSettings" ADD COLUMN IF NOT EXISTS "autoShiftByPunch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TemporarySchedule" ADD COLUMN IF NOT EXISTS "pickedByPunch" BOOLEAN NOT NULL DEFAULT false;
