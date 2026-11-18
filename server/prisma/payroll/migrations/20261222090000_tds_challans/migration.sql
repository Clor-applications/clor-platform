-- Salary TDS deposits (round 27 pick): one row per challan, against the month
-- whose tax it deposits, so the 24Q can carry the BSR code, date and serial.
-- Additive: a new table. No data is changed.

CREATE TABLE "PayrollTdsChallan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "bsrCode" TEXT NOT NULL,
    "challanSerial" TEXT NOT NULL,
    "depositDate" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollTdsChallan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollTdsChallan_orgId_financialYear_idx" ON "PayrollTdsChallan"("orgId", "financialYear");

-- Tenant isolation, fail closed (A-35).
ALTER TABLE "PayrollTdsChallan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollTdsChallan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollTdsChallan";
CREATE POLICY tenant_isolation ON "PayrollTdsChallan"
  USING (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
  WITH CHECK (current_setting('clor.bypass', true) = 'on'
         OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''));
