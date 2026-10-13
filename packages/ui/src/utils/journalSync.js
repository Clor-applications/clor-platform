import { postJournalEntry, reverseJournalEntry } from '../api/ledger';
import { hasApiSession } from '../api/purchaseDocs';
import { notify } from '../components/ui/notify';

/**
 * Posting a manual journal to the general ledger on the server.
 *
 * A journal entry is not a document that merely happens to be stored — it is a
 * ledger posting. Kept only in the browser it meant the trial balance, the P&L
 * and the balance sheet said different things on different machines, and the
 * server's books were missing entries somebody had deliberately made.
 *
 * The browser's `accountId` on a line is its own numeric chart id and means
 * nothing on the server, so a line can only be posted once its account carries
 * a `serverLedgerAccountId`. An entry with any line that cannot be resolved is
 * not posted at all: half a journal is not a journal, and posting one side of a
 * double entry would unbalance the ledger it was meant to correct.
 */
export const postJournalToLedger = async ({ chartRows, entry }) => {
  if (!hasApiSession()) return {};

  const byId = new Map((Array.isArray(chartRows) ? chartRows : []).map((c) => [String(c.id), c]));
  const lines = [];
  for (const l of entry.lines || []) {
    const serverId = String(byId.get(String(l.accountId))?.serverLedgerAccountId || '').trim();
    if (!serverId) return {};
    lines.push({
      ledgerAccountId: serverId,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      // The server calls a line's note `description`; sent under any other
      // key zod strips it and the note is lost without a word.
      description: l.narration || undefined,
    });
  }
  if (!lines.length) return {};

  try {
    const posted = await postJournalEntry({
      date: String(entry.date || '').slice(0, 10),
      journalCode: 'JV',
      narration: entry.narration || null,
      lines,
    });
    const id = posted?.entry?.id;
    return id ? { backendEntryId: String(id) } : {};
  } catch (e) {
    notify.error(`Saved on this device only — the ledger refused it: ${String(e?.message || e)}`);
    return {};
  }
};

/**
 * Taking back a journal that has already reached the ledger.
 *
 * A posting is never erased. Deleting the row here while the server kept the
 * posting would put the two books out of step again — the thing this whole
 * change exists to stop — so the entry is reversed instead: the original stays,
 * marked reversed, and the opposite entry arrives with the next sync.
 */
export const reverseJournalOnLedger = async (entry) => {
  const entryId = String(entry?.backendEntryId || '').trim();
  if (!entryId || !hasApiSession()) return { reversed: false };
  try {
    await reverseJournalEntry(entryId, `Reversal of ${entry.number || 'journal entry'}`);
    return { reversed: true };
  } catch (e) {
    notify.error(`The ledger would not reverse this entry: ${String(e?.message || e)}`);
    return { reversed: false, failed: true };
  }
};
