/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/utils/journalSync', () => ({ reverseJournalOnLedger: vi.fn() }));

import { reverseTransferGst } from './transferGst';

/**
 * Rejecting or cancelling a dispatched inter-state transfer undoes the IGST
 * entry its dispatch posted — on the server first, and not at all if the
 * server refuses.
 */

const COMPANY = 1;

const dbWith = (journal) => ({
  journalEntries: journal ? [journal, { id: 99, companyId: COMPANY, number: 'JV-99' }] : [],
  stockTransfers: [{ id: 't1', companyId: COMPANY, number: 'TRF-0007', gstJournalId: journal?.id ?? null }],
});

/** A setDb that applies the updater to a copy, so a test reads the result. */
const capture = (db) => {
  const box = { db, calls: 0 };
  box.setDb = (updater) => {
    box.calls += 1;
    box.db = typeof updater === 'function' ? updater(box.db) : updater;
  };
  return box;
};

const igst = (over = {}) => ({ id: 12, companyId: COMPANY, number: 'TRF-TRF-0007', backendEntryId: 'srv-je-12', status: 'POSTED', ...over });

describe('reversing the IGST a transfer posted', () => {
  it('reverses the entry on the server, then marks it reversed here and unlinks it from the transfer', async () => {
    const box = capture(dbWith(igst()));
    const reverseOnLedger = vi.fn(async () => ({ reversed: true }));

    const ok = await reverseTransferGst({ db: box.db, setDb: box.setDb, companyId: COMPANY, transfer: box.db.stockTransfers[0], reverseOnLedger });

    expect(ok).toBe(true);
    expect(reverseOnLedger).toHaveBeenCalledWith(expect.objectContaining({ id: 12, backendEntryId: 'srv-je-12' }));
    expect(box.db.journalEntries.find((j) => j.id === 12).status).toBe('REVERSED');
    expect(box.db.journalEntries.find((j) => j.id === 99).status).toBeUndefined();
    expect(box.db.stockTransfers[0]).toMatchObject({ gstJournalId: null, gstJournalReversedId: 12 });
  });

  it('stops — and changes nothing — when the server refuses the reversal', async () => {
    const box = capture(dbWith(igst()));
    const reverseOnLedger = vi.fn(async () => ({ reversed: false, failed: true }));

    const ok = await reverseTransferGst({ db: box.db, setDb: box.setDb, companyId: COMPANY, transfer: box.db.stockTransfers[0], reverseOnLedger });

    expect(ok).toBe(false);
    expect(box.calls).toBe(0);
    expect(box.db.journalEntries.find((j) => j.id === 12).status).toBe('POSTED');
  });

  it('reverses an entry this browser alone holds without asking the server', async () => {
    const box = capture(dbWith(igst({ backendEntryId: undefined })));
    const reverseOnLedger = vi.fn();

    const ok = await reverseTransferGst({ db: box.db, setDb: box.setDb, companyId: COMPANY, transfer: box.db.stockTransfers[0], reverseOnLedger });

    expect(ok).toBe(true);
    expect(reverseOnLedger).not.toHaveBeenCalled();
    expect(box.db.journalEntries.find((j) => j.id === 12).status).toBe('REVERSED');
  });

  it('has nothing to do for an intra-state transfer, or one already reversed', async () => {
    const reverseOnLedger = vi.fn();
    const none = capture(dbWith(null));
    expect(await reverseTransferGst({ db: none.db, setDb: none.setDb, companyId: COMPANY, transfer: none.db.stockTransfers[0], reverseOnLedger })).toBe(true);

    const done = capture(dbWith(igst({ status: 'REVERSED' })));
    expect(await reverseTransferGst({ db: done.db, setDb: done.setDb, companyId: COMPANY, transfer: done.db.stockTransfers[0], reverseOnLedger })).toBe(true);

    expect(reverseOnLedger).not.toHaveBeenCalled();
    expect(none.calls + done.calls).toBe(0);
  });

  it("never touches another company's journal with the same id", async () => {
    const db = dbWith(igst());
    db.journalEntries.push({ id: 12, companyId: 2, number: 'THEIRS', status: 'POSTED' });
    const box = capture(db);
    await reverseTransferGst({ db: box.db, setDb: box.setDb, companyId: COMPANY, transfer: box.db.stockTransfers[0], reverseOnLedger: async () => ({ reversed: true }) });
    expect(box.db.journalEntries.find((j) => j.companyId === 2).status).toBe('POSTED');
  });
});
