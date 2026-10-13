-- Branch status (developer change, 9 Oct 2026). Branches live in the platform
-- database after the split, so this belongs here rather than with accounting.
ALTER TABLE "Branch" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
