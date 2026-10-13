-- Drop only the foreign keys that cross the platform/accounting boundary in clor_main.
-- The old 27 platform tables stay (inert backup); their internal FKs stay too.
DO $$
DECLARE r record; n int := 0;
  p text[] := ARRAY['Account','Org','Branch','User','UserOrgMembership','UserBranchMembership','UserWarehouseAccess','Role','Permission','RolePermission','UserRoleAssignment','RoleProfile','RoleProfileRole','UserRoleProfile','UserPermission','AuditLog','AccountEntitlement','FeatureSetting','Session','PasswordResetToken','AuthEvent','EmailVerificationToken','NotificationSetting','EmailSetting','EmailOutbox','AuthPolicy','AuthProvider'];
BEGIN
  FOR r IN
    SELECT k.conname, c.relname AS tbl
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class f ON f.oid=k.confrelid
    WHERE k.contype='f' AND k.connamespace='public'::regnamespace
      AND ((c.relname = ANY(p)) <> (f.relname = ANY(p)))
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.conname); n := n + 1;
  END LOOP;
  RAISE NOTICE 'cross-boundary FKs dropped: %', n;
END $$;
