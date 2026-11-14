import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/ledger', () => ({
  getJournalEntries: vi.fn(async () => ({ entries: [{
    id: 'server-import-1', entryNo: 'JE-0042', date: '2026-10-31',
    narration: 'Imported cash receipt', sourceDocType: 'IMPORT_JOURNAL', status: 'POSTED',
    lines: [
      { ledgerAccount: { name: 'Cash', code: '1101' }, debit: 5000, credit: 0, description: 'Received' },
      { ledgerAccount: { name: 'Raj Mart', code: '200003' }, debit: 0, credit: 5000, description: 'Received' },
    ],
  }] })),
}));
vi.mock('@ui/utils/journalSync', () => ({ reverseJournalOnLedger: vi.fn(async () => ({ reversed: true })) }));

import { getJournalEntries } from '@ui/api/ledger';
import JournalEntriesList from './JournalEntriesList';

const company = { id: 1, name: 'Test Company' };
const db = {
  journalEntries: [{ id: 1, companyId: 1, number: 'JE-0001', date: '2026-10-01', narration: 'Local entry', totalDebit: 100, totalCredit: 100, lines: [{ debit: 100 }, { credit: 100 }] }],
  chartOfAccounts: [],
};

describe('Manual Journals', () => {
  it('shows only effective imported vouchers after a duplicate is reversed', async () => {
    vi.mocked(getJournalEntries).mockResolvedValueOnce({ entries: [
      { id: 'original', entryNo: 'JE-0001', date: '2026-10-31', status: 'POSTED', lines: [] },
      { id: 'duplicate', entryNo: 'JE-0002', date: '2026-10-31', status: 'REVERSED', reversedById: 'contra', lines: [] },
      { id: 'contra', entryNo: 'JE-0003', date: '2026-10-31', status: 'POSTED', lines: [] },
    ] });
    render(<JournalEntriesList db={{ journalEntries: [], chartOfAccounts: [] }} setDb={vi.fn()} currentCompany={company} />);
    expect(await screen.findByText('JE-0001')).toBeInTheDocument();
    expect(screen.queryByText('JE-0002')).not.toBeInTheDocument();
    expect(screen.queryByText('JE-0003')).not.toBeInTheDocument();
  });

  it('shows server-posted imports alongside local entries and opens their full voucher', async () => {
    render(<JournalEntriesList db={db} setDb={vi.fn()} currentCompany={company} />);
    expect(await screen.findByText('JE-0042')).toBeInTheDocument();
    expect(screen.getByText('JE-0001')).toBeInTheDocument();
    expect(getJournalEntries).toHaveBeenCalledWith(200, 'IMPORT_JOURNAL');
    await userEvent.click(screen.getByText('JE-0042'));
    expect(screen.getByText('Imported cash receipt')).toBeInTheDocument();
    expect(screen.getByText('Raj Mart')).toBeInTheDocument();
  });

  it('filters journal numbers from the table header', async () => {
    render(<JournalEntriesList db={db} setDb={vi.fn()} currentCompany={company} />);
    await screen.findByText('JE-0042');
    await userEvent.click(screen.getByRole('button', { name: 'Sort and filter JV #' }));
    const panel = screen.getByRole('dialog', { name: 'Filter JV #' });
    await userEvent.click(within(panel).getByText('JE-0001'));
    await userEvent.click(within(panel).getByRole('button', { name: /OK/ }));
    await waitFor(() => expect(screen.queryByText('JE-0001')).not.toBeInTheDocument());
    expect(screen.getByText('JE-0042')).toBeInTheDocument();
  });
});
