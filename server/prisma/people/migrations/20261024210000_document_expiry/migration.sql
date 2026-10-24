-- Expiry watch at 60, 30, 7 days and on the day (docs/people/02-PRD.md DOC-03), and
-- what a person may not do while a permit or certificate is lapsed (LIFE-08).
ALTER TABLE "EmployeeDocument" ADD COLUMN "expiryStage" INTEGER;
ALTER TABLE "EmployeeDocument" ADD COLUMN "restrictsWork" TEXT;
CREATE INDEX "EmployeeDocument_orgId_expiresOn_idx" ON "EmployeeDocument"("orgId", "expiresOn");
