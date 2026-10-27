-- Employment type kinds and working hours (Workforce, 27 Oct 2026). Additive only.
ALTER TABLE "EmployeeType" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'PERMANENT';
ALTER TABLE "Employee" ADD COLUMN "hours" TEXT;

-- Names a company already uses that plainly mean another kind.
SET clor.bypass = 'on';
UPDATE "EmployeeType" SET "category" = 'FIXED_TERM' WHERE lower("name") ~ '(fixed|contract)';
UPDATE "EmployeeType" SET "category" = 'TRAINEE' WHERE lower("name") ~ '(trainee|apprentice)';
UPDATE "EmployeeType" SET "category" = 'INTERN' WHERE lower("name") ~ 'intern';
UPDATE "EmployeeType" SET "category" = 'CONSULTANT' WHERE lower("name") ~ '(consult|freelanc|retainer)';
UPDATE "EmployeeType" SET "category" = 'AGENCY' WHERE lower("name") ~ '(agency|outsourc|third.party|manpower)';
