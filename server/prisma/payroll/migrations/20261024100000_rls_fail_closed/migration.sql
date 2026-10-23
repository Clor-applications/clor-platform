-- A-35: row-level security fails closed.
--
-- Every tenant_isolation policy let a row through when `clor.org_id` was unset
-- or empty ("no opinion"), so a query that never said which company it was for
-- saw every company's rows. The routes and jobs now say (utils/tenantScope.ts):
-- a request names its company, reads across companies only through
-- outsideTenant(), and background work runs with `clor.bypass` = 'on'.
--
-- So a row is visible only when its company is the one set, or the bypass is
-- on — and to nothing else, including a connection that sets neither.
-- Superusers and roles with BYPASSRLS skip policies altogether; the runtime
-- role must be neither (A-36, scripts/provisionAppRole.mjs).
--
-- Rewrites every tenant_isolation policy in this schema, keeping the column
-- each one compares ("orgId", or id on Org). Refuses to run on a policy of any
-- other shape rather than guess.
DO $$
DECLARE
  r record;
  col text;
BEGIN
  FOR r IN
    SELECT tablename, qual FROM pg_policies
    WHERE schemaname = current_schema() AND policyname = 'tenant_isolation'
  LOOP
    col := (regexp_match(r.qual, '\(("?[A-Za-z_]+"?) = current_setting\(''clor\.org_id''::text, true\)\)'))[1];
    IF col IS NULL THEN
      col := (regexp_match(r.qual, '\(("?[A-Za-z_]+"?) = NULLIF\(current_setting'))[1];
    END IF;
    IF col IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation on % has an unexpected shape: %', r.tablename, r.qual;
    END IF;
    EXECUTE format('DROP POLICY tenant_isolation ON %I', r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''clor.bypass'', true) = ''on'' OR %s = NULLIF(current_setting(''clor.org_id'', true), '''')) WITH CHECK (current_setting(''clor.bypass'', true) = ''on'' OR %s = NULLIF(current_setting(''clor.org_id'', true), ''''))',
      r.tablename, col, col
    );
  END LOOP;
END $$;
