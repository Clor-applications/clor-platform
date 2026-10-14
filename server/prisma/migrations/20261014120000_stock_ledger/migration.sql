-- The stock ledger: every quantity that moved, kept by the database itself.
--
-- Stock was only ever worked out in the browser, from whatever documents that
-- browser had loaded. Nothing on the server knew what was on hand, so nothing
-- could stop two counters selling the last unit twice.
--
-- Triggers write the rows. A route, an import, a recurring run, a script or a
-- psql session that writes a stock document moves stock here in the same
-- transaction, from the row's own content: a document's movements are
-- deleted and rebuilt from what it now says, so they cannot drift from it.
-- The rules are the browser's (packages/ui/src/utils/inventory.js):
--   invoice OUT, bill IN, unless Draft or Cancelled;
--   debit note OUT, credit note IN, unless Cancelled;
--   adjustment by its signed qtyDelta;
--   transfer OUT of source once dispatched, IN to target once received,
--     for the received quantity; a shortfall returned to source never left;
--   opening stock from the item.

ALTER TABLE "ItemMaster" ADD COLUMN IF NOT EXISTS "openingWarehouseId" TEXT;

CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "warehouseId" TEXT,
    "itemId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockMovement_orgId_itemId_warehouseId_idx" ON "StockMovement"("orgId", "itemId", "warehouseId");
CREATE INDEX IF NOT EXISTS "StockMovement_sourceKind_sourceId_idx" ON "StockMovement"("sourceKind", "sourceId");

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockMovement";
CREATE POLICY tenant_isolation ON "StockMovement"
  USING (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  )
  WITH CHECK (
    current_setting('clor.org_id', true) IS NULL
    OR current_setting('clor.org_id', true) = ''
    OR "orgId" = current_setting('clor.org_id', true)
  );

