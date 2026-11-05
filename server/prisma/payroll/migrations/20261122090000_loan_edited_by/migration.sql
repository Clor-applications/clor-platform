-- Who changed a draft loan after it was made (workflow engine 3a, review of #126): maker-checker refuses them its
-- approval as it does whoever made it. Additive, defaults to nobody; an older API never reads it.
ALTER TABLE "PayrollLoan" ADD COLUMN IF NOT EXISTS "editedByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
