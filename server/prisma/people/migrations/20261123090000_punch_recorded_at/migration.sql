-- Held reader punches moved back, re-review of #144. Additive; DevicePunch already has row-level security.
--
-- recordedAt: the instant the reader sent, kept when a held punch was counted moved back (its clock was ahead).
--   Ingest matches it as well as "at", so a reader resending its log never counts the same punch twice.
--   Null for every other punch, so the index holds only the moved ones.
ALTER TABLE "DevicePunch" ADD COLUMN IF NOT EXISTS "recordedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "DevicePunch_orgId_deviceId_recordedAt_idx" ON "DevicePunch" ("orgId", "deviceId", "recordedAt") WHERE "recordedAt" IS NOT NULL;
