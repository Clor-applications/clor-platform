-- A closed company's display code (KAVE-C100), kept on its closure record after
-- the company is deleted, so the code is never issued to another company: it is
-- in old links (/o/KAVE-C100/), its users' IDs (KAVE-C100-U01) and the account
-- code. Backfilled from companies still present.
ALTER TABLE "OrgClosure" ADD COLUMN "orgCode" TEXT;
UPDATE "OrgClosure" c SET "orgCode" = o."code" FROM "Org" o WHERE o."id" = c."orgId" AND c."orgCode" IS NULL;
