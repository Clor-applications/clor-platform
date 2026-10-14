import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';

/**
 * Stock on hand, from the ledger the database keeps.
 *
 * The rows are written by triggers (migration 20261014120000_stock_ledger)
 * whenever a stock document or item is written, so this module only reads
 * them — and, at a sale, holds the items still while it checks.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const ROUNDING = 0.005;

const lineItemIds = (lines: unknown): string[] => {
  const list = Array.isArray(lines) ? lines : [];
  return [...new Set(list.map((l: any) => String(l?.itemId ?? '').trim()).filter(Boolean))].sort();
};

/** STOCK items among these ids, with their names, for this company. */
async function stockItems(db: Db, orgId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.itemMaster.findMany({
    where: { orgId, id: { in: ids }, itemType: 'STOCK' },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * On hand per item. Without a warehouse: the whole company. With one: what is
 * in it, plus anything that names no warehouse at all — opening stock saved
 * before items had one, and bills saved before the server kept theirs. Those
 * count against whichever warehouse is asked, as the browser treats opening
 * stock: optimistic until somebody assigns them, where the alternative is a
 * shop whose every purchase sits nowhere and whose every sale is refused.
 */
export async function onHand(
  db: Db,
  orgId: string,
  opts: { itemIds?: string[]; warehouseId?: string | null } = {}
): Promise<Map<string, number>> {
  const wh = String(opts.warehouseId || '').trim() || null;
  const ids = opts.itemIds?.length ? opts.itemIds : null;
  const rows = await db.$queryRaw<Array<{ itemId: string; qty: Prisma.Decimal | null }>>`
    SELECT m."itemId" AS "itemId", SUM(m."qty") AS qty
    FROM "StockMovement" m
    JOIN "ItemMaster" i ON i."id" = m."itemId" AND i."orgId" = m."orgId"
    WHERE m."orgId" = ${orgId}
      AND i."itemType" = 'STOCK'
      AND (${ids}::text[] IS NULL OR m."itemId" = ANY(${ids}::text[]))
      AND (${wh}::text IS NULL OR m."warehouseId" = ${wh} OR m."warehouseId" IS NULL)
    GROUP BY m."itemId"
  `;
  return new Map(rows.map((r) => [r.itemId, Math.round(Number(r.qty ?? 0) * 100) / 100]));
}

/** On hand per item and warehouse, for screens. */
export async function onHandByWarehouse(db: Db, orgId: string, itemIds?: string[]) {
  const ids = itemIds?.length ? itemIds : null;
  const rows = await db.$queryRaw<Array<{ itemId: string; warehouseId: string | null; qty: Prisma.Decimal | null }>>`
    SELECT m."itemId" AS "itemId", m."warehouseId" AS "warehouseId", SUM(m."qty") AS qty
    FROM "StockMovement" m
    JOIN "ItemMaster" i ON i."id" = m."itemId" AND i."orgId" = m."orgId"
    WHERE m."orgId" = ${orgId}
      AND i."itemType" = 'STOCK'
      AND (${ids}::text[] IS NULL OR m."itemId" = ANY(${ids}::text[]))
    GROUP BY m."itemId", m."warehouseId"
  `;
  return rows.map((r) => ({ itemId: r.itemId, warehouseId: r.warehouseId, qty: Math.round(Number(r.qty ?? 0) * 100) / 100 }));
}

export class InsufficientStock extends Error {
  status = 409;
  code = 'insufficient_stock';
  constructor(
    message: string,
    public shortages: Array<{ itemId: string; name: string; onHand: number }>
  ) {
    super(message);
  }
}

/**
 * Holds these items for the rest of the transaction.
 *
 * Two counters selling the last unit each read one on hand, each sell it, and
 * the books say -1. A transaction-scoped advisory lock per item makes the
 * second wait until the first has committed, and then read the truth. Taken in
 * id order, so two sales of the same items cannot deadlock.
 */
async function lockItems(tx: Prisma.TransactionClient, orgId: string, ids: string[]) {
  for (const id of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock:${orgId}:${id}`}, 0))`;
  }
}

/**
 * Write a sale, refusing it if it takes stock below nothing.
 *
 * `write` runs inside the transaction and the triggers move stock as it
 * writes. Each STOCK item on `lines` is read in `warehouseId` (where the
 * document will stand once written) before and after. The write is refused
 * if it leaves an item below zero — unless the item was already that short
 * and this write made it no worse, so fixing a typo on an old invoice is never
 * blocked by a shortage it did not cause. Throws InsufficientStock; the
 * caller's transaction then keeps nothing.
 */
export async function withStockCheck<T>(
  tx: Prisma.TransactionClient,
  ctx: { orgId: string; lines: unknown; warehouseId: string | null | undefined },
  write: () => Promise<T>
): Promise<T> {
  const items = await stockItems(tx, ctx.orgId, lineItemIds(ctx.lines));
  const ids = [...items.keys()].sort();
  if (!ids.length) return write();

  const wh = String(ctx.warehouseId || '').trim() || null;
  await lockItems(tx, ctx.orgId, ids);
  const before = await onHand(tx, ctx.orgId, { itemIds: ids, warehouseId: wh });
  const result = await write();
  const after = await onHand(tx, ctx.orgId, { itemIds: ids, warehouseId: wh });

  const shortages = ids
    .map((id) => ({ itemId: id, name: items.get(id) || id, onHand: after.get(id) ?? 0, was: before.get(id) ?? 0 }))
    .filter((s) => s.onHand < -ROUNDING && s.onHand < s.was - ROUNDING)
    .map(({ was: _was, ...s }) => s);
  if (!shortages.length) return result;

  throw new InsufficientStock(
    shortages.length === 1
      ? `Not enough "${shortages[0].name}" in stock: this would leave it ${Math.abs(shortages[0].onHand)} short.`
      : `Not enough stock: ${shortages.map((s) => `"${s.name}" ${Math.abs(s.onHand)} short`).join(', ')}.`,
    shortages
  );
}
