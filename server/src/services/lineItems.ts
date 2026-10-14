import { prisma } from '../utils/prisma.js';

/**
 * A document line names an item this company really has — by the server's id.
 *
 * Lines were saved with the browser's own item numbers. The browser numbers
 * its items afresh on every load, in the order the server lists them (by
 * name), so adding an item that sorts earlier shifted every number after it:
 * an invoice for 2 Mango read as 2 Apple after the next reload, in the stock
 * figures and everywhere else the line is read by item. The browser now uses
 * the server's ids, and this refuses a line that names anything else, so a
 * stale number cannot reach the books again.
 *
 * A line with no item (a free-text or service line) is fine.
 */
export class UnknownLineItem extends Error {
  status = 400;
  code = 'unknown_item';
  constructor(message: string) {
    super(message);
  }
}

export async function assertLineItemsKnown(accountId: string, orgId: string, lines: unknown) {
  const list = Array.isArray(lines) ? lines : [];
  const ids = [...new Set(list.map((l: any) => String(l?.itemId ?? '').trim()).filter(Boolean))];
  if (!ids.length) return;
  const found = await prisma.itemMaster.findMany({ where: { accountId, orgId, id: { in: ids } }, select: { id: true } });
  const known = new Set(found.map((f) => f.id));
  const missing = ids.filter((id) => !known.has(id));
  if (!missing.length) return;
  const at = list.findIndex((l: any) => missing.includes(String(l?.itemId ?? '').trim()));
  const label = (list[at] as any)?.description || (list[at] as any)?.name || missing[0];
  throw new UnknownLineItem(
    `Line ${at + 1} (${label}) names an item this company does not have. Reload the page and pick the item again.`
  );
}

/** Express-style: returns true when it has answered with the refusal. */
export async function refuseUnknownLineItems(res: any, accountId: string, orgId: string, lines: unknown) {
  try {
    await assertLineItemsKnown(accountId, orgId, lines);
    return false;
  } catch (e: any) {
    if (e instanceof UnknownLineItem) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return true;
    }
    throw e;
  }
}
