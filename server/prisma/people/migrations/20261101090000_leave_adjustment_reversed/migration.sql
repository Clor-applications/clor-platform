-- Undoing a leave year end no longer deletes its pay-outs: each ENCASH row it
-- made is marked reversed, so the trail keeps who was paid what for which
-- year. Every reader skips reversed rows (reversedAt IS NULL). Additive only.
ALTER TABLE "LeaveAdjustment" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "LeaveAdjustment" ADD COLUMN "reversedByUserId" TEXT;
