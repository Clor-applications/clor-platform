-- A-13: who may approve their own work. AUTO keeps every existing company
-- working (a sole administrator can still run payroll) while blocking
-- self-approval wherever a second approver exists.
ALTER TABLE "AuthPolicy" ADD COLUMN "makerChecker" TEXT NOT NULL DEFAULT 'AUTO';
