/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { fingerprintOf, fromServerDoc, mergeServerDocs, syncFieldsOf, toServerDoc } from './stockSync';

/**
 * Stock documents crossing between devices.
 *
 * Two browsers never share local ids: each gives the same item, batch and
 * journal its own number. What travels is the server's id (and the item's
 * code and name as a fallback); each side translates to its own on arrival.
 */

const C = 1;

/* Device A and device B hold the same two items under different local ids. */
const deviceA = {
  items: [
    { id: 11, companyId: C, backendItemId: 'itm-steel', code: 'MS-50', name: 'MS Angle 50mm' },
    { id: 12, companyId: C, backendItemId: null, code: 'BOLT', name: 'Hex bolt' },
  ],
  batches: [{ id: 301, companyId: C, itemId: 11, batchNo: 'B-7' }],
  journalEntries: [{ id: 40, companyId: C, backendEntryId: 'je-igst-1' }],
};
const deviceB = {
  items: [
    { id: 7, companyId: C, backendItemId: 'itm-steel', code: 'MS-50', name: 'MS Angle 50mm' },
    { id: 8, companyId: C, backendItemId: 'itm-bolt', code: 'BOLT', name: 'Hex bolt' },
  ],
  batches: [{ id: 902, companyId: C, itemId: 7, batchNo: 'B-7' }],
  journalEntries: [{ id: 3, companyId: C, backendEntryId: 'je-igst-1' }],
};

const adjustmentA = { id: 5, companyId: C, uid: 'adj-x-1', number: 'ADJ-0005', date: '2026-09-10', warehouseId: 'wh-1', itemId: 11, qtyDelta: -2, reason: 'Damaged' };
const transferA = {
  id: 'trf-local-a', companyId: C, uid: 'trf-x-1', number: 'TRF-0003', date: '2026-09-11', status: 'Out',
  sourceWarehouseId: 'wh-1', targetWarehouseId: 'wh-2',
  lines: [{ itemId: '11', qty: 4, batchId: '301', batchNo: 'B-7' }, { itemId: '12', qty: 10, batchId: '', batchNo: '' }],
  gstJournalId: 40,
};

/** What the server would hand back for a document a device pushed. */
const asServerDoc = (kind, uid, doc, over = {}) => ({ id: `srv-${uid}`, kind, uid, updatedAt: '2026-09-29T10:00:00.000Z', ...doc, ...over });

describe('leaving a device', () => {
  it('sends the columns the server checks and the row, with item references it can resolve anywhere', () => {
    const doc = toServerDoc('stockAdjustments', { ...adjustmentA, backendStockId: 'x', syncedFingerprint: 'y' }, deviceA, C);
    expect(doc).toMatchObject({ number: 'ADJ-0005', date: '2026-09-10', warehouseId: 'wh-1' });
    expect(doc.payload).toMatchObject({ itemId: 11, itemBackendId: 'itm-steel', itemCode: 'MS-50' });
    expect(doc.payload.backendStockId).toBeUndefined();
    expect(doc.payload.syncedFingerprint).toBeUndefined();
  });

  it('carries both ends of a transfer and names its IGST journal by the server id', () => {
    const doc = toServerDoc('stockTransfers', transferA, deviceA, C);
    expect(doc).toMatchObject({ warehouseId: 'wh-1', targetWarehouseId: 'wh-2', status: 'Out' });
    expect(doc.payload.gstJournalBackendId).toBe('je-igst-1');
    expect(doc.payload.lines[1]).toMatchObject({ itemBackendId: null, itemCode: 'BOLT', itemName: 'Hex bolt' });
  });
});

describe('arriving on another device', () => {
  it("translates items, batches and the journal to this device's own ids", () => {
    const sent = toServerDoc('stockTransfers', transferA, deviceA, C);
    const row = fromServerDoc('stockTransfers', asServerDoc('TRANSFER', 'trf-x-1', sent), deviceB, C, 'trf-local-b');
    expect(row.id).toBe('trf-local-b');
    expect(row.lines[0]).toMatchObject({ itemId: '7', batchId: '902', batchNo: 'B-7' });
    // No server id on device A for the bolt, so it is found by its code.
    expect(row.lines[1].itemId).toBe('8');
    expect(row.lines[0].itemBackendId).toBeUndefined();
    expect(row.gstJournalId).toBe(3);
    expect(row).toMatchObject({ uid: 'trf-x-1', backendStockId: 'srv-trf-x-1' });
    expect(row.syncedFingerprint).toBe(fingerprintOf(row));
  });

  it('waits when an item has not reached this device yet', () => {
    const sent = toServerDoc('stockAdjustments', adjustmentA, deviceA, C);
    const empty = { items: [] };
    expect(fromServerDoc('stockAdjustments', asServerDoc('ADJUSTMENT', 'adj-x-1', sent), empty, C, 1)).toBeNull();
  });
});

