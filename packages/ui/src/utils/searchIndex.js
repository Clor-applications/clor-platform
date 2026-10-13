/**
 * What the command palette can find.
 *
 * The palette used to index the menu: forty-four destinations, against a book
 * holding eight hundred records. Typing a real invoice number into the one box
 * built for typing returned "nothing matches" — for a document sitting on the
 * next screen. That does not read as a missing feature, it reads as a broken
 * one.
 *
 * Records now join destinations in the same index, scored by the same
 * function, opened by the same keys.
 *
 * Two rules this file exists to keep:
 *
 * 1. The palette may never offer what the sidebar hides. Every entry names the
 *    screen it opens, and callers drop entries whose screen the user cannot
 *    reach — the same permission and feature gate the nav already applies.
 *
 * 2. Nothing above this file knows how the search is done. It takes a query
 *    and returns rows. Today that is a scan over an in-memory array, which is
 *    fine at eight hundred records and will stay fine for a long while — but
 *    it is fine because the book is small, not because scanning scales. When
 *    it moves to the server, only this file changes.
 */

const str = (v) => String(v ?? '').trim();
const lower = (v) => str(v).toLowerCase();

/**
 * Every record type the palette can reach, and how to describe one.
 *
 * `screen` is the nav key the entry opens — also what permission filtering is
 * done against. `terms` are the strings a person might actually type: the
 * number they are holding, the name they were told, the amount they remember.
 */
const SOURCES = [
  {
    collection: 'invoices',
    screen: 'invoices',
    group: 'Invoices',
    label: (r) => str(r.number) || 'Invoice',
    detail: (r) => str(r.customerName),
    terms: (r) => [r.number, r.customerName, r.customerGstin, r.refNo],
  },
  {
    collection: 'bills',
    screen: 'bills',
    group: 'Bills',
    label: (r) => str(r.number) || 'Bill',
    detail: (r) => str(r.vendorName),
    terms: (r) => [r.number, r.vendorName, r.vendorGstin, r.refNo, r.billNumber],
  },
  {
    collection: 'customers',
    screen: 'customers',
    group: 'Customers',
    label: (r) => str(r.name) || str(r.displayName) || 'Customer',
    detail: (r) => str(r.phone) || str(r.email),
    terms: (r) => [r.name, r.displayName, r.phone, r.email, r.gstin],
  },
  {
    collection: 'vendors',
    screen: 'vendors',
    group: 'Vendors',
    label: (r) => str(r.name) || str(r.displayName) || 'Vendor',
    detail: (r) => str(r.phone) || str(r.email),
    terms: (r) => [r.name, r.displayName, r.phone, r.email, r.gstin],
  },
  {
    collection: 'items',
    screen: 'items',
    group: 'Items',
    label: (r) => str(r.name) || 'Item',
    detail: (r) => str(r.sku) || str(r.hsnSac),
    terms: (r) => [r.name, r.sku, r.code, r.hsnSac],
  },
  {
    collection: 'expenses',
    screen: 'expenses',
    group: 'Expenses',
    label: (r) => str(r.number) || 'Expense',
    detail: (r) => str(r.vendorName) || str(r.narration),
    terms: (r) => [r.number, r.vendorName, r.narration],
  },
  {
    collection: 'purchaseOrders',
    screen: 'purchaseOrders',
    group: 'Purchase orders',
    label: (r) => str(r.number) || 'PO',
    detail: (r) => str(r.vendorName),
    terms: (r) => [r.number, r.vendorName],
  },
  {
    collection: 'estimates',
    screen: 'estimates',
    group: 'Quotations',
    label: (r) => str(r.number) || 'Quotation',
    detail: (r) => str(r.customerName),
    terms: (r) => [r.number, r.customerName],
  },
  {
    collection: 'creditNotes',
    screen: 'creditNotes',
    group: 'Sales returns',
    label: (r) => str(r.number) || 'Credit note',
    detail: (r) => str(r.customerName),
    terms: (r) => [r.number, r.customerName],
  },
  {
    collection: 'debitNotes',
    screen: 'debitNotes',
    group: 'Purchase returns',
    label: (r) => str(r.number) || 'Debit note',
    detail: (r) => str(r.vendorName),
    terms: (r) => [r.number, r.vendorName],
  },
];

/**
 * Flatten the book into searchable rows.
 *
 * `canOpen(screenKey)` decides whether a record type is indexed at all — the
 * cheapest place to enforce rule 1, because an entry that is never built can
 * never be offered.
 */
export const buildRecordIndex = ({ db, companyId, canOpen = () => true }) => {
  const out = [];
  for (const src of SOURCES) {
    if (!canOpen(src.screen)) continue;
    const rows = Array.isArray(db?.[src.collection]) ? db[src.collection] : [];
    for (const r of rows) {
      if (companyId !== undefined && r?.companyId !== undefined && r.companyId !== companyId) continue;
      const label = src.label(r);
      if (!label) continue;
      const haystack = src
        .terms(r)
        .map(lower)
        .filter(Boolean)
        .join(' ');
      out.push({
        key: `rec:${src.collection}:${r.id}`,
        label,
        detail: src.detail(r),
        group: src.group,
        screen: src.screen,
        seed: str(r.number) || label,
        haystack,
        amount: Number(r?.total ?? 0) || 0,
      });
    }
  }
  return out;
};

/**
 * Same ranking rules the palette already used for menu items, applied to a
 * record's searchable text: an exact hit beats a prefix, which beats a word
 * boundary, which beats a loose substring. Predictable beats clever — a
 * matcher that surprises you is one people stop trusting.
 */
export const scoreRecord = (entry, q) => {
  if (!q) return 0; // records stay out of the way until asked for
  const label = lower(entry.label);
  if (label === q) return 95;
  if (label.startsWith(q)) return 75;
  const hay = entry.haystack;
  if (!hay.includes(q)) return 0;
  if (hay.split(/\s+/).some((w) => w.startsWith(q))) return 55;
  return 35;
};

/**
 * Rank and cap. The cap matters: a two-character query matches half the book,
 * and a list of four hundred rows is not an answer.
 */
export const searchRecords = (index, query, limit = 12) => {
  const q = lower(query);
  if (!q) return [];
  const hits = [];
  for (const entry of index) {
    const s = scoreRecord(entry, q);
    if (s > 0) hits.push({ ...entry, _s: s });
  }
  hits.sort((a, b) => b._s - a._s || b.amount - a.amount || a.label.localeCompare(b.label));
  return hits.slice(0, limit);
};
