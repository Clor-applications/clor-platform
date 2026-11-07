-- Held reader punches, final review of #144. Additive; DevicePunch already has row-level security, and an
-- older API never reads these columns.
--
-- clockShiftMinutes: a held punch counted "moved back" for a reader whose clock ran ahead: the minutes taken
--   off the time the reader sent. Null when counted as recorded (and for every punch today).
-- recordedLocalTime: the reader's own time, kept when a punch was moved, so the evidence is never lost.
-- dayPending: a punch counted while its month was closed. Its day was left alone; reopening the month works
--   the day out.
ALTER TABLE "DevicePunch" ADD COLUMN IF NOT EXISTS "clockShiftMinutes" INTEGER;
ALTER TABLE "DevicePunch" ADD COLUMN IF NOT EXISTS "recordedLocalTime" TEXT;
ALTER TABLE "DevicePunch" ADD COLUMN IF NOT EXISTS "dayPending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "DevicePunch_orgId_dayPending_idx" ON "DevicePunch" ("orgId", "shiftDate") WHERE "dayPending";
