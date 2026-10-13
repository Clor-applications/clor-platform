import { createOrgMaster, listOrgMasters, updateOrgMaster } from '@ui/api/masters';
import { hasApiSession } from '@ui/api/purchaseDocs';

/**
 * The TDS compliance stores, written through to the server.
 *
 * Events, challans, allocation links and quarter filings lived only in the
 * browser that created them — every device its own register. They now ride
 * the same generic OrgMaster store the reference masters use: one row per
 * record, kind-tagged, payload in dataJson, the server owning isolation and
 * nothing else.
 *
 * Identity across devices is the `uid` stamped at creation — LOCAL NUMERIC
 * IDS DO NOT TRAVEL. Two browsers both call their first event "1"; the uid
 * is what says whether they are the same fact. Hydration reads by uid,
 * assigns fresh local ids for rows this browser has never seen, and remaps
 * the link fields (an allocation names its challan and event by uid as well
 * as by the writer's local id) so the joins survive the crossing.
 *
 * Best-effort, like every write-through here: the local book is the working
 * copy, a refused sync loses nothing, and the row syncs again the next time
 * it changes.
 */

export const TDS_SYNC_KINDS = {
  tdsTransactions: 'TDS_EVENT',
  tdsChallans: 'TDS_CHALLAN',
  tdsChallanAllocations: 'TDS_CHALLAN_ALLOC',
  tdsFilings: 'TDS_FILING',
};

export const newTdsUid = () =>
  `tds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Push one row. Returns { backendMasterId } when the server took it. */
export const pushTdsRow = async (collection, row) => {
  const kind = TDS_SYNC_KINDS[collection];
  if (!kind || !hasApiSession() || !row?.uid) return {};
  try {
    if (row.backendMasterId) {
      await updateOrgMaster(row.backendMasterId, { data: row });
      return { backendMasterId: row.backendMasterId };
    }
    const created = await createOrgMaster(kind, row.uid, row);
    return created?.master?.id ? { backendMasterId: created.master.id } : {};
  } catch {
    /* Offline or refused — the local row stands; the next change retries. */
    return {};
  }
};

/**
 * Hydrate the four stores from the server into a db patch.
 *
 * Returns `{ patch, changed }` — collections merged by uid, unseen rows
 * given fresh local ids, allocation links remapped through the uid maps.
 */
export const hydrateTdsStores = async (db, companyId) => {
  if (!hasApiSession()) return { patch: {}, changed: false };
  let rows = [];
  try {
    rows = (await listOrgMasters(Object.values(TDS_SYNC_KINDS)))?.masters || [];
  } catch {
    return { patch: {}, changed: false };
  }
  if (!rows.length) return { patch: {}, changed: false };

  const byKind = new Map();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }

  const patch = {};
  let changed = false;
  /* uid → local id, per collection, filled as each store merges — the
     allocation pass reads the event and challan maps. */
  const localIdByUid = { tdsTransactions: new Map(), tdsChallans: new Map() };

  const mergeStore = (collection, remapLinks = null) => {
    const kind = TDS_SYNC_KINDS[collection];
    const incoming = byKind.get(kind) || [];
    const existing = Array.isArray(db?.[collection]) ? db[collection] : [];
    const knownUids = new Map(existing.map((x) => [String(x?.uid || ''), x]).filter(([k]) => k));
    let nextId = existing.reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0);
    const merged = [...existing];

    for (const r of incoming) {
      const data = r?.data && typeof r.data === 'object' ? r.data : null;
      if (!data?.uid) continue;
      const known = knownUids.get(String(data.uid));
      if (known) {
        if (localIdByUid[collection]) localIdByUid[collection].set(String(data.uid), known.id);
        /* This browser already holds the row; keep its copy (it may be
           ahead of the server between write-throughs). */
        continue;
      }
      const localId = ++nextId;
      const row = {
        ...data,
        id: localId,
        companyId,
        backendMasterId: r.id,
        ...(remapLinks ? remapLinks(data) : {}),
      };
      merged.push(row);
      if (localIdByUid[collection]) localIdByUid[collection].set(String(data.uid), localId);
      changed = true;
    }
    if (merged.length !== existing.length) patch[collection] = merged;
  };

  /* Order matters: events and challans first, so the allocation pass can
     remap its two foreign keys through their uid maps. */
  for (const x of Array.isArray(db?.tdsTransactions) ? db.tdsTransactions : []) {
    if (x?.uid) localIdByUid.tdsTransactions.set(String(x.uid), x.id);
  }
  for (const x of Array.isArray(db?.tdsChallans) ? db.tdsChallans : []) {
    if (x?.uid) localIdByUid.tdsChallans.set(String(x.uid), x.id);
  }
  mergeStore('tdsTransactions');
  mergeStore('tdsChallans');
  mergeStore('tdsChallanAllocations', (data) => ({
    tdsTransactionId: localIdByUid.tdsTransactions.get(String(data.tdsTransactionUid || '')) ?? data.tdsTransactionId,
    challanId: localIdByUid.tdsChallans.get(String(data.challanUid || '')) ?? data.challanId,
  }));
  mergeStore('tdsFilings');

  return { patch, changed };
};
