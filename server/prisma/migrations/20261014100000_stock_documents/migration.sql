-- Stock documents on the server: adjustments and transfers the browser
-- raises, shared across devices. See the StockDocument model.
--
-- Written IF NOT EXISTS throughout: the test suite builds tables with
-- `prisma db push` and then replays this file for its policy, so the table
-- may already be there. A deploy runs it once through `migrate deploy`.

CREATE TABLE IF NOT EXISTS "StockDocument" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "number" TEXT,
    "date" TEXT NOT NULL,
    "status" TEXT,
    "branchId" TEXT,
    "warehouseId" TEXT,
    "targetBranchId" TEXT,
    "targetWarehouseId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockDocument_orgId_kind_uid_key" ON "StockDocument"("orgId", "kind", "uid");
CREATE INDEX IF NOT EXISTS "StockDocument_accountId_orgId_kind_idx" ON "StockDocument"("accountId", "orgId", "kind");

-- The same company boundary every tenant table carries (see
-- 20260924120000_row_level_security for why an unset setting passes).
ALTER TABLE "StockDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockDocument";
CREATE POLICY tenant_isolation ON "StockDocument"
  USING (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  )
  WITH CHECK (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  );
