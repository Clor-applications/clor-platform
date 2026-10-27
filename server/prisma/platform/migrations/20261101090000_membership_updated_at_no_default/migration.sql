-- Drift found by the schema check (prisma migrate diff, O-12): the two tables
-- were created with "updatedAt" DEFAULT CURRENT_TIMESTAMP, while schema.prisma declares a plain @updatedAt, which
-- Prisma fills on every write. Dropping the defaults makes the database match.
ALTER TABLE "AccountMembership" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "AccountInvitation" ALTER COLUMN "updatedAt" DROP DEFAULT;
