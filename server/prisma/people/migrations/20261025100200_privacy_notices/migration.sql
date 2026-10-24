-- Privacy notices per purpose, in the languages the company enables (docs/people/02-PRD.md PRV-01).
-- A notice is a policy of category PRIVACY: versioned, effective-dated, read receipts through Acknowledgement.
ALTER TABLE "Policy" ADD COLUMN "purpose" TEXT;
ALTER TABLE "PolicyVersion" ADD COLUMN "translations" JSONB;
ALTER TABLE "PeopleSetting" ADD COLUMN "noticeLanguages" JSONB;
