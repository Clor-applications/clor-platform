import { useEffect, useMemo, useState } from 'react';

import { listPaymentModes } from '@ui/api/payments';
import { createLedgerAccount } from '@ui/api/ledger';
import { cashBankIndex } from '../cashBank/transactions';

/**
 * Loads the cash and bank ledgers a payment may be made through.
 *
 * Requirement 14: the Mode field is these accounts, not a hardcoded
 * Cash/Bank/UPI/Card list. A user who created "HDFC Current A/c" picks that,
 * and the receipt debits that exact ledger.
 *
 * Failure is reported rather than swallowed: with no modes the form cannot
 * post to the ledger, and a silently empty dropdown reads as "no accounts
 * configured" when the truth may be an expired session.
 */
export default function usePaymentModes(db = null, companyId = null) {
  const [modes, setModes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const localModes = useMemo(() => {
    if (!db || companyId === null || companyId === undefined) return [];
    const groups = new Map(
      (Array.isArray(db.accountGroups) ? db.accountGroups : []).map((group) => [String(group.id), group])
    );
    const isCash = (account) => {
      let group = groups.get(String(account?.groupId || '')) || null;
      const seen = new Set();
      while (group && !seen.has(String(group.id))) {
        seen.add(String(group.id));
        const name = String(group.name || '').trim().toLowerCase();
        if (['cash', 'cash-in-hand', 'cash in hand'].includes(name)) return true;
        const parent = group.parentGroupId;
        if (parent === null || parent === undefined || parent === '') break;
        group = groups.get(String(parent)) || null;
      }
      return false;
    };
    return cashBankIndex(db, companyId).accounts.filter((account) => !account?.hiddenFromChart).map((account) => ({
      id: String(account.serverLedgerAccountId || account.backendLedgerId || account.id),
      localId: account.id,
      code: String(account.code || '').trim(),
      name: String(account.name || '').trim(),
      controlKind: isCash(account) ? 'CASH' : 'BANK',
    }));
  }, [db, companyId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rows = await listPaymentModes();
        if (!cancelled) {
          const serverModes = Array.isArray(rows) ? rows : [];
          const merged = [];

          /* Chart of Accounts owns the visible identity. The API contributes
             the posting id and backend metadata, but it must not invent a
             display code for a ledger whose chart row deliberately has none
             (the default Cash ledger is the common case). */
          for (const local of localModes) {
            const byId = serverModes.find((row) => String(row?.id || '') === String(local.id));
            const byName = serverModes.find(
              (row) => String(row?.name || '').trim().toLowerCase() === String(local.name || '').trim().toLowerCase()
            );
            let server = byId || byName || null;

            /* Older companies already have the default Cash row in their
               browser chart, but that row predates server ledger links. A
               local numeric id looks valid in the select and is then rejected
               by POST /payments. Create/reuse its posting account before the
               option is exposed; sourceKey makes this safe on every load. */
            if (!server) {
              const synced = await createLedgerAccount({
                name: local.name,
                accountType: 'ASSET',
                controlKind: local.controlKind,
                sourceKey: `coa-${companyId}-${local.localId}`,
              });
              server = synced?.account || null;
            }
            if (!server?.id) continue;
            merged.push({
              ...server,
              ...local,
              id: String(server.id),
              code: String(local.code || '').trim(),
              name: String(local.name || '').trim(),
              controlKind: local.controlKind,
            });
          }
          /*
           * One option per posting account.
           *
           * Two chart rows can resolve to the same server ledger — a default
           * "Cash" the browser has always had and a "Cash-in-Hand" hydrated
           * from the books are one account as far as posting is concerned —
           * and the select then held two options with the same id. React
           * reported it as two children with the same key, and a person saw
           * the same account twice with no way to tell which was which.
           */
          const byPostingId = new Map();
          for (const row of merged) {
            if (!byPostingId.has(String(row.id))) byPostingId.set(String(row.id), row);
          }

          setModes([...byPostingId.values()]);
          setError('');
        }
      } catch (e) {
        if (!cancelled) {
          setModes(localModes);
          setError(localModes.length ? '' : String(e?.message || 'Unable to load cash and bank accounts.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localModes]);

  return { modes, loading, error };
}

/** "1200 · HDFC Current A/c" — code first, because that is how ledgers are read. */
export const modeLabel = (mode) => [String(mode?.code || '').trim(), String(mode?.name || '').trim()].filter(Boolean).join(' · ');
