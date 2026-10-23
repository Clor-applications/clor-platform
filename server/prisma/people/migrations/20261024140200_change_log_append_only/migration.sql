-- The change log is append-only: nothing edits or removes a line except the
-- retention job, which runs under the bypass.
CREATE OR REPLACE FUNCTION people_refuse_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('clor.bypass', true) = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER change_log_append_only BEFORE UPDATE OR DELETE ON "ChangeLog"
  FOR EACH ROW EXECUTE FUNCTION people_refuse_change();
