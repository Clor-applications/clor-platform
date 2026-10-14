/**
 * Stock adjustments and transfers, carried between this browser and the server.
 *
 * They lived only in the browser that raised them. They now ride the stock
 * documents store (server/src/routes/stockDocuments.ts): every device holds
 * the same set, and stock computed from them agrees across devices the way
 * sales and purchases already do.
 *
 * Pure functions only — the hook in useStockSync.js does the timing and I/O.
 *
 * Identity. Local ids do not travel: two browsers each call their first
 * adjustment "1". A `uid` is stamped at creation and names the document
 * everywhere. Items are local too, so every item reference also carries the
 * server's item id (and code and name, as a fallback), and is translated back
 * to this browser's item on the way in. Warehouses come from the server and
 * already share ids. Batches and the IGST journal are translated the same way
 * as items.
 */

export const STOCK_KINDS = { stockAdjustments: 'ADJUSTMENT', stockTransfers: 'TRANSFER' };
export const STOCK_COLLECTIONS = Object.keys(STOCK_KINDS);

/** Bookkeeping this browser keeps about the sync itself — never sent, never fingerprinted. */
export const SYNC_FIELDS = new Set(['backendStockId', 'syncedFingerprint', 'syncedAt', 'syncBlocked']);

const safeArray = (v) => (Array.isArray(v) ? v : []);
const text = (v) => String(v ?? '').trim();

