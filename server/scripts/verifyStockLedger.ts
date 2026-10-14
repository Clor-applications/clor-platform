/**
 * Checks the stock ledger against the documents it is built from.
 *
 * The ledger is written by triggers (migration 20261014120000_stock_ledger),
 * so it should never drift. This proves it: inside one transaction it
 * rebuilds every document's movements from the document as it now stands,
 * compares the totals per company, item and warehouse with what was stored,
 * and rolls back. With --fix it keeps the rebuild instead.
 *
 * Exits 1 when anything differs, so a deploy that runs it stops loudly.
 *
 *   npx tsx scripts/verifyStockLedger.ts          # report only
 *   npx tsx scripts/verifyStockLedger.ts --fix    # rebuild and keep it
 */
import { ownerClient } from './ownerDb.js';

const prisma = ownerClient();
const FIX = process.argv.includes('--fix');

type Total = { orgId: string; itemId: string; warehouseId: string | null; qty: string };

const totals = (tx: any) =>
  tx.$queryRaw`
    SELECT "orgId", "itemId", "warehouseId", SUM("qty")::text AS qty
    FROM "StockMovement" GROUP BY "orgId", "itemId", "warehouseId"
  ` as Promise<Total[]>;

const key = (t: Total) => `${t.orgId}|${t.itemId}|${t.warehouseId ?? ''}`;

class RollBack extends Error {}

async function main() {
  let drift: string[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        const before = new Map((await totals(tx)).map((t) => [key(t), Number(t.qty)]));
        await tx.$executeRaw`SELECT stock_doc_write('INVOICE', "id") FROM "Invoice"`;
        await tx.$executeRaw`SELECT stock_doc_write('BILL', "id") FROM "Bill"`;
        await tx.$executeRaw`SELECT stock_doc_write('CREDIT_NOTE', "id") FROM "CreditNote"`;
        await tx.$executeRaw`SELECT stock_doc_write('DEBIT_NOTE', "id") FROM "DebitNote"`;
        await tx.$executeRaw`SELECT stock_stockdoc_write("id") FROM "StockDocument"`;
        await tx.$executeRaw`SELECT stock_opening_write("id") FROM "ItemMaster"`;
        // Rows whose document is gone entirely.
        await tx.$executeRaw`
          DELETE FROM "StockMovement" m WHERE
            (m."sourceKind" = 'INVOICE' AND NOT EXISTS (SELECT 1 FROM "Invoice" d WHERE d."id" = m."sourceId")) OR
            (m."sourceKind" = 'BILL' AND NOT EXISTS (SELECT 1 FROM "Bill" d WHERE d."id" = m."sourceId")) OR
            (m."sourceKind" = 'CREDIT_NOTE' AND NOT EXISTS (SELECT 1 FROM "CreditNote" d WHERE d."id" = m."sourceId")) OR
            (m."sourceKind" = 'DEBIT_NOTE' AND NOT EXISTS (SELECT 1 FROM "DebitNote" d WHERE d."id" = m."sourceId")) OR
            (m."sourceKind" IN ('ADJUSTMENT', 'TRANSFER') AND NOT EXISTS (SELECT 1 FROM "StockDocument" d WHERE d."id" = m."sourceId")) OR
            (m."sourceKind" = 'OPENING' AND NOT EXISTS (SELECT 1 FROM "ItemMaster" d WHERE d."id" = m."sourceId"))
        `;
        const after = new Map((await totals(tx)).map((t) => [key(t), Number(t.qty)]));
        for (const k of new Set([...before.keys(), ...after.keys()])) {
          const a = before.get(k) ?? 0;
          const b = after.get(k) ?? 0;
          if (Math.abs(a - b) > 0.005) drift.push(`  ${k}: stored ${a}, documents say ${b}`);
        }
        if (!FIX) throw new RollBack();
      },
      { timeout: 600_000 }
    );
  } catch (e) {
    if (!(e instanceof RollBack)) throw e;
  }

  if (!drift.length) {
    console.log('stock ledger: agrees with every document');
    return;
  }
  console.log(drift.join('\n'));
  console.log(`stock ledger: ${drift.length} total(s) ${FIX ? 'rebuilt' : 'differ — run with --fix to rebuild'}`);
  if (!FIX) process.exitCode = 1;
  drift = [];
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
