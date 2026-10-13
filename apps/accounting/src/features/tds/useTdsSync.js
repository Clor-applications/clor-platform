import { useEffect, useRef } from 'react';

import { hasApiSession } from '@ui/api/purchaseDocs';
import { hydrateTdsStores, newTdsUid, pushTdsRow } from './tdsSync';

/**
 * One syncer for the four TDS stores, instead of ten writers each learning
 * the same three lines.
 *
 * Watching the db, it (1) stamps a uid on any compliance row born without
 * one, (2) embeds the uid-form of an allocation's two links so the join
 * survives crossing devices, (3) pushes every row the server has not
 * acknowledged and records the acknowledgement, and (4) re-pushes a row
 * whose content moved after it was acknowledged (the fingerprint is the
 * row itself minus its sync bookkeeping). On mount it hydrates what other
 * devices wrote. Best-effort throughout — the local book is the working
 * copy and a refused push retries on the next change.
 */

const SYNC_FIELDS = new Set(['backendMasterId', 'syncedFingerprint']);
const COLLECTIONS = ['tdsTransactions', 'tdsChallans', 'tdsChallanAllocations', 'tdsFilings'];

const fingerprintOf = (row) => {
  const keys = Object.keys(row).filter((k) => !SYNC_FIELDS.has(k)).sort();
  return JSON.stringify(keys.map((k) => [k, row[k]]));
};

export const useTdsSync = (db, setDb, currentCompany) => {
  const busy = useRef(false);
  const hydrated = useRef(false);
  const companyId = currentCompany?.id;

  /* Hydrate once per session per company. */
  useEffect(() => {
    if (!companyId || hydrated.current || !hasApiSession()) return;
    hydrated.current = true;
    let cancelled = false;
    (async () => {
      const { patch, changed } = await hydrateTdsStores(db, companyId);
      if (cancelled || !changed) return;
      setDb((prev) => ({ ...prev, ...patch }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    if (!companyId || !hasApiSession() || busy.current) return undefined;
    const timer = setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        /* Pass 1 — identities and link-uids, one local patch. */
        const uidPatches = new Map();
        const uidOf = new Map();
        for (const collection of COLLECTIONS) {
          for (const row of Array.isArray(db?.[collection]) ? db[collection] : []) {
            if (Number(row?.companyId) !== Number(companyId)) continue;
            if (!row.uid) uidPatches.set(`${collection}:${row.id}`, { collection, id: row.id, patch: { uid: newTdsUid() } });
            uidOf.set(`${collection}:${row.id}`, row.uid || uidPatches.get(`${collection}:${row.id}`)?.patch.uid);
          }
        }
        for (const row of Array.isArray(db?.tdsChallanAllocations) ? db.tdsChallanAllocations : []) {
          if (Number(row?.companyId) !== Number(companyId)) continue;
          const wantEvent = uidOf.get(`tdsTransactions:${row.tdsTransactionId}`);
          const wantChallan = uidOf.get(`tdsChallans:${row.challanId}`);
          if ((wantEvent && row.tdsTransactionUid !== wantEvent) || (wantChallan && row.challanUid !== wantChallan)) {
            const key = `tdsChallanAllocations:${row.id}`;
            const at = uidPatches.get(key) || { collection: 'tdsChallanAllocations', id: row.id, patch: {} };
            if (wantEvent) at.patch.tdsTransactionUid = wantEvent;
            if (wantChallan) at.patch.challanUid = wantChallan;
            uidPatches.set(key, at);
          }
        }
        if (uidPatches.size) {
          setDb((prev) => {
            const next = { ...prev };
            for (const collection of COLLECTIONS) {
              const mine = [...uidPatches.values()].filter((p) => p.collection === collection);
              if (!mine.length) continue;
              next[collection] = (prev[collection] || []).map((r) => {
                const hit = mine.find((p) => String(p.id) === String(r.id) && Number(r.companyId) === Number(companyId));
                return hit ? { ...r, ...hit.patch } : r;
              });
            }
            return next;
          });
          return; /* Next tick pushes, with the uids in place. */
        }

        /* Pass 2 — push what the server has not seen, or has seen stale. */
        const acks = [];
        for (const collection of COLLECTIONS) {
          for (const row of Array.isArray(db?.[collection]) ? db[collection] : []) {
            if (Number(row?.companyId) !== Number(companyId) || !row.uid) continue;
            const print = fingerprintOf(row);
            if (row.backendMasterId && row.syncedFingerprint === print) continue;
            const res = await pushTdsRow(collection, row);
            if (res.backendMasterId) acks.push({ collection, id: row.id, backendMasterId: res.backendMasterId, print });
          }
        }
        if (acks.length) {
          setDb((prev) => {
            const next = { ...prev };
            for (const collection of COLLECTIONS) {
              const mine = acks.filter((a) => a.collection === collection);
              if (!mine.length) continue;
              next[collection] = (prev[collection] || []).map((r) => {
                const hit = mine.find((a) => String(a.id) === String(r.id) && Number(r.companyId) === Number(companyId));
                return hit ? { ...r, backendMasterId: hit.backendMasterId, syncedFingerprint: hit.print } : r;
              });
            }
            return next;
          });
        }
      } finally {
        busy.current = false;
      }
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db?.tdsTransactions, db?.tdsChallans, db?.tdsChallanAllocations, db?.tdsFilings, companyId]);
};

export default useTdsSync;
