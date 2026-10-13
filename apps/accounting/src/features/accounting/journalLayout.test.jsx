import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/utils/journalSync', () => ({ reverseJournalOnLedger: vi.fn(async () => ({ reversed: true })) }));

import JournalEntriesList from './JournalEntriesList';

const COMPANY = { id: 1, name: 'Neev Steels', state: 'Karnataka' };

const db = {
  companies: [COMPANY],
  chartOfAccounts: [
    { id: 501, companyId: 1, name: 'Rent', type: 'Expense' },
    { id: 502, companyId: 1, name: 'HDFC Current A/c', type: 'Asset' },
  ],
  journalEntries: [
    { id: 1, companyId: 1, number: 'JV/2026/001', date: '2026-09-02', narration: 'September rent', totalDebit: 25000, totalCredit: 25000, backendEntryId: 'srv-1', lines: [{}, {}] },
    { id: 2, companyId: 1, number: 'JV/2026/002', date: '2026-09-04', narration: 'Depreciation', totalDebit: 18000, totalCredit: 18000, lines: [{}, {}] },
    { id: 3, companyId: 1, number: 'JV/2026/003', date: '2026-09-05', narration: 'Taken back', totalDebit: 4000, totalCredit: 4000, status: 'REVERSED', backendEntryId: 'srv-3', lines: [{}] },
    { id: 9, companyId: 2, number: 'OTHER/1', date: '2026-09-05', narration: 'Another company', totalDebit: 999, totalCredit: 999, lines: [{}] },
  ],
  invoices: [], bills: [], payments: [], customers: [], vendors: [], items: [], uoms: [], gstRates: [],
};

const noop = () => {};
const view = () => render(<JournalEntriesList db={db} setDb={noop} currentCompany={COMPANY} onNewJournal={noop} onEditJournal={noop} />);

/*
 * The journal list, on the layout every other list follows.
 *
 * It was a bare heading, one button and a filter band — no figures, and the
 * status was a column you could filter but not see the shape of. On a screen
 * whose whole subject is whether the books balance, that is the wrong thing to
 * leave out.
 */
describe('Journal Entries, laid out like every other list', () => {
  it('names itself and puts search in the header', () => {
    view();
    expect(screen.getByRole('heading', { name: /Journal Entries/i })).toBeTruthy();
    expect(screen.getByLabelText(/Search journal entries/i)).toBeTruthy();
  });

  it('carries five figures across the top', () => {
    view();
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('does not render the journal status selection strip', () => {
    view();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('JV/2026/001')).toBeTruthy();
    expect(screen.getByText('JV/2026/002')).toBeTruthy();
    expect(screen.getByText('JV/2026/003')).toBeTruthy();
  });

  it('keeps export behind More, with one primary', () => {
    view();
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
    const primaries = screen.getAllByRole('button', { name: /New Entry/i });
    expect(primaries).toHaveLength(1);
    expect(primaries[0].className).toMatch(/ui-btn-primary/);
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = view();
    const card = container.querySelector('table.ui-table').closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});

describe('what the journal list says about the book', () => {
  it('leaves a reversed entry out of the posted value', () => {
    // A reversal is undone, not posted: counting it would say the books moved
    // by 47,000 when they moved by 43,000.
    view();
    const summary = screen.getByRole('region', { name: /Summary/i });
    const posted = [...summary.children].find((c) => c.textContent.includes('Posted value'));
    expect(posted.textContent).toMatch(/43,000/);
  });

  it('offers reverse, not delete, for an entry that reached the ledger', () => {
    view();
    const posted = screen.getByText('JV/2026/001').closest('tr');
    expect(within(posted).getByRole('button', { name: /Reverse/i })).toBeTruthy();

    // One that never posted is only in this browser, so it can simply go.
    const local = screen.getByText('JV/2026/002').closest('tr');
    expect(within(local).getByRole('button', { name: /Delete/i })).toBeTruthy();
  });

  it('gives a reversed entry nothing left to press', () => {
    view();
    const row = screen.getByText('JV/2026/003').closest('tr');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('never shows another company’s entries', () => {
    view();
    expect(screen.queryByText('OTHER/1')).toBeNull();
  });
});
