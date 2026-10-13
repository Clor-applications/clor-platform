import { round2 } from './money';

const safeArray = (v) => (Array.isArray(v) ? v : []);

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const isStockItem = (item) => {
  const t = String(item?.type || '').trim().toLowerCase();
  return t === 'goods' || t === 'good' || t === 'product' || t === 'inventory';
};

/**
 * Which warehouse an item's opening stock sits in.
 *
 * Opening stock used to have no warehouse at all, while every stock check that
 * matters — can I sell this, can I transfer it — is warehouse-scoped. The two
 * did not meet: filtering by warehouse zeroed the opening balance, so an item
 * stocked by an opening entry rather than a purchase was unsellable from every
 * warehouse in the company, and the invoice form refused it as negative stock.
 *
 * Items saved before this existed name no warehouse. Their opening balance is
 * therefore in no warehouse in particular, and it counts against whichever one
 * is being asked about. That can over-count across several warehouses — but the
 * alternative is what shipped before, where such an item was unsellable
 * everywhere, and a stock figure that blocks every sale is worse than one that
 * is optimistic until somebody assigns it. New items name their warehouse on
 * the item form, so this only ever applies to the backlog.
 */
export const getItemOpeningWarehouseId = (item) => String(item?.openingWarehouseId || '').trim();

export const getItemOpeningQty = (item) => {
  if (item?.openingQty !== undefined && item?.openingQty !== null && item?.openingQty !== '') {
    return round2(Math.max(0, safeNum(item.openingQty)));
  }
  // Back-compat: older DB uses `stock` field
  return round2(Math.max(0, safeNum(item?.stock ?? 0)));
};

const shouldAffectStock = (voucherType, doc) => {
  const vt = String(voucherType || '').trim();
  const status = String(doc?.status || '').trim();

  // Cancelled documents should never affect stock.
  if (status === 'Cancelled') return false;

  // Invoices/Bills have explicit Drafts; don't affect stock
  if (vt === 'invoice' || vt === 'bill') return status !== 'Draft';

  // Credit/Debit notes currently default to Draft in this app,
  // but users expect them to affect stock.
  if (vt === 'creditNote' || vt === 'debitNote') return true;

  return true;
};

const normalizeMovement = (m) => {
  const qtyIn = round2(Math.max(0, safeNum(m.qtyIn)));
  const qtyOut = round2(Math.max(0, safeNum(m.qtyOut)));
  return {
    ...m,
    date: String(m.date || '').trim(),
    itemId: String(m.itemId || '').trim(),
    warehouseId: String(m.warehouseId || '').trim(),
    qtyIn,
    qtyOut,
  };
};

