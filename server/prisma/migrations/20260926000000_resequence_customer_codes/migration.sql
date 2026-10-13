-- Customer identifiers are six-digit numbers in the 2–5 series. Earlier
-- browser-only masters created values such as CUST-1/CUST-001. Re-allot every
-- existing customer deterministically inside its organisation so old and new
-- records follow one sequence. Party relations use Party.id, so changing this
-- display/business identifier does not break invoices, receipts or ledgers.
WITH ranked AS (
  SELECT
    "id",
    to_char(
      199999 + row_number() OVER (
        PARTITION BY "accountId", "orgId"
        ORDER BY "createdAt", "id"
      ),
      'FM000000'
    ) AS "nextCode"
  FROM "Party"
  WHERE "partyType" IN ('CUSTOMER', 'BOTH')
)
UPDATE "Party" AS target
SET "code" = ranked."nextCode"
FROM ranked
WHERE target."id" = ranked."id";
