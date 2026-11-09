-- Who chose a single sign-on provider's default role, so it is given only while they still hold what it grants.
-- Additive: providers saved before this have none, and their role is checked as before (in company, not an administrator's).
ALTER TABLE "AuthProvider" ADD COLUMN IF NOT EXISTS "defaultRoleSetByUserId" TEXT;
