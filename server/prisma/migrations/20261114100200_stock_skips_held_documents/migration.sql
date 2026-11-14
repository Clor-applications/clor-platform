-- Documents held for approval or rejected move no stock (Books, 15 Nov 2026).
--
-- Purchase documents can now be held for approval ("Pending Approval") and
-- refused ("Rejected"), as invoices already could. The stock trigger skipped
-- only cancelled documents (and draft invoices and bills), so a held debit
-- note took stock out and a rejected bill left phantom stock in. They now
-- move nothing until they are released.

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
  -- A document held for approval, or refused, has not happened yet.
  IF r."status" IN ('Cancelled', 'Pending Approval', 'Rejected') THEN
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

-- Movements already written for documents in those states are removed. The
-- ledger forces row-level security, so the clean-up runs with the bypass.
SET clor.bypass = 'on';
DELETE FROM "StockMovement" m USING "Invoice" d
  WHERE m."sourceKind" = 'INVOICE' AND m."sourceId" = d."id" AND d."status" IN ('Pending Approval', 'Rejected');
DELETE FROM "StockMovement" m USING "Bill" d
  WHERE m."sourceKind" = 'BILL' AND m."sourceId" = d."id" AND d."status" IN ('Pending Approval', 'Rejected');
DELETE FROM "StockMovement" m USING "CreditNote" d
  WHERE m."sourceKind" = 'CREDIT_NOTE' AND m."sourceId" = d."id" AND d."status" IN ('Pending Approval', 'Rejected');
DELETE FROM "StockMovement" m USING "DebitNote" d
  WHERE m."sourceKind" = 'DEBIT_NOTE' AND m."sourceId" = d."id" AND d."status" IN ('Pending Approval', 'Rejected');
RESET clor.bypass;