-- JSON stored as text. Malformed text is no lines, never a failed write.
CREATE OR REPLACE FUNCTION stock_json(t text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  RETURN COALESCE(NULLIF(t, ''), 'null')::jsonb;
EXCEPTION WHEN others THEN
  RETURN 'null'::jsonb;
END
$fn$;

-- A JSON array, or an empty one.
CREATE OR REPLACE FUNCTION stock_lines(j jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END
$fn$;

-- A number from a JSON number or numeric string, to two places; else 0.
CREATE OR REPLACE FUNCTION stock_num(v jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) NOT IN ('number', 'string') THEN
    RETURN 0;
  END IF;
  RETURN round((v #>> '{}')::numeric, 2);
EXCEPTION WHEN others THEN
  RETURN 0;
END
$fn$;

-- One invoice, bill, credit note or debit note: its movements rebuilt.
CREATE OR REPLACE FUNCTION stock_doc_write(p_kind text, p_id text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  tbl text;
  sgn numeric;
  r record;
  n integer;
BEGIN
  tbl := CASE p_kind
    WHEN 'INVOICE' THEN 'Invoice'
    WHEN 'BILL' THEN 'Bill'
    WHEN 'CREDIT_NOTE' THEN 'CreditNote'
    WHEN 'DEBIT_NOTE' THEN 'DebitNote'
  END;
  IF tbl IS NULL THEN
    RAISE EXCEPTION 'stock_doc_write: unknown kind %', p_kind;
  END IF;
  sgn := CASE WHEN p_kind IN ('INVOICE', 'DEBIT_NOTE') THEN -1 ELSE 1 END;

  DELETE FROM "StockMovement" WHERE "sourceKind" = p_kind AND "sourceId" = p_id;

  EXECUTE format(
    'SELECT "accountId", "orgId", "branchId", "warehouseId", "number", "date", "status", "itemsJson" FROM %I WHERE "id" = $1',
    tbl
  ) INTO r USING p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN;
  END IF;
  IF r."status" = 'Cancelled' THEN
    RETURN;
  END IF;
  IF p_kind IN ('INVOICE', 'BILL') AND r."status" = 'Draft' THEN
    RETURN;
  END IF;

  INSERT INTO "StockMovement"
    ("accountId", "orgId", "branchId", "warehouseId", "itemId", "date", "qty", "sourceKind", "sourceId", "sourceNo", "lineNo")
  SELECT r."accountId", r."orgId", r."branchId", NULLIF(r."warehouseId", ''), l.value ->> 'itemId', r."date",
         sgn * stock_num(l.value -> 'quantity'), p_kind, p_id, r."number", l.ord::integer
  FROM jsonb_array_elements(stock_lines(stock_json(r."itemsJson"))) WITH ORDINALITY AS l(value, ord)
  WHERE COALESCE(l.value ->> 'itemId', '') <> ''
    AND stock_num(l.value -> 'quantity') > 0;
END
$fn$;

-- One stock adjustment or transfer: its movements rebuilt.
CREATE OR REPLACE FUNCTION stock_stockdoc_write(p_id text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  p jsonb;
  landed boolean;
  returned boolean;
BEGIN
  DELETE FROM "StockMovement" WHERE "sourceKind" IN ('ADJUSTMENT', 'TRANSFER') AND "sourceId" = p_id;

  SELECT * INTO r FROM "StockDocument" WHERE "id" = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  p := stock_json(r."payloadJson");
  IF jsonb_typeof(p) <> 'object' THEN
    RETURN;
  END IF;

  IF r."kind" = 'ADJUSTMENT' THEN
    INSERT INTO "StockMovement"
      ("accountId", "orgId", "branchId", "warehouseId", "itemId", "date", "qty", "sourceKind", "sourceId", "sourceNo", "lineNo")
    SELECT r."accountId", r."orgId", r."branchId", NULLIF(r."warehouseId", ''),
           COALESCE(NULLIF(p ->> 'itemBackendId', ''), p ->> 'itemId'), r."date",
           stock_num(p -> 'qtyDelta'), 'ADJUSTMENT', r."id", r."number", 1
    WHERE COALESCE(NULLIF(p ->> 'itemBackendId', ''), p ->> 'itemId', '') <> ''
      AND stock_num(p -> 'qtyDelta') <> 0;
    RETURN;
  END IF;

  IF r."kind" <> 'TRANSFER' THEN
    RETURN;
  END IF;
  IF COALESCE(r."status", '') NOT IN
     ('Transferred Out', 'In Transit', 'Transfer In', 'Received', 'Short Received', 'Closed', 'Approved') THEN
    RETURN;
  END IF;
  landed := r."status" IN ('Transfer In', 'Received', 'Short Received', 'Closed', 'Approved');
  returned := COALESCE(p ->> 'mismatchResolution', '') = 'RETURN';

  -- Out of the source: what was sent, or only what arrived when the
  -- shortfall went back to the sender.
  INSERT INTO "StockMovement"
    ("accountId", "orgId", "branchId", "warehouseId", "itemId", "date", "qty", "sourceKind", "sourceId", "sourceNo", "lineNo")
  SELECT r."accountId", r."orgId", r."branchId", r."warehouseId",
         COALESCE(NULLIF(l.value ->> 'itemBackendId', ''), l.value ->> 'itemId'), r."date",
         -1 * CASE
           WHEN returned AND landed THEN greatest(0, stock_num(COALESCE(l.value -> 'receivedQty', l.value -> 'qty', l.value -> 'quantity')))
           ELSE greatest(0, stock_num(COALESCE(l.value -> 'qty', l.value -> 'quantity')))
         END,
         'TRANSFER', r."id", r."number", l.ord::integer
  FROM jsonb_array_elements(stock_lines(p -> 'lines')) WITH ORDINALITY AS l(value, ord)
  WHERE COALESCE(r."warehouseId", '') <> ''
    AND COALESCE(NULLIF(l.value ->> 'itemBackendId', ''), l.value ->> 'itemId', '') <> ''
    AND greatest(0, stock_num(COALESCE(l.value -> 'qty', l.value -> 'quantity'))) > 0;

  -- Into the target, for what was counted in.
  IF landed THEN
    INSERT INTO "StockMovement"
      ("accountId", "orgId", "branchId", "warehouseId", "itemId", "date", "qty", "sourceKind", "sourceId", "sourceNo", "lineNo")
    SELECT r."accountId", r."orgId", COALESCE(r."targetBranchId", r."branchId"), r."targetWarehouseId",
           COALESCE(NULLIF(l.value ->> 'itemBackendId', ''), l.value ->> 'itemId'), r."date",
           greatest(0, stock_num(COALESCE(l.value -> 'receivedQty', l.value -> 'qty', l.value -> 'quantity'))),
           'TRANSFER', r."id", r."number", 1000 + l.ord::integer
    FROM jsonb_array_elements(stock_lines(p -> 'lines')) WITH ORDINALITY AS l(value, ord)
    WHERE COALESCE(r."targetWarehouseId", '') <> ''
      AND COALESCE(NULLIF(l.value ->> 'itemBackendId', ''), l.value ->> 'itemId', '') <> ''
      AND greatest(0, stock_num(COALESCE(l.value -> 'qty', l.value -> 'quantity'))) > 0
      AND greatest(0, stock_num(COALESCE(l.value -> 'receivedQty', l.value -> 'qty', l.value -> 'quantity'))) > 0;
  END IF;
END
$fn$;

-- An item's opening stock.
CREATE OR REPLACE FUNCTION stock_opening_write(p_id text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
BEGIN
  DELETE FROM "StockMovement" WHERE "sourceKind" = 'OPENING' AND "sourceId" = p_id;
  SELECT "accountId", "orgId", "branchId", "openingQty", "openingWarehouseId", "code" INTO r FROM "ItemMaster" WHERE "id" = p_id;
  IF NOT FOUND OR round(COALESCE(r."openingQty", 0), 2) <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO "StockMovement"
    ("accountId", "orgId", "branchId", "warehouseId", "itemId", "date", "qty", "sourceKind", "sourceId", "sourceNo", "lineNo")
  VALUES (r."accountId", r."orgId", r."branchId", NULLIF(r."openingWarehouseId", ''), p_id, '0000-00-00',
          round(r."openingQty", 2), 'OPENING', p_id, r."code", 0);
END
$fn$;

CREATE OR REPLACE FUNCTION stock_doc_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "StockMovement" WHERE "sourceKind" = TG_ARGV[0] AND "sourceId" = OLD."id";
    RETURN OLD;
  END IF;
  -- A payment settling an invoice rewrites the row; its stock has not moved.
  IF TG_OP = 'UPDATE'
     AND NEW."itemsJson" IS NOT DISTINCT FROM OLD."itemsJson"
     AND NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."date" IS NOT DISTINCT FROM OLD."date"
     AND NEW."warehouseId" IS NOT DISTINCT FROM OLD."warehouseId"
     AND NEW."branchId" IS NOT DISTINCT FROM OLD."branchId"
     AND NEW."number" IS NOT DISTINCT FROM OLD."number" THEN
    RETURN NEW;
  END IF;
  PERFORM stock_doc_write(TG_ARGV[0], NEW."id");
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION stock_stockdoc_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "StockMovement" WHERE "sourceKind" IN ('ADJUSTMENT', 'TRANSFER') AND "sourceId" = OLD."id";
    RETURN OLD;
  END IF;
  PERFORM stock_stockdoc_write(NEW."id");
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION stock_opening_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "StockMovement" WHERE "sourceKind" = 'OPENING' AND "sourceId" = OLD."id";
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW."openingQty" IS NOT DISTINCT FROM OLD."openingQty"
     AND NEW."openingWarehouseId" IS NOT DISTINCT FROM OLD."openingWarehouseId"
     AND NEW."branchId" IS NOT DISTINCT FROM OLD."branchId"
     AND NEW."code" IS NOT DISTINCT FROM OLD."code" THEN
    RETURN NEW;
  END IF;
  PERFORM stock_opening_write(NEW."id");
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS stock_movements ON "Invoice";
CREATE TRIGGER stock_movements AFTER INSERT OR UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION stock_doc_trigger('INVOICE');
DROP TRIGGER IF EXISTS stock_movements ON "Bill";
CREATE TRIGGER stock_movements AFTER INSERT OR UPDATE OR DELETE ON "Bill"
  FOR EACH ROW EXECUTE FUNCTION stock_doc_trigger('BILL');
DROP TRIGGER IF EXISTS stock_movements ON "CreditNote";
CREATE TRIGGER stock_movements AFTER INSERT OR UPDATE OR DELETE ON "CreditNote"
  FOR EACH ROW EXECUTE FUNCTION stock_doc_trigger('CREDIT_NOTE');
DROP TRIGGER IF EXISTS stock_movements ON "DebitNote";
CREATE TRIGGER stock_movements AFTER INSERT OR UPDATE OR DELETE ON "DebitNote"
  FOR EACH ROW EXECUTE FUNCTION stock_doc_trigger('DEBIT_NOTE');
DROP TRIGGER IF EXISTS stock_movements ON "StockDocument";
CREATE TRIGGER stock_movements AFTER INSERT OR UPDATE OR DELETE ON "StockDocument"
  FOR EACH ROW EXECUTE FUNCTION stock_stockdoc_trigger();
DROP TRIGGER IF EXISTS stock_movements ON "ItemMaster";
CREATE TRIGGER stock_movements AFTER INSERT OR UPDATE OR DELETE ON "ItemMaster"
  FOR EACH ROW EXECUTE FUNCTION stock_opening_trigger();

-- Everything already written, filled in once. Each call deletes before it
-- inserts, so running this again changes nothing.
SELECT stock_doc_write('INVOICE', "id") FROM "Invoice";
SELECT stock_doc_write('BILL', "id") FROM "Bill";
SELECT stock_doc_write('CREDIT_NOTE', "id") FROM "CreditNote";
SELECT stock_doc_write('DEBIT_NOTE', "id") FROM "DebitNote";
SELECT stock_stockdoc_write("id") FROM "StockDocument";
SELECT stock_opening_write("id") FROM "ItemMaster";
