-- Email retries (platform audit, 11 Nov 2026): a failed message is sent again by a
-- background job, later each time, and a message left unsent by a crash is picked up.
-- "nextAttemptAt" is when the job tries a FAILED row again (null: no more automatic
-- tries); "claimedAt" marks a row one sender has in hand, so two never send it.
-- Additive: rows that failed before this keep nextAttemptAt null and are not re-sent.
ALTER TABLE "EmailOutbox" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "EmailOutbox" ADD COLUMN "claimedAt" TIMESTAMP(3);
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
