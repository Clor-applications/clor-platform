-- Letters by event (People plan 8 Nov 2026, step 6). Additive; both tables already have row-level security.
-- A letter CLOR issues says which kind it is and what it was issued for, once each per person.
ALTER TABLE "EmployeeDocument" ADD COLUMN IF NOT EXISTS "letterKind" TEXT;
ALTER TABLE "EmployeeDocument" ADD COLUMN IF NOT EXISTS "issuedFor" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeDocument_orgId_employeeId_issuedFor_key" ON "EmployeeDocument"("orgId", "employeeId", "issuedFor");
-- Who signs the letters CLOR issues on its own.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "letterSignatory" TEXT;
