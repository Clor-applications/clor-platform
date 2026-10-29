-- Leave (owner, 28 Oct 2026): approval through the company's leave approval
-- rule, eligibility by department, branch and grade, and a document asked for
-- with a long request. Additive: every default keeps a type and a request as
-- they were (no rule, everyone eligible, no document asked for). Safe to run
-- twice: the dev databases took it by hand before deploy.
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "gradeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "attachmentAfterDays" DOUBLE PRECISION;

ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "attachmentDocId" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "ruleId" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "ruleStep" INTEGER;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "stepUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "stepDueAt" TIMESTAMP(3);
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "stepRemindedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "LeaveRequest_orgId_status_stepDueAt_idx" ON "LeaveRequest"("orgId", "status", "stepDueAt");
