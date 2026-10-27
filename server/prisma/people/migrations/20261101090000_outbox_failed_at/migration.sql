-- An outbox event that used every retry is marked failed, not only parked
-- (closure audit O-07): operators list them (GET /internal/outbox/failed).
-- Additive: one nullable column; events already parked are marked now.

ALTER TABLE "OutboxEvent" ADD COLUMN "failedAt" TIMESTAMP(3);

SET clor.bypass = 'on';

UPDATE "OutboxEvent" SET "failedAt" = CURRENT_TIMESTAMP
WHERE "deliveredAt" IS NULL AND "attempts" > 5 AND "failedAt" IS NULL;
