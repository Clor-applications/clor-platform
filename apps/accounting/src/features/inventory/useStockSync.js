import { useEffect, useRef } from 'react';
import { hasApiSession } from '@ui/api/purchaseDocs';
import { deleteStockDocument, listStockDocuments, putStockDocument } from '@ui/api/stockDocuments';
import { notify } from '@ui/components/ui/notify';
import { STOCK_COLLECTIONS, STOCK_KINDS, fingerprintOf, mergeServerDocs, newStockUid, toServerDoc } from './stockSync';

/**
 * Keeps stock adjustments and transfers on the server — see stockSync.js.
 *
 * Watching the db, it (1) stamps a uid on any stock document born without
 * one, (2) uploads every document the server has not acknowledged, or whose
 * content moved after it was, and (3) merges what other devices wrote: on
 * start, when items arrive (a document naming an item this browser has not
 * loaded yet waits for it), and whenever the window regains focus, so a
 * transfer received at the other branch shows up here without a reload.
 *
 * A document the server refuses for a reason that will not pass by itself —
 * a closed period, a missing permission, a warehouse the person cannot use —
 * is marked and not retried until it changes. Everything else is best-effort
 * and retries on the next change: the local copy is the working copy.
 */

const REFETCH_AFTER_MS = 30_000;
const PERMANENT = new Set([400, 403, 404, 409, 413]);

export const useStockSync = (db, setDb, currentCompany) => {
  const companyId = currentCompany?.id;
  const busy = useRef(false);
  const lastPull = useRef(0);
  const pulling = useRef(false);
  const warned = useRef(new Set());
  const dbRef = useRef(db);
  dbRef.current = db;

  const itemsSignature = (Array.isArray(db?.items) ? db.items : []).filter(
    (i) => Number(i?.companyId) === Number(companyId) && i?.backendItemId
  ).length;

  const pull = async (force = false) => {
    if (!companyId || !hasApiSession() || pulling.current) return;
    if (!force && Date.now() - lastPull.current < REFETCH_AFTER_MS) return;
    pulling.current = true;
    lastPull.current = Date.now();
    try {
      const res = await listStockDocuments();
      const docs = Array.isArray(res?.documents) ? res.documents : [];
      setDb((prev) => {
        const { patch, changed } = mergeServerDocs(prev, companyId, docs);
        return changed ? { ...prev, ...patch } : prev;
      });
    } catch {
      /* Offline, or no right to read stock: the local copy stands. */
    } finally {
      pulling.current = false;
    }
  };

  /* On start, and again as items with server ids arrive. */
  useEffect(() => {
    pull(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, itemsSignature]);

  /* When the window comes back into focus — another device may have moved stock. */
  useEffect(() => {
    const onFocus = () => pull(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  /* Uploads, a moment after each change. */
  useEffect(() => {
    if (!companyId || !hasApiSession()) return undefined;
    const timer = setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const current = dbRef.current;

        /* Pass 1 — identities. */
        const needUid = [];
        for (const collection of STOCK_COLLECTIONS) {
          for (const row of Array.isArray(current?.[collection]) ? current[collection] : []) {
            if (Number(row?.companyId) === Number(companyId) && !row.uid) needUid.push({ collection, id: row.id });
          }
        }
        if (needUid.length) {
          setDb((prev) => {
            const next = { ...prev };
            for (const collection of STOCK_COLLECTIONS) {
              const ids = new Set(needUid.filter((n) => n.collection === collection).map((n) => String(n.id)));
              if (!ids.size) continue;
              next[collection] = (prev[collection] || []).map((r) =>
                Number(r?.companyId) === Number(companyId) && ids.has(String(r.id)) && !r.uid ? { ...r, uid: newStockUid(collection) } : r
              );
            }
            return next;
          });
          return; /* The next tick uploads, with the uids in place. */
        }

        /* Pass 2 — upload what the server has not seen, or has seen stale. */
        const acks = [];
        const blocks = [];
        for (const collection of STOCK_COLLECTIONS) {
          for (const row of Array.isArray(current?.[collection]) ? current[collection] : []) {
            if (Number(row?.companyId) !== Number(companyId) || !row.uid) continue;
            const print = fingerprintOf(row);
            if (row.backendStockId && row.syncedFingerprint === print) continue;
            if (row.syncBlocked?.fingerprint === print) continue;
            try {
              const res = await putStockDocument(STOCK_KINDS[collection], row.uid, toServerDoc(collection, row, current, companyId));
              const doc = res?.document;
              if (doc?.id) acks.push({ collection, uid: row.uid, backendStockId: doc.id, syncedAt: doc.updatedAt, print });
            } catch (e) {
              // Two devices creating the same document at once is not a refusal.
              if (PERMANENT.has(Number(e?.status)) && e?.data?.code !== 'conflict') {
                blocks.push({ collection, uid: row.uid, print, reason: String(e?.message || e) });
              }
              /* Otherwise offline or busy: the next change retries. */
            }
          }
        }

        if (acks.length || blocks.length) {
          setDb((prev) => {
            const next = { ...prev };
            for (const collection of STOCK_COLLECTIONS) {
              const a = acks.filter((x) => x.collection === collection);
              const b = blocks.filter((x) => x.collection === collection);
              if (!a.length && !b.length) continue;
              next[collection] = (prev[collection] || []).map((r) => {
                if (Number(r?.companyId) !== Number(companyId)) return r;
                const ack = a.find((x) => x.uid === r.uid);
                if (ack) {
                  const { syncBlocked: _drop, ...rest } = r;
                  return { ...rest, backendStockId: ack.backendStockId, syncedAt: ack.syncedAt, syncedFingerprint: ack.print };
                }
                const block = b.find((x) => x.uid === r.uid);
                return block ? { ...r, syncBlocked: { fingerprint: block.print, reason: block.reason } } : r;
              });
            }
            return next;
          });
        }

        for (const b of blocks) {
          const key = `${b.collection}:${b.uid}`;
          if (warned.current.has(key)) continue;
          warned.current.add(key);
          notify.error(`A stock ${b.collection === 'stockTransfers' ? 'transfer' : 'adjustment'} was kept on this device only: ${b.reason}`);
        }
      } finally {
        busy.current = false;
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db?.stockAdjustments, db?.stockTransfers, companyId]);
};

/**
 * Delete a stock document on the server before it goes from this browser.
 * Returns true when the caller may remove it locally.
 */
export const deleteStockDocOnServer = async (collection, row) => {
  if (!row?.backendStockId || !row?.uid || !hasApiSession()) return true;
  try {
    await deleteStockDocument(STOCK_KINDS[collection], row.uid);
    return true;
  } catch (e) {
    if (Number(e?.status) === 404) return true; // already gone
    notify.error(String(e?.message || 'The server would not delete it.'));
    return false;
  }
};

export default useStockSync;
