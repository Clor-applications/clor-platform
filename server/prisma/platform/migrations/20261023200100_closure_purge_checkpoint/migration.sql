-- A-47: the company purge records how far it got, so a purge cut off by a
-- deploy or a failure resumes after the last store it finished, and a failure
-- is on the record instead of only in a log line.
ALTER TABLE "OrgClosure" ADD COLUMN "purgeProgress" TEXT;
ALTER TABLE "OrgClosure" ADD COLUMN "purgeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgClosure" ADD COLUMN "purgeError" TEXT;
ALTER TABLE "OrgClosure" ADD COLUMN "lastPurgeAt" TIMESTAMP(3);
