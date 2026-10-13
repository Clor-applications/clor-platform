import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { JournalEntryForm } from '../../App';

/**
 * A ledger that has been posted to cannot be deleted — the entries would point
 * at nothing. The spec's answer is to retire it instead: it keeps its history
 * and its balance, and stops being offered for new entries.
 */

const company = { id: 1, name: 'Test Co', state: 'Karnataka' };

const db = {
  journalEntries: [],
  chartOfAccounts: [
    { id: 1, companyId: 1, name: 'Bank Charges' },
    { id: 2, companyId: 1, name: 'Old Suspense', active: false },
  ],
  companies: [company],
};

const openAccountPicker = async (user) => {
  const trigger = screen.getByLabelText('Ledger, line 1');
  await user.click(trigger);
  return screen.findAllByRole('option');
};

describe('a retired ledger', () => {
  it('is not offered on a new journal entry', async () => {
    const user = userEvent.setup();
    render(<JournalEntryForm db={db} setDb={vi.fn()} currentCompany={company} onClose={() => {}} />);

    const labels = (await openAccountPicker(user)).map((o) => o.textContent);
    expect(labels.join(' ')).toContain('Bank Charges');
    expect(labels.join(' ')).not.toContain('Old Suspense');
  });

  /*
   * Dropping it from an entry that already names it would silently lose the
   * line the moment somebody opened the old voucher.
   */
  it('still appears on an entry that already uses it', async () => {
    const user = userEvent.setup();
    const entry = { id: 9, companyId: 1, number: 'JV-1', date: '2026-04-01', lines: [{ accountId: '2', debit: 100, credit: 0 }, { accountId: '1', debit: 0, credit: 100 }] };
    render(<JournalEntryForm db={{ ...db, journalEntries: [entry] }} setDb={vi.fn()} currentCompany={company} onClose={() => {}} initialData={entry} />);

    const labels = (await openAccountPicker(user)).map((o) => o.textContent);
    expect(labels.join(' ')).toContain('Old Suspense');
  });
});
