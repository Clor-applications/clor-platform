-- Shift swaps between two people (FEATURE-UI-AUDIT gap 24) and request types
-- HR defines with a short form (gap 25). New tables only; nothing existing changes.
CREATE TABLE "ShiftSwap" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requesterEmployeeId" TEXT NOT NULL,
    "colleagueEmployeeId" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASKED',
    "colleagueNote" TEXT,
    "colleagueAnsweredAt" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "scheduleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedByUserId" TEXT NOT NULL,
    "closedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShiftSwap_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftSwap_orgId_status_idx" ON "ShiftSwap"("orgId", "status");
CREATE INDEX "ShiftSwap_orgId_requesterEmployeeId_fromDate_idx" ON "ShiftSwap"("orgId", "requesterEmployeeId", "fromDate");
CREATE INDEX "ShiftSwap_orgId_colleagueEmployeeId_fromDate_idx" ON "ShiftSwap"("orgId", "colleagueEmployeeId", "fromDate");
CREATE INDEX "ShiftSwap_orgId_approvalRequestId_idx" ON "ShiftSwap"("orgId", "approvalRequestId");

CREATE TABLE "RequestForm" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'EVERYONE',
    "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slaDays" INTEGER,
    "template" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequestForm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequestForm_orgId_name_key" ON "RequestForm"("orgId", "name");
CREATE INDEX "RequestForm_orgId_active_idx" ON "RequestForm"("orgId", "active");

CREATE TABLE "RequestFormFile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestFormFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RequestFormFile_orgId_requestId_idx" ON "RequestFormFile"("orgId", "requestId");
CREATE INDEX "RequestFormFile_orgId_employeeId_idx" ON "RequestFormFile"("orgId", "employeeId");

-- Tenant isolation, fail closed (A-35), as every other People table.
ALTER TABLE "ShiftSwap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftSwap" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ShiftSwap";
CREATE POLICY tenant_isolation ON "ShiftSwap"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "RequestForm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestForm" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RequestForm";
CREATE POLICY tenant_isolation ON "RequestForm"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));

ALTER TABLE "RequestFormFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestFormFile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RequestFormFile";
CREATE POLICY tenant_isolation ON "RequestFormFile"
  USING (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on' OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
