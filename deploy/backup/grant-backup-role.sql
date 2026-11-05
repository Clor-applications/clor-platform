-- The read-only role the off-host backup job connects as. Run ONCE on clor-pg,
-- as the `postgres` user (Cloud SQL Studio in the console, database clor_main).
--
-- Replace PASTE_PASSWORD_HERE with the value of the DB_BACKUP_PASSWORD secret
-- (created with `openssl rand -hex 24 | tr -d '\n'`, so no newline in it):
--   gcloud secrets versions access latest --secret DB_BACKUP_PASSWORD | pbcopy
-- Do not save this file with the password in it, and clear the clipboard after.
--
-- The password is in this statement in clear text. Before running it, check the
-- instance logs no statements: no `log_statement` flag (other than 'none') and
-- no pgaudit (gcloud sql instances describe clor-pg --format='value(settings.databaseFlags)').
-- Neither was set on 5 Nov 2026.
--
-- Run it again after any restore from the off-host copy: the restore leaves
-- grants out (--no-acl).
--
-- Created with SQL, not `gcloud sql users create`: a user made through the
-- Cloud SQL API is put in cloudsqlsuperuser, which a backup reader must not be.
CREATE ROLE clor_backup LOGIN PASSWORD 'PASTE_PASSWORD_HERE'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 2;

-- SELECT on every table and sequence in every database on the instance,
-- including tables future migrations add. It does not bypass row-level
-- security; the backup gets through the policies with clor.bypass, and checks
-- every table still allows that before each dump.
GRANT pg_read_all_data TO clor_backup;

-- If Cloud SQL refuses the line above ("must have admin option"), use this
-- instead, once in EACH of clor_main, clor_payroll, clor_people, clor_platform,
-- connected as clor_app (the role that owns the tables):
--
--   GRANT USAGE ON SCHEMA public TO clor_backup;
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO clor_backup;
--   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO clor_backup;
--   ALTER DEFAULT PRIVILEGES FOR ROLE clor_app IN SCHEMA public GRANT SELECT ON TABLES TO clor_backup;
--   ALTER DEFAULT PRIVILEGES FOR ROLE clor_app IN SCHEMA public GRANT SELECT ON SEQUENCES TO clor_backup;
--
-- Either way the first backup run fails loudly, naming the table, if any
-- table is left unreadable.
