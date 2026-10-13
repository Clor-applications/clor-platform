-- Row-level security: the database's own opinion about which company a query
-- may see.
--
-- Every tenant route filters by orgId, and every one of them is correct today.
-- The problem is the word "today": one forgotten `where` across 52 route files
-- shows another company's invoices, with nothing between the mistake and the
-- customer. Application filtering is a convention, and a convention cannot be
-- enforced. This can.
--
-- The policy compares a row's orgId against `clor.org_id` on the connection,
-- which src/utils/tenantDb.ts sets with SET LOCAL inside a transaction — LOCAL
-- because a plain SET outlives the request on a pooled connection and the next
-- company inherits it.
--
-- FORCE matters: a table's owner is exempt from its own policies unless forced,
-- and the application connects as the owner. Without it these policies would be
-- real, enforced against nobody, and comfortable to believe in.
--
-- ## Why the setting being unset is allowed through
--
-- A policy that denied everything without the setting would be correct and
-- would also take the product down the moment it shipped, because the routes
-- are not converted yet. So an unset setting means "no opinion" and the query
-- proceeds as before, while a setting that is present is enforced exactly.
--
-- That makes conversion incremental and safe: a route moved onto withTenant()
-- gains real enforcement immediately, and a route not yet moved cannot break.
-- The endgame is to delete the first two clauses of each USING, at which point
-- a query that has not said which company it is for sees nothing. Do that when
-- `grep -rn "prisma\." src/routes` returns only converted call sites.

ALTER TABLE "EmployeePayrollProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeePayrollProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmployeePayrollProfile";
CREATE POLICY tenant_isolation ON "EmployeePayrollProfile"
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

ALTER TABLE "EmployeeStatutoryConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeStatutoryConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EmployeeStatutoryConfig";
CREATE POLICY tenant_isolation ON "EmployeeStatutoryConfig"
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

ALTER TABLE "PayGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayGroup" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayGroup";
CREATE POLICY tenant_isolation ON "PayGroup"
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

ALTER TABLE "PayrollAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollAdjustment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollAdjustment";
CREATE POLICY tenant_isolation ON "PayrollAdjustment"
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

ALTER TABLE "PayrollCalculationTrace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollCalculationTrace" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollCalculationTrace";
CREATE POLICY tenant_isolation ON "PayrollCalculationTrace"
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

ALTER TABLE "PayrollInput" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollInput" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollInput";
CREATE POLICY tenant_isolation ON "PayrollInput"
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

ALTER TABLE "PayrollLoan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollLoan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollLoan";
CREATE POLICY tenant_isolation ON "PayrollLoan"
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

ALTER TABLE "PayrollLoanInstallment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollLoanInstallment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollLoanInstallment";
CREATE POLICY tenant_isolation ON "PayrollLoanInstallment"
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

ALTER TABLE "PayrollPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollPayment";
CREATE POLICY tenant_isolation ON "PayrollPayment"
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

ALTER TABLE "PayrollPaymentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPaymentLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollPaymentLine";
CREATE POLICY tenant_isolation ON "PayrollPaymentLine"
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

ALTER TABLE "PayrollPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPeriod" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollPeriod";
CREATE POLICY tenant_isolation ON "PayrollPeriod"
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

ALTER TABLE "PayrollPosting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPosting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollPosting";
CREATE POLICY tenant_isolation ON "PayrollPosting"
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

ALTER TABLE "PayrollPostingLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPostingLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollPostingLine";
CREATE POLICY tenant_isolation ON "PayrollPostingLine"
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

ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollRun";
CREATE POLICY tenant_isolation ON "PayrollRun"
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

ALTER TABLE "PayrollRunEmployee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRunEmployee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollRunEmployee";
CREATE POLICY tenant_isolation ON "PayrollRunEmployee"
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

ALTER TABLE "SalaryAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryAssignment";
CREATE POLICY tenant_isolation ON "SalaryAssignment"
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

ALTER TABLE "SalaryComponent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryComponent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryComponent";
CREATE POLICY tenant_isolation ON "SalaryComponent"
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

ALTER TABLE "SalaryRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryRevision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryRevision";
CREATE POLICY tenant_isolation ON "SalaryRevision"
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

ALTER TABLE "SalarySlip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalarySlip" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalarySlip";
CREATE POLICY tenant_isolation ON "SalarySlip"
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

ALTER TABLE "SalarySlipLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalarySlipLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalarySlipLine";
CREATE POLICY tenant_isolation ON "SalarySlipLine"
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

ALTER TABLE "SalaryStructure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryStructure" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryStructure";
CREATE POLICY tenant_isolation ON "SalaryStructure"
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

ALTER TABLE "SalaryStructureComponent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryStructureComponent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalaryStructureComponent";
CREATE POLICY tenant_isolation ON "SalaryStructureComponent"
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

ALTER TABLE "StatutoryRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StatutoryRule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StatutoryRule";
CREATE POLICY tenant_isolation ON "StatutoryRule"
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

ALTER TABLE "StatutoryScheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StatutoryScheme" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StatutoryScheme";
CREATE POLICY tenant_isolation ON "StatutoryScheme"
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
