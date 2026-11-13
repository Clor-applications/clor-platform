-- Payroll step-up is on unless a company switches it off (platform audit, 11 Nov 2026): approving
-- a pay run, a bank change, a settlement or a payment takes a fresh authenticator code. It was off
-- by default, so nobody had chosen "off"; rows saved for another setting carried the old default.
ALTER TABLE "AuthPolicy" ALTER COLUMN "requirePayrollStepUp" SET DEFAULT true;
UPDATE "AuthPolicy" SET "requirePayrollStepUp" = true WHERE "requirePayrollStepUp" = false;
