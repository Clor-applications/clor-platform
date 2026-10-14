/**
 * An item is known by the server's id, in this browser and on the server.
 *
 * Items used to get a fresh local number on every load, handed out in the
 * order the server lists them (by name). Document lines stored that number,
 * so adding an item that sorted earlier shifted every number after it and an
 * invoice for Mango read as Apple after the next reload — in the stock
 * figures, the item reports and everywhere else a line is read by item.
 *
 * Now an item's local id IS its server id. The one case where a local number
 * survives is an item the server never took (offline, or refused); when it is
 * later matched to a server item by name, `renameItemReferences` moves every
 * local reference over to the server id in the same update.
 */

/** Collections whose rows carry item lines, and the field that holds them. */
const LINE_FIELDS = ['items', 'lines', 'lineItems'];

const retag = (line, from, to) => (line && String(line.itemId ?? '') === from ? { ...line, itemId: to } : line);

const retagRow = (row, from, to) => {
  if (!row || typeof row !== 'object') return row;
  let next = row;
  if (String(row.itemId ?? '') === from) next = { ...next, itemId: to };
  for (const field of LINE_FIELDS) {
    const lines = row[field];
    if (!Array.isArray(lines) || !lines.some((l) => String(l?.itemId ?? '') === from)) continue;
    next = { ...next, [field]: lines.map((l) => retag(l, from, to)) };
  }
  // A discount rule's item list, and a price list's rates keyed by item.
  if (Array.isArray(row.itemIds) && row.itemIds.some((x) => String(x) === from)) {
    next = { ...next, itemIds: row.itemIds.map((x) => (String(x) === from ? to : x)) };
  }
  if (row.rates && typeof row.rates === 'object' && !Array.isArray(row.rates) && Object.prototype.hasOwnProperty.call(row.rates, from)) {
    const { [from]: rate, ...rest } = row.rates;
    next = { ...next, rates: { ...rest, [to]: rate } };
  }
  if (row.template && typeof row.template === 'object' && Array.isArray(row.template.items)) {
    const t = row.template;
    if (t.items.some((l) => String(l?.itemId ?? '') === from)) next = { ...next, template: { ...t, items: t.items.map((l) => retag(l, from, to)) } };
  }
  return next;
};

/**
 * Every local reference to item `from` in this company, pointed at `to`.
 * Returns a patch of only the collections that changed.
 */
export const renameItemReferences = (db, companyId, from, to) => {
  const a = String(from ?? '');
  const b = String(to ?? '');
  const patch = {};
  if (!a || !b || a === b) return patch;
  for (const [collection, rows] of Object.entries(db || {})) {
    if (collection === 'items' || !Array.isArray(rows)) continue;
    let changed = false;
    const next = rows.map((row) => {
      if (Number(row?.companyId) !== Number(companyId)) return row;
      const out = retagRow(row, a, b);
      if (out !== row) changed = true;
      return out;
    });
    if (changed) patch[collection] = next;
  }
  return patch;
};

export default renameItemReferences;
