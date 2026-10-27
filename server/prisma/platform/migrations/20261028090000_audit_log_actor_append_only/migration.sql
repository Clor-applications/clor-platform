-- The audit log names whoever acted, not only CLOR sign-ins. Employee-app
-- actions are written as `portal:<employeeId>`, the leave rule as `system`,
-- the public API as `api:<client>`. The foreign key to "User" refused every
-- one of those rows, and the helpers swallow the error, so manager approvals
-- from the employee app left no audit line at all.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_createdByUserId_fkey";

-- Append-only, like People's change log: nothing edits or removes an audit
-- line, except the purge of a closed company (services/companyClosure.ts),
-- which deletes under clor.purge for that statement only.
CREATE OR REPLACE FUNCTION audit_log_refuse_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('clor.purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'append_only: % rows cannot be changed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_append_only ON "AuditLog";
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_refuse_change();
