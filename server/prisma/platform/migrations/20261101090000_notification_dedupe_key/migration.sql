-- One notice about one thing, per person (closure audit O-07). Leave and
-- attendance-request notices now go through the People outbox, which retries;
-- the key makes a retry, or a job that runs twice, send once. Additive: a new
-- nullable column and a unique index. Rows written before it have no key, and
-- PostgreSQL treats nulls as distinct, so they never collide.

ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Notification_orgId_userId_dedupeKey_key" ON "Notification"("orgId", "userId", "dedupeKey");

-- The leave digest and lapse notices kept their key inside linkJson
-- ("dedupe":"…"). Carry it into the column, once per person and key (the
-- earliest row), so a lapse notice already sent this year is not sent again.
SET clor.bypass = 'on';

WITH keyed AS (
  SELECT "id", substring("linkJson" from '"dedupe":"([^"]+)"') AS k,
         row_number() OVER (PARTITION BY "orgId", "userId", substring("linkJson" from '"dedupe":"([^"]+)"') ORDER BY "createdAt", "id") AS n
  FROM "Notification"
  WHERE "kind" IN ('attendance.leave_digest', 'attendance.leave_lapse') AND "linkJson" LIKE '%"dedupe":"%'
)
UPDATE "Notification" n SET "dedupeKey" = keyed.k
FROM keyed
WHERE n."id" = keyed."id" AND keyed.n = 1 AND keyed.k IS NOT NULL;
