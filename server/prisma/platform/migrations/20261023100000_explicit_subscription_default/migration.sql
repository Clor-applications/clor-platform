-- Existing accounts used the historical "no subscription means every app"
-- rule. Mark exactly those accounts before new signups begin failing closed.
ALTER TABLE "Account" ADD COLUMN "legacyUnrestrictedAt" TIMESTAMP(3);

UPDATE "Account"
SET "legacyUnrestrictedAt" = CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Subscription" WHERE "Subscription"."accountId" = "Account"."id"
);
