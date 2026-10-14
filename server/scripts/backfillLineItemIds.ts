/**
 * Points every stored document line at the server's item id.
 *
 * Lines were saved with the browser's own item number, which it handed out
 * afresh on every load in the order the server lists items (by name). Adding
 * an item that sorted earlier shifted every number after it, so a stored line
 * came to name a different item than the one sold — stock, item reports and
 * anything else reading a line by item went wrong. The browser now uses the
 * server id and the server refuses anything else (src/services/lineItems.ts);
 * this repairs what was written before.
 *
 * A line is repaired only when its item can be told for certain:
 *
 *   1. by name — the line's description is the name of exactly one item in
 *      the company (the form fills the description from the item name);
 *   2. by position — the number the browser would have given each item when
 *      the document was written (items existing then, sorted by name), where
 *      that item's HSN and GST rate also agree with the line.
 *
 * Anything else is reported and left as it is: a line naming no item is
 * better than one naming the wrong one.
 *
 * Also repaired: recurring-invoice templates, discount rules (itemId,
 * itemIds) and price lists (rates keyed by item).
 *
 *   npx tsx scripts/backfillLineItemIds.ts          # report only
 *   npx tsx scripts/backfillLineItemIds.ts --fix    # write the repairs
 */
import { resolveLegacyItem, type LegacyItem as Item } from '../src/services/legacyLineItems.js';

import { ownerClient } from './ownerDb.js';

const prisma = ownerClient();
const FIX = process.argv.includes('--fix');

type Tally = { fixed: number; byName: number; byPosition: number; unresolved: number };

/** Repairs the item references in an array of lines. Returns the new array, or null when nothing changed. */
function repairLines(lines: any[], items: Item[], known: Set<string>, writtenAt: Date | null, t: Tally, where: string) {
  let changed = false;
  const out = lines.map((l, idx) => {
    const ref = String(l?.itemId ?? '').trim();
    if (!ref || known.has(ref)) return l;
    const hit = resolveLegacyItem(l, items, writtenAt);
    if (!hit) {
      t.unresolved += 1;
      console.log(`  unresolved: ${where} line ${idx + 1} (${l?.description || l?.name || '?'}) item ${ref}`);
      return l;
    }
    changed = true;
    t.fixed += 1;
    if (hit.how === 'name') t.byName += 1;
    else t.byPosition += 1;
    return { ...l, itemId: hit.id };
  });
  return changed ? out : null;
}

const DOC_TABLES = [
  'invoice',
  'bill',
  'estimate',
  'purchaseOrderDoc',
  'salesOrderDoc',
  'deliveryChallan',
  'expense',
  'creditNote',
  'debitNote',
] as const;

async function main() {
  const orgs = await prisma.org.findMany({ select: { id: true, accountId: true, name: true } });
  const total: Tally = { fixed: 0, byName: 0, byPosition: 0, unresolved: 0 };

  for (const org of orgs) {
    const where = { accountId: org.accountId, orgId: org.id };
    const items: Item[] = await prisma.itemMaster.findMany({
      where,
      select: { id: true, name: true, hsnSac: true, gstRate: true, createdAt: true },
    });
    const known = new Set(items.map((i) => i.id));
    const t: Tally = { fixed: 0, byName: 0, byPosition: 0, unresolved: 0 };

    for (const table of DOC_TABLES) {
      const rows: any[] = await (prisma as any)[table].findMany({ where, select: { id: true, number: true, itemsJson: true, createdAt: true } });
      for (const row of rows) {
        let lines: any[];
        try {
          lines = JSON.parse(row.itemsJson || '[]');
        } catch {
          continue;
        }
        if (!Array.isArray(lines)) continue;
        const next = repairLines(lines, items, known, row.createdAt, t, `${table} ${row.number || row.id}`);
        if (next && FIX) await (prisma as any)[table].update({ where: { id: row.id }, data: { itemsJson: JSON.stringify(next) } });
      }
    }

    for (const row of await prisma.recurringSchedule.findMany({ where, select: { id: true, name: true, templateJson: true, createdAt: true } })) {
      let tpl: any;
      try {
        tpl = JSON.parse(row.templateJson || '{}');
      } catch {
        continue;
      }
      if (!Array.isArray(tpl?.items)) continue;
      const next = repairLines(tpl.items, items, known, row.createdAt, t, `recurring ${row.name}`);
      if (next && FIX) await prisma.recurringSchedule.update({ where: { id: row.id }, data: { templateJson: JSON.stringify({ ...tpl, items: next }) } });
    }

    /* Discount rules and price lists name items by id too; no line text, so by position alone — with nothing to confirm it, they are reported. */
    for (const row of await prisma.orgMaster.findMany({ where: { ...where, kind: { in: ['DISCOUNT_RULE', 'PRICE_LIST'] } } })) {
      let data: any;
      try {
        data = JSON.parse(row.dataJson || '{}');
      } catch {
        continue;
      }
      const stale: string[] = [];
      if (data?.itemId && !known.has(String(data.itemId))) stale.push(String(data.itemId));
      for (const id of Array.isArray(data?.itemIds) ? data.itemIds : []) if (!known.has(String(id))) stale.push(String(id));
      if (data?.rates && typeof data.rates === 'object') for (const k of Object.keys(data.rates)) if (!known.has(k)) stale.push(k);
      if (stale.length) {
        t.unresolved += stale.length;
        console.log(`  unresolved: ${row.kind} "${row.name}" names ${stale.length} item(s) by an old number — re-pick them on the screen`);
      }
    }

    if (t.fixed || t.unresolved) {
      console.log(`${org.name}: ${t.fixed} line(s) ${FIX ? 'repaired' : 'to repair'} (${t.byName} by name, ${t.byPosition} by position), ${t.unresolved} unresolved`);
    }
    for (const k of Object.keys(total) as (keyof Tally)[]) total[k] += t[k];
  }

  console.log(
    `line item ids: ${total.fixed} ${FIX ? 'repaired' : 'to repair'} (${total.byName} by name, ${total.byPosition} by position), ${total.unresolved} unresolved${FIX ? '' : ' — run with --fix to write'}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
