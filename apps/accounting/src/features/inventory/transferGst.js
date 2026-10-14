import { reverseJournalOnLedger } from '@ui/utils/journalSync';

const safeArray = (v) => (Array.isArray(v) ? v : []);
const normalizeId = (v) => String(v ?? '').trim();

/**
 * Undo the IGST journal a dispatched inter-state transfer posted.
 *
 * Submitting an inter-state transfer posts Dr Input IGST / Cr Output IGST to
 * the ledger, the server's included. Rejecting or cancelling the transfer
 * left that entry standing. It is reversed the way the journal list reverses
 * — an opposite entry, never an erasure — and on the server first, so a
 * refusal there stops the reject instead of leaving the two books apart.
 *
 * Returns true when the transfer may go on to be rejected or cancelled
 * (nothing to undo, or undone), false when the server refused.
 *
 * `reverseOnLedger` is injectable for tests; it defaults to the real call.
 */
export async function reverseTransferGst({ db, setDb, companyId, transfer, reverseOnLedger = reverseJournalOnLedger }) {
  const jid = transfer?.gstJournalId;
  if (!jid) return true;
  const journal = safeArray(db?.journalEntries).find((j) => j.companyId === companyId && String(j.id) === String(jid));
  if (!journal || String(journal.status || '').toUpperCase() === 'REVERSED') return true;
  if (journal.backendEntryId) {
    const { reversed } = await reverseOnLedger(journal);
    if (!reversed) return false;
  }
  setDb((prev) => ({
    ...prev,
    journalEntries: (prev.journalEntries || []).map((j) =>
      j.companyId === companyId && String(j.id) === String(jid) ? { ...j, status: 'REVERSED' } : j
    ),
    stockTransfers: (prev.stockTransfers || []).map((x) =>
      normalizeId(x?.id) === normalizeId(transfer?.id) ? { ...x, gstJournalId: null, gstJournalReversedId: jid } : x
    ),
  }));
  return true;
}