export const newStockUid = (collection) =>
  `${collection === 'stockTransfers' ? 'trf' : 'adj'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The row as a comparable string, minus the sync bookkeeping. */
export const fingerprintOf = (row) => {
  const keys = Object.keys(row || {})
    .filter((k) => !SYNC_FIELDS.has(k))
    .sort();
  return JSON.stringify(keys.map((k) => [k, row[k]]));
};

/** The sync bookkeeping on a row, to carry across an edit that rebuilds it. */
export const syncFieldsOf = (row) => {
  const out = {};
  if (row?.uid) out.uid = row.uid;
  for (const k of SYNC_FIELDS) if (row?.[k] !== undefined) out[k] = row[k];
  return out;
};

const withoutSync = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) if (!SYNC_FIELDS.has(k)) out[k] = v;
  return out;
};

/* ---------------------------------------------------------------- outgoing */

const itemRefFor = (db, companyId, itemId) => {
  const item = safeArray(db?.items).find((i) => Number(i?.companyId) === Number(companyId) && text(i?.id) === text(itemId));
  return item
    ? { itemBackendId: item.backendItemId ? String(item.backendItemId) : null, itemCode: text(item.code), itemName: text(item.name) }
    : { itemBackendId: null, itemCode: '', itemName: '' };
};

const journalBackendIdFor = (db, companyId, journalId) => {
  if (!journalId) return null;
  const j = safeArray(db?.journalEntries).find((x) => Number(x?.companyId) === Number(companyId) && String(x?.id) === String(journalId));
  return j?.backendEntryId ? String(j.backendEntryId) : null;
};

/**
 * The server document for a local row: the columns the server checks, and the
 * row itself (translated references added) as the payload.
 */
export const toServerDoc = (collection, row, db, companyId) => {
  const payload = withoutSync(row);
  if (collection === 'stockAdjustments') {
    Object.assign(payload, itemRefFor(db, companyId, row.itemId));
    return {
      number: text(row.number) || null,
      date: text(row.date).slice(0, 10),
      status: text(row.status) || null,
      warehouseId: text(row.warehouseId) || null,
      payload,
    };
  }
  payload.lines = safeArray(row.lines).map((l) => ({ ...l, ...itemRefFor(db, companyId, l?.itemId) }));
  payload.gstJournalBackendId = journalBackendIdFor(db, companyId, row.gstJournalId);
  return {
    number: text(row.number) || null,
    date: text(row.date).slice(0, 10),
    status: text(row.status) || null,
    warehouseId: text(row.sourceWarehouseId) || null,
    targetWarehouseId: text(row.targetWarehouseId) || null,
    payload,
  };
};

/* ---------------------------------------------------------------- incoming */

/** This browser's item for a reference written on another device, or null. */
const localItemId = (db, companyId, ref) => {
  const items = safeArray(db?.items).filter((i) => Number(i?.companyId) === Number(companyId));
  const byBackend = ref?.itemBackendId ? items.find((i) => String(i?.backendItemId || '') === String(ref.itemBackendId)) : null;
  if (byBackend) return byBackend.id;
  const code = text(ref?.itemCode).toLowerCase();
  if (code) {
    const byCode = items.find((i) => text(i?.code).toLowerCase() === code);
    if (byCode) return byCode.id;
  }
  const name = text(ref?.itemName).toLowerCase();
  if (name) {
    const byName = items.find((i) => text(i?.name).toLowerCase() === name);
    if (byName) return byName.id;
  }
  return null;
};

const localBatchId = (db, companyId, itemId, batchNo, fallback) => {
  if (!batchNo) return fallback ?? '';
  const b = safeArray(db?.batches).find(
    (x) => Number(x?.companyId) === Number(companyId) && text(x?.itemId) === text(itemId) && text(x?.batchNo) === text(batchNo)
  );
  return b ? text(b.id) : '';
};

const localJournalId = (db, companyId, backendEntryId) => {
  if (!backendEntryId) return null;
  const j = safeArray(db?.journalEntries).find(
    (x) => Number(x?.companyId) === Number(companyId) && String(x?.backendEntryId || '') === String(backendEntryId)
  );
  return j ? j.id : null;
};

/**
 * A local row for a server document, with references translated to this
 * browser's items, batches and journals. Returns null when an item cannot be
 * found here yet (items may still be arriving); the caller tries again later.
 */
export const fromServerDoc = (collection, doc, db, companyId, localId) => {
  const p = doc?.payload && typeof doc.payload === 'object' ? doc.payload : {};
  const sync = { uid: doc.uid, backendStockId: doc.id, syncedAt: doc.updatedAt };

  if (collection === 'stockAdjustments') {
    const itemId = localItemId(db, companyId, p);
    if (itemId === null) return null;
    const row = { ...p, id: localId, companyId, itemId, ...sync };
    delete row.itemBackendId;
    delete row.itemCode;
    delete row.itemName;
    return { ...row, syncedFingerprint: fingerprintOf(row) };
  }

  const lines = [];
  for (const l of safeArray(p.lines)) {
    const itemId = localItemId(db, companyId, l);
    if (itemId === null) return null;
    const { itemBackendId: _b, itemCode: _c, itemName: _n, ...rest } = l;
    lines.push({ ...rest, itemId: text(itemId), batchId: localBatchId(db, companyId, itemId, rest.batchNo, rest.batchId) });
  }
  const { gstJournalBackendId, ...restPayload } = p;
  const row = {
    ...restPayload,
    id: localId,
    companyId,
    lines,
    gstJournalId: localJournalId(db, companyId, gstJournalBackendId) ?? null,
    ...sync,
  };
  return { ...row, syncedFingerprint: fingerprintOf(row) };
};

/**
 * Merge the server's documents into this browser's two collections.
 *
 *  - A document this browser has never seen arrives with a fresh local id.
 *  - One it holds, unchanged here since its last sync, takes the server's
 *    newer copy — a transfer received at the other branch updates here.
 *  - One it has changed and not yet pushed stays as it is; the push that
 *    follows sends it.
 *  - One that was synced and is gone from the server was deleted elsewhere,
 *    and goes here too.
 *  - Rows never synced are left alone for the push to upload.
 *
 * Returns { patch, changed, unresolved } — unresolved counts documents that
 * name an item this browser does not have yet.
 */
export const mergeServerDocs = (db, companyId, docs) => {
  const patch = {};
  let changed = false;
  let unresolved = 0;

  for (const collection of STOCK_COLLECTIONS) {
    const kind = STOCK_KINDS[collection];
    const incoming = safeArray(docs).filter((d) => d?.kind === kind && d?.uid);
    const incomingByUid = new Map(incoming.map((d) => [String(d.uid), d]));
    const all = safeArray(db?.[collection]);
    const mine = all.filter((r) => Number(r?.companyId) === Number(companyId));
    const others = all.filter((r) => Number(r?.companyId) !== Number(companyId));
    const byUid = new Map(mine.filter((r) => r?.uid).map((r) => [String(r.uid), r]));

    const numericIds = collection === 'stockAdjustments';
    let nextId = all.reduce((m, r) => Math.max(m, Number(r?.id) || 0), 0);
    const freshId = () => (numericIds ? ++nextId : `${newStockUid(collection)}-l`);

    const merged = [];
    let collectionChanged = false;

    for (const row of mine) {
      if (!row?.uid) {
        merged.push(row);
        continue;
      }
      const doc = incomingByUid.get(String(row.uid));
      const dirty = fingerprintOf(row) !== row.syncedFingerprint;
      if (!doc) {
        // Synced once and gone from the server: deleted on another device.
        if (row.backendStockId && !dirty) {
          collectionChanged = true;
          continue;
        }
        merged.push(row);
        continue;
      }
      const newer = !row.syncedAt || new Date(doc.updatedAt).getTime() > new Date(row.syncedAt).getTime();
      if (!dirty && newer) {
        const next = fromServerDoc(collection, doc, db, companyId, row.id);
        if (next) {
          merged.push(next);
          collectionChanged = true;
          continue;
        }
        unresolved += 1;
      }
      merged.push(row);
    }

    for (const doc of incoming) {
      if (byUid.has(String(doc.uid))) continue;
      const row = fromServerDoc(collection, doc, db, companyId, freshId());
      if (!row) {
        unresolved += 1;
        continue;
      }
      merged.push(row);
      collectionChanged = true;
    }

    if (collectionChanged) {
      patch[collection] = [...others, ...merged];
      changed = true;
    }
  }

  return { patch, changed, unresolved };
};
