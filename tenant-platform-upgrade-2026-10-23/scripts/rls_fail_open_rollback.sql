-- ROLLBACK ONLY. Puts every tenant_isolation policy in this schema back in the
-- pre-A-35 fail-open shape, so code released before A-35 (which never sets
-- clor.bypass) can run again. Run per schema, as the owner, BEFORE rolling the
-- code back past this release. Re-apply 20261024100000_rls_fail_closed when
-- rolling forward. Refuses a policy of a shape it does not recognise.
DO $$
DECLARE
  r record;
  col text;
BEGIN
  FOR r IN
    SELECT tablename, qual FROM pg_policies
    WHERE schemaname = current_schema() AND policyname = 'tenant_isolation'
  LOOP
    col := (regexp_match(r.qual, '\(("?[A-Za-z_]+"?) = NULLIF\(current_setting'))[1];
    IF col IS NULL THEN
      col := (regexp_match(r.qual, '\(("?[A-Za-z_]+"?) = current_setting\(''clor\.org_id''::text, true\)\)'))[1];
    END IF;
    IF col IS NULL THEN
      RAISE EXCEPTION 'tenant_isolation on % has an unexpected shape: %', r.tablename, r.qual;
    END IF;
    EXECUTE format('DROP POLICY tenant_isolation ON %I', r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''clor.org_id'', true) IS NULL OR current_setting(''clor.org_id'', true) = '''' OR %s = current_setting(''clor.org_id'', true)) WITH CHECK (current_setting(''clor.org_id'', true) IS NULL OR current_setting(''clor.org_id'', true) = '''' OR %s = current_setting(''clor.org_id'', true))',
      r.tablename, col, col
    );
  END LOOP;
END $$;
