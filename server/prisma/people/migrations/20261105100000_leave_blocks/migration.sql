-- Leave block dates (owner, 29 Oct 2026, from ERPNext's Leave Block List):
-- days nobody may ask for leave, for the company or some departments and
-- leave types, with named people still allowed. A new table only, with the
-- tenant policy every People table has. Safe to run twice.
CREATE TABLE IF NOT EXISTS "LeaveBlock" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leaveTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedEmployeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveBlock_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeaveBlock_orgId_fromDate_idx" ON "LeaveBlock"("orgId", "fromDate");

ALTER TABLE "LeaveBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaveBlock";
CREATE POLICY tenant_isolation ON "LeaveBlock"
  USING (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true))
  WITH CHECK (current_setting('clor.org_id', true) IS NULL OR current_setting('clor.org_id', true) = '' OR "orgId" = current_setting('clor.org_id', true));
