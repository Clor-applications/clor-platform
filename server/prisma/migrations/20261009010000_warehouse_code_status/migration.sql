ALTER TABLE "Warehouse" ADD COLUMN "code" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Warehouse" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Existing warehouses get WH- plus the last six characters of their id.
-- (PostgreSQL's substr(id, -6) returns the whole string, unlike SQLite's.)
UPDATE "Warehouse"
SET "code" = 'WH-' || upper(right("id", 6))
WHERE "code" = '';

CREATE UNIQUE INDEX "Warehouse_orgId_code_key" ON "Warehouse"("orgId", "code");
