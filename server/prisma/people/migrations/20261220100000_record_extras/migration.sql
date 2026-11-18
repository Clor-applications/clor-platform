-- Record extras on the employee file (server picks, theme A, 18 Nov 2026). Additive: nullable columns, two with defaults.
-- HR-only ones (blood group, disability, health note, food, sizes, second emergency contact, permanent address) are
-- hidden from read-only roles by the API, like the existing personal details; the table already has row-level security.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "emergencyContact2Name" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "emergencyContact2Phone" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "emergencyContact2Relation" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permSameAsPresent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permAddressLine" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permCity" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permState" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permCountry" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "permPincode" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "bloodGroup" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "disability" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "healthNote" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "foodPreference" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "shoeSize" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "uniformSize" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "initials" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "officeExtension" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "hireSource" TEXT;
