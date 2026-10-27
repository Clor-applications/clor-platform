-- Drift found by the schema check (prisma migrate diff, O-12): 20261009010000
-- gave Warehouse.code DEFAULT '' only so existing rows could be backfilled, and
-- schema.prisma has no default. Every write already supplies a code; dropping
-- the default makes the database match the schema and refuses a code-less row.
ALTER TABLE "Warehouse" ALTER COLUMN "code" DROP DEFAULT;
