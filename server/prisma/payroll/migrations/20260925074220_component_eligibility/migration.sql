-- AlterTable
ALTER TABLE "SalaryComponent" ADD COLUMN     "appliesTo" TEXT NOT NULL DEFAULT 'STRUCTURE',
ADD COLUMN     "exceedBehaviour" TEXT NOT NULL DEFAULT 'CAP',
ADD COLUMN     "hasMaxLimit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maximumAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "oneTimeDate" TEXT,
ADD COLUMN     "thresholdAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "thresholdBase" TEXT,
ADD COLUMN     "thresholdOperator" TEXT,
ADD COLUMN     "thresholdRangeEnd" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SalaryComponentCondition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalaryComponentCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryComponentEmployee" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryComponentEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryComponentCondition_accountId_orgId_componentId_idx" ON "SalaryComponentCondition"("accountId", "orgId", "componentId");

-- CreateIndex
CREATE INDEX "SalaryComponentEmployee_accountId_orgId_employeeId_idx" ON "SalaryComponentEmployee"("accountId", "orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryComponentEmployee_componentId_employeeId_key" ON "SalaryComponentEmployee"("componentId", "employeeId");

-- AddForeignKey
ALTER TABLE "SalaryComponentCondition" ADD CONSTRAINT "SalaryComponentCondition_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "SalaryComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryComponentEmployee" ADD CONSTRAINT "SalaryComponentEmployee_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "SalaryComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security for the two tables this migration adds.
--
-- Not optional and not a follow-up: every other tenant table in this schema
-- carries these policies, and a table that arrives without them is the one
-- place a forgotten `where orgId` in a route reaches another company's data.
-- A rule naming an employee is exactly the kind of row that must not be
-- readable across a tenant boundary.
--
-- See prisma/payroll/migrations/20260924120000_row_level_security for the
-- reasoning, including why an unset setting is allowed through while the
-- routes are being converted onto withTenant().
ALTER TABLE "SalaryComponentCondition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryComponentCondition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryComponentCondition";
CREATE POLICY tenant_isolation ON "SalaryComponentCondition"
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

ALTER TABLE "SalaryComponentEmployee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryComponentEmployee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryComponentEmployee";
CREATE POLICY tenant_isolation ON "SalaryComponentEmployee"
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
