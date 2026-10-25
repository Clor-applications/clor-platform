-- People who have left (kept, with the reason) and archived companies (read-only, reversible).
ALTER TABLE "User" ADD COLUMN "leftAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "leftReason" TEXT;
ALTER TABLE "User" ADD COLUMN "leftNote" TEXT;
ALTER TABLE "User" ADD COLUMN "lastWorkingDay" TEXT;
ALTER TABLE "User" ADD COLUMN "leftByUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "releasedEmail" TEXT;
ALTER TABLE "Org" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Org" ADD COLUMN "archivedReason" TEXT;
ALTER TABLE "Org" ADD COLUMN "archivedNote" TEXT;
ALTER TABLE "Org" ADD COLUMN "archivedByUserId" TEXT;
