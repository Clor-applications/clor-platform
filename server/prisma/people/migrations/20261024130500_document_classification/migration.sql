-- Who can see an employee document (docs/people/02-PRD.md DOC-01, review R-01).
-- Until now any role with Employees VIEW could open every document, and
-- "visibleToEmployee" only filtered the employee app. Each document now names
-- its classification; the old flag stays in step for the employee app.
ALTER TABLE "EmployeeDocument" ADD COLUMN "classification" TEXT NOT NULL DEFAULT 'EMPLOYEE_VISIBLE';
UPDATE "EmployeeDocument" SET "classification" = 'HR_ONLY' WHERE "visibleToEmployee" = false;
