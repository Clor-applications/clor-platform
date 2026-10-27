-- People Home's setup list: which steps a company skipped, whether it hid the
-- list, and whether the simple-mode suggestion was shown (services/people/setup.ts).
ALTER TABLE "PeopleSetting" ADD COLUMN "setupState" JSONB;
