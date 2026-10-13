/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const posted = vi.fn();
const reversed = vi.fn();
let signedIn = true;
const errors = vi.fn();

vi.mock('../api/ledger', () => ({
  postJournalEntry: (...a) => posted(...a),
  reverseJournalEntry: (...a) => reversed(...a),
}));
vi.mock('../api/purchaseDocs', () => ({ hasApiSession: () => signedIn }));
vi.mock('../components/ui/notify', () => ({ notify: { error: (...a) => errors(...a), success: vi.fn() } }));

import { postJournalToLedger, reverseJournalOnLedger } from './journalSync';

const chart = [
  { id: 12, name: 'Rent', serverLedgerAccountId: 'srv-rent' },
  { id: 34, name: 'Bank', serverLedgerAccountId: 'srv-bank' },
  { id: 56, name: 'Local only' },
];
const entry = {
  date: '2026-09-10T00:00:00.000Z',
  narration: 'September rent',
  lines: [
    { accountId: 12, debit: 25000, credit: 0, narration: 'rent for Sept' },
    { accountId: 34, debit: 0, credit: 25000 },
  ],
};

beforeEach(() => {
  posted.mockReset().mockResolvedValue({ entry: { id: 'srv-jv-1' } });
  reversed.mockReset().mockResolvedValue({ entry: { id: 'srv-rev-1' } });
  errors.mockReset();
  signedIn = true;
});

describe('posting a manual journal to the ledger', () => {
  it('posts it, so the trial balance is the same on every machine', async () => {
    const patch = await postJournalToLedger({ chartRows: chart, entry });

    expect(posted).toHaveBeenCalledTimes(1);
    const body = posted.mock.calls[0][0];
    expect(body.date).toBe('2026-09-10');
    expect(body.journalCode).toBe('JV');
    expect(body.narration).toBe('September rent');
    expect(body.lines).toEqual([
      { ledgerAccountId: 'srv-rent', debit: 25000, credit: 0, description: 'rent for Sept' },
      { ledgerAccountId: 'srv-bank', debit: 0, credit: 25000, description: undefined },
    ]);
    expect(patch).toEqual({ backendEntryId: 'srv-jv-1' });
  });

  it('posts nothing at all when one line has no server account', async () => {
    // Half a journal is not a journal: posting only the resolvable side would
    // leave the server's ledger out of balance by the missing leg.
    const patch = await postJournalToLedger({
      chartRows: chart,
      entry: { ...entry, lines: [entry.lines[0], { accountId: 56, debit: 0, credit: 25000 }] },
    });

    expect(posted).not.toHaveBeenCalled();
    expect(patch).toEqual({});
  });

  it('keeps the entry here and says so when the ledger refuses it', async () => {
    posted.mockRejectedValue(new Error('period is locked'));

    const patch = await postJournalToLedger({ chartRows: chart, entry });

    expect(patch).toEqual({});
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toMatch(/period is locked/);
  });

  it('does not call the server when nobody is signed in', async () => {
    signedIn = false;
    expect(await postJournalToLedger({ chartRows: chart, entry })).toEqual({});
    expect(posted).not.toHaveBeenCalled();
  });
});

describe('taking back a journal that reached the ledger', () => {
  const jv = { backendEntryId: 'srv-jv-1', number: 'JV/2026/0007' };

  it('reverses the posting rather than erasing it', async () => {
    expect(await reverseJournalOnLedger(jv)).toEqual({ reversed: true });
    expect(reversed).toHaveBeenCalledWith('srv-jv-1', 'Reversal of JV/2026/0007');
  });

  it('reports a refusal instead of claiming the entry is gone', async () => {
    // The caller keeps the row on a false answer here, so the books would say
    // two different things: reversed in the browser, still posted on the
    // server.
    reversed.mockRejectedValue(new Error('period is locked'));

    expect(await reverseJournalOnLedger(jv)).toEqual({ reversed: false, failed: true });
    expect(String(errors.mock.calls[0][0])).toMatch(/period is locked/);
  });

  it('leaves an entry that never reached the ledger to plain deletion', async () => {
    expect(await reverseJournalOnLedger({ number: 'JV/2026/0008' })).toEqual({ reversed: false });
    expect(reversed).not.toHaveBeenCalled();
  });
});
