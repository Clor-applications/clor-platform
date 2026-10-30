-- A proof taken off an obligation is kept, with who removed it and when (review of PR #69):
-- what was once shown as proof stays on record. Columns only; safe to run twice.
ALTER TABLE "ObligationProof" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);
ALTER TABLE "ObligationProof" ADD COLUMN IF NOT EXISTS "removedByUserId" TEXT;
