-- Time & Leave audit: the manager's note kept apart from HR's decision note. Additive.
ALTER TABLE "LeaveRequest" ADD COLUMN "managerNote" TEXT;
