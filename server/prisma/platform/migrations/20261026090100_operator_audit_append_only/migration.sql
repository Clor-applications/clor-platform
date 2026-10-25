-- What an operator did stays as it was: no update, no delete, by anybody.
-- No exemption for the maintenance bypass: the application crosses accounts
-- under that bypass, so an exemption would exempt the console itself.
CREATE OR REPLACE FUNCTION operator_audit_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS operator_audit_append_only ON "OperatorAuditEvent";
CREATE TRIGGER operator_audit_append_only BEFORE UPDATE OR DELETE ON "OperatorAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION operator_audit_refuse_change();

