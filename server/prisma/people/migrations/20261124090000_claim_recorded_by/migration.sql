-- HR records an expense claim on an employee's behalf (People plan 8 Nov 2026, step 4). Additive;
-- ExpenseClaim already has row-level security.
ALTER TABLE "ExpenseClaim" ADD COLUMN IF NOT EXISTS "recordedByUserId" TEXT;