const isDateInRange = (dateStr, fromDate, toDate) => {
  const d = String(dateStr || '').trim();
  if (!d) return false;
  const from = String(fromDate || '').trim();
  const to = String(toDate || '').trim();

  // Dates are stored as YYYY-MM-DD in this app; lexicographic compare works.
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

const isBeforeDate = (dateStr, fromDate) => {
  const d = String(dateStr || '').trim();
  const from = String(fromDate || '').trim();
  if (!d || !from) return false;
  return d < from;
};

const isAfterDate = (dateStr, toDate) => {
  const d = String(dateStr || '').trim();
  const to = String(toDate || '').trim();
  if (!d || !to) return false;
  return d > to;
};

export const buildStockMovements = ({ db, companyId, warehouseId = '' }) => {
  const items = safeArray(db?.items).filter((i) => Number(i?.companyId) === Number(companyId));
  const itemsById = new Map(items.map((i) => [String(i.id), i]));
  const whFilter = String(warehouseId || '').trim();

  const movements = [];

  const pushFromDoc = ({
    voucherType,
    list,
    numberField = 'number',
    direction, // 'IN' | 'OUT'
  }) => {
    for (const doc of safeArray(list)) {
      if (Number(doc?.companyId) !== Number(companyId)) continue;
      if (!shouldAffectStock(voucherType, doc)) continue;

      const docWarehouseId = String(doc?.warehouseId || '').trim();
      if (whFilter && docWarehouseId !== whFilter) continue;

      const date = doc?.date || '';
      const voucherId = doc?.id;
      const voucherNumber = doc?.[numberField] || doc?.number || '';
      const lines = safeArray(doc?.items);

      for (const l of lines) {
        const itemId = l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '';
        if (!itemId) continue;
        const item = itemsById.get(itemId);
        if (!item) continue;
        if (!isStockItem(item)) continue;

        const qty = round2(Math.max(0, safeNum(l?.quantity ?? 0)));
        if (qty <= 0) continue;

        movements.push(
          normalizeMovement({
            companyId,
            date,
            voucherType,
            voucherId,
            voucherNumber,
            warehouseId: docWarehouseId,
            itemId,
            qtyIn: direction === 'IN' ? qty : 0,
            qtyOut: direction === 'OUT' ? qty : 0,
          })
        );
      }
    }
  };

  pushFromDoc({ voucherType: 'bill', list: db?.bills, direction: 'IN' });
  pushFromDoc({ voucherType: 'invoice', list: db?.invoices, direction: 'OUT' });
  pushFromDoc({ voucherType: 'debitNote', list: db?.debitNotes, direction: 'OUT' });
  pushFromDoc({ voucherType: 'creditNote', list: db?.creditNotes, direction: 'IN' });

  /**
   * Stock adjustments — what a count found that the books did not.
   *
   * They are movements like any other, which is the whole point: closing
   * quantity changes, so the stock on the balance sheet changes with it, and
   * the closing-stock figure that credits Purchase Accounts moves the same
   * amount through the P&L. Writing 12 units off in an audit lands as an
   * expense without anyone posting a journal by hand.
   *
   * A positive qtyDelta is stock found, a negative one is stock gone.
   */
  for (const a of safeArray(db?.stockAdjustments)) {
    if (Number(a?.companyId) !== Number(companyId)) continue;
    const itemId = a?.itemId !== undefined && a?.itemId !== null && a?.itemId !== '' ? String(a.itemId) : '';
    if (!itemId) continue;
    const item = itemsById.get(itemId);
    if (!item || !isStockItem(item)) continue;

    const adjWarehouseId = String(a?.warehouseId || '').trim();
    if (whFilter && adjWarehouseId !== whFilter) continue;

    const delta = round2(safeNum(a?.qtyDelta ?? 0));
    if (delta === 0) continue;

    movements.push(
      normalizeMovement({
        companyId,
        date: String(a?.date || '').trim(),
        voucherType: 'stockAdjustment',
        voucherId: a?.id,
        voucherNumber: a?.number || '',
        warehouseId: adjWarehouseId,
        itemId,
        qtyIn: delta > 0 ? delta : 0,
        qtyOut: delta < 0 ? Math.abs(delta) : 0,
        voucherNote: String(a?.reason || '').trim(),
      })
    );
  }

  // Stock Transfers (inter-warehouse / inter-branch).
  //
  // The two legs move at different moments: goods leave the source when the
  // transfer is dispatched (Transfer Out), and only land at the destination
  // when the receiving warehouse accepts them (Transfer In) — for the quantity
  // it actually counted, which may be short. A shortfall written off as a loss
  // is simply stock that left and never arrived; returning it to source
  // instead cancels the outward leg down to the received quantity.
  //
  // Statuses carry history: 'Transferred Out' / 'Transfer In' are current,
  // 'In Transit' / 'Received' are what earlier transfers were saved as, and
  // 'Approved' is the legacy single-step status (both legs, full quantity).
  // A rejected consignment goes back to the sender, so neither leg counts.
  const OUT_STATUSES = new Set([
    'Transferred Out',
    'In Transit',
    'Transfer In',
    'Received',
    'Short Received',
    'Closed',
    'Approved',
  ]);
  const IN_STATUSES = new Set(['Transfer In', 'Received', 'Short Received', 'Closed', 'Approved']);

  for (const t of safeArray(db?.stockTransfers)) {
    if (Number(t?.companyId) !== Number(companyId)) continue;
    const status = String(t?.status || '').trim();
    if (!OUT_STATUSES.has(status)) continue;
    const landed = IN_STATUSES.has(status);
    const returnedToSource = String(t?.mismatchResolution || '') === 'RETURN';

    const date = String(t?.date || '').trim();
    const voucherId = t?.id;
    const voucherNumber = t?.number || '';

    const sourceWarehouseId = String(t?.sourceWarehouseId || '').trim();
    const targetWarehouseId = String(t?.targetWarehouseId || '').trim();

    const sourceLabel = String(t?.sourceWarehouseName || '').trim() || (sourceWarehouseId ? `Warehouse ${sourceWarehouseId}` : '');
    const targetLabel = String(t?.targetWarehouseName || '').trim() || (targetWarehouseId ? `Warehouse ${targetWarehouseId}` : '');

    const lines = safeArray(t?.lines);
    for (const l of lines) {
      const itemId = l?.itemId !== undefined && l?.itemId !== null && l?.itemId !== '' ? String(l.itemId) : '';
      if (!itemId) continue;
      const item = itemsById.get(itemId);
      if (!item) continue;
      if (!isStockItem(item)) continue;

      const sentQty = round2(Math.max(0, safeNum(l?.qty ?? l?.quantity ?? 0)));
      const receivedQty = landed
        ? round2(Math.max(0, safeNum(l?.receivedQty ?? l?.qty ?? l?.quantity ?? 0)))
        : 0;
      // Unreceived units either vanish (loss) or never left (return to source).
      const outQty = returnedToSource && landed ? receivedQty : sentQty;
      if (sentQty <= 0) continue;

      if (whFilter) {
        if (sourceWarehouseId && sourceWarehouseId === whFilter) {
          movements.push(
            normalizeMovement({
              companyId,
              date,
              voucherType: 'stockTransfer',
              voucherId,
              voucherNumber,
              warehouseId: sourceWarehouseId,
              itemId,
              qtyIn: 0,
              qtyOut: outQty,
              voucherNote: targetLabel ? `To: ${targetLabel}` : 'To: -',
            })
          );
        }

        if (landed && receivedQty > 0 && targetWarehouseId && targetWarehouseId === whFilter) {
          movements.push(
            normalizeMovement({
              companyId,
              date,
              voucherType: 'stockTransfer',
              voucherId,
              voucherNumber,
              warehouseId: targetWarehouseId,
              itemId,
              qtyIn: receivedQty,
              qtyOut: 0,
              voucherNote: sourceLabel ? `From: ${sourceLabel}` : 'From: -',
            })
          );
        }
      } else {
        // No warehouse filter => include both legs (net zero on totals, but visible in ledger).
        if (sourceWarehouseId) {
          movements.push(
            normalizeMovement({
              companyId,
              date,
              voucherType: 'stockTransfer',
              voucherId,
              voucherNumber,
              warehouseId: sourceWarehouseId,
              itemId,
              qtyIn: 0,
              qtyOut: outQty,
              voucherNote: targetLabel ? `To: ${targetLabel}` : 'To: -',
            })
          );
        }
        if (landed && receivedQty > 0 && targetWarehouseId) {
          movements.push(
            normalizeMovement({
              companyId,
              date,
              voucherType: 'stockTransfer',
              voucherId,
              voucherNumber,
              warehouseId: targetWarehouseId,
              itemId,
              qtyIn: receivedQty,
              qtyOut: 0,
              voucherNote: sourceLabel ? `From: ${sourceLabel}` : 'From: -',
            })
          );
        }
      }
    }
  }

  // Sort by date asc, then voucherId asc for stable running balance
  movements.sort((a, b) => {
    const da = String(a.date || '');
    const dbb = String(b.date || '');
    if (da !== dbb) return da < dbb ? -1 : 1;

    const va = safeNum(a.voucherId);
    const vb = safeNum(b.voucherId);
    if (va !== vb) return va - vb;

    const ta = String(a.voucherType || '');
    const tb = String(b.voucherType || '');
    return ta.localeCompare(tb);
  });

  return { items, itemsById, movements };
};

export const computeInventorySummaryByItemId = ({ db, companyId, fromDate = '', toDate = '', warehouseId = '' }) => {
  const whFilter = String(warehouseId || '').trim();
  const { items, movements } = buildStockMovements({ db, companyId, warehouseId: whFilter });

  const map = new Map();
  for (const item of items) {
    const itemId = String(item.id);
    map.set(itemId, {
      itemId,
      openingQty: 0,
      purchasesQty: 0,
      salesQty: 0,
      debitNoteQty: 0,
      creditNoteQty: 0,
      adjustmentQty: 0,
      closingQty: 0,
    });
  }

  // 1) Opening qty as-of fromDate
  for (const item of items) {
    const itemId = String(item.id);
    const row = map.get(itemId);
    if (!row) continue;
    // Opening stock now names its warehouse. Unfiltered, every item's opening
    // counts; filtered, only the opening that belongs to this warehouse does.
    const openingWh = getItemOpeningWarehouseId(item);
    const openingCounts = !whFilter || !openingWh || openingWh === whFilter;
    row.openingQty = openingCounts ? getItemOpeningQty(item) : 0;
    row.closingQty = row.openingQty;
  }

  // Apply movements before fromDate to opening
  if (String(fromDate || '').trim()) {
    for (const m of movements) {
      if (!isBeforeDate(m.date, fromDate)) continue;
      const row = map.get(String(m.itemId));
      if (!row) continue;
      row.openingQty = round2(row.openingQty + m.qtyIn - m.qtyOut);
      row.closingQty = row.openingQty;
    }
  }

  // 2) Period movements and closing as-of toDate
  for (const m of movements) {
    if (String(toDate || '').trim() && isAfterDate(m.date, toDate)) continue;

    const row = map.get(String(m.itemId));
    if (!row) continue;

    const inPeriod = isDateInRange(m.date, fromDate, toDate);
    if (inPeriod) {
      if (m.voucherType === 'bill') row.purchasesQty = round2(row.purchasesQty + m.qtyIn);
      if (m.voucherType === 'invoice') row.salesQty = round2(row.salesQty + m.qtyOut);
      if (m.voucherType === 'debitNote') row.debitNoteQty = round2(row.debitNoteQty + m.qtyOut);
      if (m.voucherType === 'creditNote') row.creditNoteQty = round2(row.creditNoteQty + m.qtyIn);
      if (m.voucherType === 'stockAdjustment') {
        row.adjustmentQty = round2(row.adjustmentQty + m.qtyIn - m.qtyOut);
      }
    }

    // Closing is opening-as-of-from plus all movements up to toDate
    row.closingQty = round2(row.closingQty + m.qtyIn - m.qtyOut);
  }

  return map;
};

export const buildItemStockLedger = ({ db, companyId, itemId, fromDate = '', toDate = '', warehouseId = '' }) => {
  const whFilter = String(warehouseId || '').trim();
  const { itemsById, movements } = buildStockMovements({ db, companyId, warehouseId: whFilter });
  const item = itemsById.get(String(itemId));
  if (!item) return { item: null, openingQty: 0, rows: [] };

  // Opening as-of fromDate (openingQty + net movements before fromDate)
  let openingQty = whFilter ? 0 : getItemOpeningQty(item);
  if (String(fromDate || '').trim()) {
    for (const m of movements) {
      if (String(m.itemId) !== String(itemId)) continue;
      if (!isBeforeDate(m.date, fromDate)) continue;
      openingQty = round2(openingQty + m.qtyIn - m.qtyOut);
    }
  }

  let running = openingQty;

  const rows = movements
    .filter((m) => String(m.itemId) === String(itemId))
    .filter((m) => isDateInRange(m.date, fromDate, toDate))
    .map((m) => {
      running = round2(running + m.qtyIn - m.qtyOut);
      return {
        ...m,
        balanceQty: running,
      };
    });

  return {
    item,
    openingQty,
    rows,
  };
};
