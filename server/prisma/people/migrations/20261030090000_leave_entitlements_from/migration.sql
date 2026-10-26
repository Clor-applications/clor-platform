-- Entitlement rules added to a leave type already in use apply from the period they were added in (TIME-LEAVE-DECISIONS.md). Additive.
ALTER TABLE "LeaveType" ADD COLUMN "entitlementsFrom" TEXT;
