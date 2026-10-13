/**
 * Batch tracking.
 *
 * Batches are CREATED by purchase bills (a lot arriving: batch no, mfg date,
 * expiry, qty) and CONSUMED by invoice lines carrying batchId. Remaining
 * stock per batch is always computed from documents — never stored — so the
 * report cannot drift.
 *
 * db.batches: { id, companyId, itemId, batchNo, mfgDate, expiryDate,
 *               qtyIn, sourceBillNumber, createdAt }
 * invoice line: { ..., batchId, batchNo }
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const isTracked = (item) => {
  const t = String(item?.trackingType || 'NONE');
  return t === 'BATCH' || t === 'BATCH_EXPIRY';
};

export const needsExpiry = (item) => String(item?.trackingType || '') === 'BATCH_EXPIRY';

/**
 * Qty consumed per batch id.
 *
 * Sales consume a batch outright. A stock transfer consumes it only while the
 * goods are in flight — once the receiving warehouse approves them the units
 * exist again, just somewhere else, and the batch is whole. Units written off
 * as a loss on receipt never come back.
 */
export function consumedByBatch(db, companyId, { excludeInvoiceId } = {}) {
  const map = new Map();
  const take = (batchId, qty) => {
    if (batchId == null || batchId === '') return;
    if (!(qty > 0)) return;
    const k = String(batchId);
    map.set(k, (map.get(k) || 0) + qty);
  };

  for (const inv of db?.invoices || []) {
    if (inv.companyId !== companyId) continue;
    const st = String(inv.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'draft') continue;
    if (excludeInvoiceId != null && Number(inv.id) === Number(excludeInvoiceId)) continue;
    for (const l of inv.items || []) {
      take(l.batchId, num(l.quantity));
    }
  }

  const IN_FLIGHT = new Set(['Transferred Out', 'In Transit']);
  const LANDED = new Set(['Transfer In', 'Received', 'Short Received', 'Closed', 'Approved']);
  for (const t of db?.stockTransfers || []) {
    if (Number(t?.companyId) !== Number(companyId)) continue;
    const status = String(t?.status || '').trim();
    const inFlight = IN_FLIGHT.has(status);
    const landed = LANDED.has(status);
    if (!inFlight && !landed) continue;
    for (const l of t.lines || []) {
      const sent = num(l?.qty ?? l?.quantity);
      if (inFlight) {
        take(l?.batchId, sent);
        continue;
      }
      // Landed: only what never arrived and was written off is gone.
      if (String(t?.mismatchResolution || '') !== 'LOSS') continue;
      const received = l?.receivedQty === undefined || l?.receivedQty === null ? sent : num(l.receivedQty);
      take(l?.batchId, sent - received);
    }
  }

  return map;
}

/**
 * Batches of one item with remaining qty, FEFO-ordered: earliest expiry
 * first, then oldest received. Batches with nothing left are filtered unless
 * includeEmpty.
 */
export function batchesForItem(db, companyId, itemId, { includeEmpty = false, excludeInvoiceId } = {}) {
  const consumed = consumedByBatch(db, companyId, { excludeInvoiceId });
  return (db?.batches || [])
    .filter((b) => b.companyId === companyId && String(b.itemId) === String(itemId))
    .map((b) => ({ ...b, remaining: Math.max(0, num(b.qtyIn) - (consumed.get(String(b.id)) || 0)) }))
    .filter((b) => includeEmpty || b.remaining > 0)
    .sort((a, b) => {
      const ea = a.expiryDate || '9999-12-31';
      const eb = b.expiryDate || '9999-12-31';
      if (ea !== eb) return ea < eb ? -1 : 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

/** First batch that can cover the qty; else the FEFO-first with anything left. */
export function fefoPick(db, companyId, itemId, qty) {
  const list = batchesForItem(db, companyId, itemId);
  return list.find((b) => b.remaining >= num(qty)) || list[0] || null;
}

export const daysToExpiry = (expiryDate, today = new Date().toISOString().slice(0, 10)) => {
  if (!expiryDate) return null;
  const ms = new Date(`${String(expiryDate).slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`);
  return Math.round(ms / 86400000);
};

/** Every batch with remaining stock, joined to its item — the report rows. */
export function batchStockRows(db, companyId) {
  const items = new Map((db?.items || []).filter((i) => i.companyId === companyId).map((i) => [String(i.id), i]));
  const consumed = consumedByBatch(db, companyId);
  return (db?.batches || [])
    .filter((b) => b.companyId === companyId)
    .map((b) => {
      const out = consumed.get(String(b.id)) || 0;
      return {
        ...b,
        itemName: items.get(String(b.itemId))?.name || `Item ${b.itemId}`,
        qtyOut: out,
        remaining: Math.max(0, num(b.qtyIn) - out),
        days: daysToExpiry(b.expiryDate),
      };
    })
    .sort((a, b) => String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')));
}
