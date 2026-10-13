import { createBankBookEntry, deleteBankBookEntry, updateBankBookEntry } from '../api/bankBook';
import { hasApiSession } from '../api/purchaseDocs';
import { notify } from '../components/ui/notify';

/**
 * Write-through for the cash and bank book.
 *
 * The same rule the other masters follow: the row is kept locally whatever the
 * server says, so nothing typed is ever lost, and a refusal is reported rather
 * than swallowed.
 *
 * The browser's `cashBankAccountId` and `ledgerId` are its own numeric chart
 * ids and mean nothing on the server, so a line can only be written through
 * once its account has a `serverLedgerAccountId` — which it gets when the
 * ledger syncs. Until then the entry stays here and says so, rather than being
 * posted against whatever id happened to be passed.
 */
const serverLedgerIdFor = (chartRows, localId) => {
  const row = (Array.isArray(chartRows) ? chartRows : []).find((c) => String(c.id) === String(localId));
  return String(row?.serverLedgerAccountId || '').trim();
};

export const saveBankEntry = async ({ chartRows, entry }) => {
  if (!hasApiSession()) return {};
  const ledgerAccountId = serverLedgerIdFor(chartRows, entry.cashBankAccountId);
  if (!ledgerAccountId) return {};

  try {
    const created = await createBankBookEntry({
      ledgerAccountId,
      contraLedgerAccountId: serverLedgerIdFor(chartRows, entry.ledgerId) || null,
      direction: String(entry.direction || 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
      date: String(entry.date || '').slice(0, 10),
      amount: Number(entry.amount) || 0,
      narration: entry.narration || entry.description || null,
      reference: entry.reference || null,
      source: entry.source === 'STATEMENT' ? 'STATEMENT' : 'MANUAL',
    });
    const id = created?.entry?.id;
    return id ? { backendBankEntryId: String(id), serverLedgerAccountId: ledgerAccountId } : {};
  } catch (e) {
    notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    return {};
  }
};

export const patchBankEntry = async ({ chartRows, row, patch }) => {
  const id = String(row?.backendBankEntryId || '').trim();
  if (!id || !hasApiSession()) return;
  try {
    await updateBankBookEntry(id, {
      ...(patch.cashBankAccountId !== undefined
        ? { ledgerAccountId: serverLedgerIdFor(chartRows, patch.cashBankAccountId) || undefined }
        : {}),
      ...(patch.ledgerId !== undefined
        ? { contraLedgerAccountId: serverLedgerIdFor(chartRows, patch.ledgerId) || null }
        : {}),
      ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
      ...(patch.date !== undefined ? { date: String(patch.date).slice(0, 10) } : {}),
      ...(patch.amount !== undefined ? { amount: Number(patch.amount) || 0 } : {}),
      ...(patch.narration !== undefined ? { narration: patch.narration || null } : {}),
    });
  } catch (e) {
    notify.error(`Changed on this device only — the server refused it: ${String(e?.message || e)}`);
  }
};

export const removeBankEntry = async (row) => {
  const id = String(row?.backendBankEntryId || '').trim();
  if (!id || !hasApiSession()) return;
  try {
    await deleteBankBookEntry(id);
  } catch (e) {
    notify.error(`Removed on this device only — the server refused it: ${String(e?.message || e)}`);
  }
};
