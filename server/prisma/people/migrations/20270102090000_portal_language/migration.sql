-- The employee app's language, chosen on Me (additive).
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "portalLanguage" TEXT;