describe('merging the server into a device', () => {
  const sentAdj = toServerDoc('stockAdjustments', adjustmentA, deviceA, C);

  it('adds a document it has never seen, with a fresh local id, and leaves other companies alone', () => {
    const db = { ...deviceB, stockAdjustments: [{ id: 3, companyId: 2, uid: 'theirs' }], stockTransfers: [] };
    const { patch, changed } = mergeServerDocs(db, C, [asServerDoc('ADJUSTMENT', 'adj-x-1', sentAdj)]);
    expect(changed).toBe(true);
    expect(patch.stockAdjustments).toHaveLength(2);
    const added = patch.stockAdjustments.find((r) => r.uid === 'adj-x-1');
    expect(added).toMatchObject({ id: 4, companyId: C, itemId: 7 });
    expect(patch.stockAdjustments.find((r) => r.companyId === 2).uid).toBe('theirs');
  });

  it('takes the newer server copy of a document unchanged here — a transfer received at the other branch', () => {
    const sent = toServerDoc('stockTransfers', transferA, deviceA, C);
    const local = fromServerDoc('stockTransfers', asServerDoc('TRANSFER', 'trf-x-1', sent), deviceB, C, 'trf-b');
    const received = asServerDoc('TRANSFER', 'trf-x-1', { ...sent, status: 'In', payload: { ...sent.payload, status: 'In' } }, { updatedAt: '2026-09-29T12:00:00.000Z' });
    const { patch } = mergeServerDocs({ ...deviceB, stockAdjustments: [], stockTransfers: [local] }, C, [received]);
    expect(patch.stockTransfers[0]).toMatchObject({ id: 'trf-b', status: 'In' });
  });

  it('keeps a local change that has not been pushed yet', () => {
    const local = fromServerDoc('stockAdjustments', asServerDoc('ADJUSTMENT', 'adj-x-1', sentAdj), deviceB, C, 9);
    const edited = { ...local, qtyDelta: -5 };
    const newer = asServerDoc('ADJUSTMENT', 'adj-x-1', sentAdj, { updatedAt: '2030-01-01T00:00:00.000Z' });
    const { changed } = mergeServerDocs({ ...deviceB, stockAdjustments: [edited], stockTransfers: [] }, C, [newer]);
    expect(changed).toBe(false);
  });

  it('drops a synced document deleted on another device, and keeps one never uploaded', () => {
    const synced = fromServerDoc('stockAdjustments', asServerDoc('ADJUSTMENT', 'adj-x-1', sentAdj), deviceB, C, 9);
    const fresh = { id: 10, companyId: C, uid: 'adj-new', itemId: 7, qtyDelta: 1 };
    const { patch } = mergeServerDocs({ ...deviceB, stockAdjustments: [synced, fresh], stockTransfers: [] }, C, []);
    expect(patch.stockAdjustments.map((r) => r.uid)).toEqual(['adj-new']);
  });

  it('counts documents waiting for their items instead of dropping them', () => {
    const { changed, unresolved } = mergeServerDocs({ items: [], stockAdjustments: [], stockTransfers: [] }, C, [
      asServerDoc('ADJUSTMENT', 'adj-x-1', sentAdj),
    ]);
    expect(changed).toBe(false);
    expect(unresolved).toBe(1);
  });
});

describe('editing a transfer', () => {
  it('keeps its sync identity when the form rebuilds the record', () => {
    const stored = { ...transferA, backendStockId: 'srv-1', syncedFingerprint: 'fp', syncedAt: 't' };
    const rebuilt = { id: transferA.id, companyId: C, number: 'TRF-0003', lines: [] };
    expect({ ...rebuilt, ...syncFieldsOf(stored) }).toMatchObject({ uid: 'trf-x-1', backendStockId: 'srv-1', syncedFingerprint: 'fp' });
  });
});
