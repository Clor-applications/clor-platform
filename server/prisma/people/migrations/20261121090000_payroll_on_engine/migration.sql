-- Payroll on the approval engine (docs/people/workflow-engine/SPEC.md section 9, phase 3a): one switch per company,
-- off by default. Off, loans, salary revisions and final settlements are approved exactly as before and nothing new
-- is written. On, a new loan, a revision sent for approval and a new settlement open an ApprovalRequest (sourceKind
-- LOAN, SALARY_REVISION or FINAL_SETTLEMENT) under a preset rule that copies Payroll's own; ones already waiting
-- finish on the old path. Additive; PeopleSetting already has row-level security, and an older API never reads this
-- column.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "payrollOnEngine" BOOLEAN NOT NULL DEFAULT false;
