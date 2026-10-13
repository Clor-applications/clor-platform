/**
 * Rate resolution for document lines.
 *
 * Sales priority:
 *   1. the customer's price list (direct or via customer group),
 *   2. the last rate this customer actually paid for the item,
 *   3. the item master's sale price.
 * Purchase priority mirrors it: last rate from this vendor, then the item's
 * purchase price.
 *
 * Price lists live in db.priceLists:
 *   { id, companyId, name, rates: { [itemId]: rate } }
 * A customer points at one via customer.priceListId; a customer group via
 * group.priceListId (customer wins over group).
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Is this list in force on the given date?
 *
 * A price list carries a status and an optional validity window, and both have
 * to be honoured here or they are decoration. A festive rate card that ran
 * 01–31 October and is still quietly discounting invoices in March is the
 * exact failure this guards: the list looks retired on the screen that lists
 * it, and is not retired anywhere it matters.
 *
 * Both bounds are optional and inclusive. A list with neither is open-ended,
 * which is what every list created before these fields existed will be — so
 * nothing that works today stops working.
 */
export function isPriceListInForce(list, onDate) {
  if (!list) return false;
  if (String(list.status || 'active').toLowerCase() === 'inactive') return false;

  const day = String(onDate || '').slice(0, 10);
  if (!day) return true;

  const from = String(list.validFrom || '').slice(0, 10);
  const to = String(list.validTo || '').slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function priceListRate({ db, companyId, customer, itemId, onDate }) {
  const lists = Array.isArray(db?.priceLists) ? db.priceLists.filter((p) => p.companyId === companyId) : [];
  if (!lists.length || !customer) return null;

  const listIds = [];
  if (customer.priceListId != null && customer.priceListId !== '') listIds.push(customer.priceListId);
  if (customer.groupId != null) {
    const group = (db.accountGroups || []).find((g) => g.companyId === companyId && Number(g.id) === Number(customer.groupId));
    if (group?.priceListId != null && group.priceListId !== '') listIds.push(group.priceListId);
  }

  for (const listId of listIds) {
    const list = lists.find((p) => Number(p.id) === Number(listId));
    if (!isPriceListInForce(list, onDate)) continue;
    const rate = num(list?.rates?.[String(itemId)]);
    if (rate != null && rate > 0) return rate;
  }
  return null;
}

/** Newest non-draft document line for this party + item; null if none. */
export function lastRateFor({ docs, partyField, partyId, itemId }) {
  const rows = Array.isArray(docs) ? docs : [];
  let best = null;
  for (const doc of rows) {
    const st = String(doc.status || '').toLowerCase();
    if (st === 'draft' || st === 'cancelled') continue;
    if (partyId != null && String(doc[partyField] ?? '') !== String(partyId)) continue;
    const stamp = String(doc.date || '') + '|' + String(doc.createdAt || '');
    for (const line of Array.isArray(doc.items) ? doc.items : []) {
      if (String(line.itemId ?? '') !== String(itemId)) continue;
      const rate = num(line.rate);
      if (rate == null || rate <= 0) continue;
      if (!best || stamp > best.stamp) best = { rate, stamp, docNumber: doc.number || '' };
    }
  }
  return best ? { rate: best.rate, docNumber: best.docNumber } : null;
}

/** Sales-side rate: price list → last invoice price → item sale price. */
export function resolveSaleRate({ db, companyId, customer, itemId, item, onDate }) {
  const fromList = priceListRate({ db, companyId, customer, itemId, onDate });
  if (fromList != null) return { rate: fromList, source: 'price list' };

  if (customer) {
    const last = lastRateFor({
      docs: (db.invoices || []).filter((i) => i.companyId === companyId),
      partyField: 'customerId',
      partyId: customer.id,
      itemId,
    });
    if (last) return { rate: last.rate, source: `last sold @ ${last.docNumber}` };
  }

  return { rate: Number(item?.salePrice ?? 0) || 0, source: 'item master' };
}

/** Purchase-side rate: last bill price from this vendor → item purchase price. */
export function resolvePurchaseRate({ db, companyId, vendorId, itemId, item }) {
  if (vendorId != null && vendorId !== '') {
    const last = lastRateFor({
      docs: (db.bills || []).filter((b) => b.companyId === companyId),
      partyField: 'vendorId',
      partyId: vendorId,
      itemId,
    });
    if (last) return { rate: last.rate, source: `last bought @ ${last.docNumber}` };
  }
  return { rate: Number(item?.purchasePrice ?? 0) || 0, source: 'item master' };
}

/**
 * What the business last paid for this item, from anyone.
 *
 * A stock transfer has no vendor, so the by-vendor lookup above has nothing to
 * match on. An inter-state movement still has to be valued, and the honest
 * figure is the most recent price actually paid — falling back to the item
 * master only when the item has never been bought.
 */
export function latestPurchaseRate({ db, companyId, itemId, item }) {
  const bills = (db?.bills || []).filter((b) => b.companyId === companyId);
  const last = lastRateFor({ docs: bills, partyField: 'vendorId', partyId: null, itemId });
  if (last) return { rate: last.rate, source: `last bought @ ${last.docNumber}` };
  return { rate: Number(item?.purchasePrice ?? 0) || 0, source: 'item master' };
}
