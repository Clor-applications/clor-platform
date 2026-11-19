-- Cancelling approved leave needs the approver's OK again (round 47): the ask sits on the request (additive).
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "cancelAskedAt" TIMESTAMP(3);
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "cancelAskedBy" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
