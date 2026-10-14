-- Which privacy notice and terms a person was shown at sign-up, and when.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "noticeVersion" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "noticeAcceptedAt" TIMESTAMP(3);
