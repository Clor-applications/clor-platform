-- Tenant isolation, fail closed (A-35), for expense claims, their bills and lines,
-- employee advances, expense categories and salary advances asked from the app.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ExpenseCategory', 'ExpenseBill', 'ExpenseClaim', 'ExpenseLine', 'EmployeeAdvance', 'SalaryAdvanceAsk'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (current_setting('clor.bypass', true) = 'on'
             OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))
      WITH CHECK (current_setting('clor.bypass', true) = 'on'
             OR "orgId" = NULLIF(current_setting('clor.org_id', true), ''))$p$, t);
  END LOOP;
END $$;
