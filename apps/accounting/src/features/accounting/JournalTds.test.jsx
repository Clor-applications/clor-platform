import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/utils/journalSync', () => ({
  postJournalToLedger: vi.fn(async () => ({})),
  reverseJournalOnLedger: vi.fn(async () => ({ reversed: true })),
}));

import { JournalEntryForm } from '../../App';

/**
 * A journal that moves TDS is a TDS event.
 *
 * Adjustments happen — a deduction made at the wrong rate, a short deposit
 * squared off, an opening balance brought in — and they are written as
 * journals. Until now they moved the ledger without ever reaching the
 * register, so the TDS Payable balance and the return disagreed and the
 * difference was invisible until somebody totalled both by hand.
 */

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const db0 = {
  companies: [COMPANY],
  accountGroups: [
    { id: 11, companyId: 1, name: 'TDS Payable', parentGroupId: null },
    { id: 12, companyId: 1, name: 'Indirect Expenses', parentGroupId: null },
  ],
  chartOfAccounts: [
    { id: 101, companyId: 1, name: 'TDS Payable - Contractor', groupId: 11, tdsNatureCode: CONTRACTOR },
    { id: 201, companyId: 1, name: 'Rounding Off', groupId: 12 },
  ],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co', pan: 'AABCU9603R' }],
  customers: [],
  journalEntries: [],
  tdsTransactions: [],
  fyLocks: [],
};

const Host = ({ onSaved = () => {} }) => {
  const [db, setDb] = useState(db0);
  return (
    <JournalEntryForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved(value);
        setDb(value);
      }}
      currentCompany={COMPANY}
      openModal={() => {}}
      onClose={() => {}}
    />
  );
};

/**
 * Credit the TDS ledger, debit the expense — a deduction squared off. Pass
 * `tdsDebit` to write it the other way round, which is a reversal.
 */
const pickAccount = async (user, index, name) => {
  const fields = screen.getAllByRole('combobox');
  await user.click(fields[index]);
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
};

const fillLines = async (user, { tdsCredit = '500', tdsDebit = '' } = {}) => {
  await pickAccount(user, 0, 'TDS Payable - Contractor');
  await pickAccount(user, 1, 'Rounding Off');

  const numbers = [...document.querySelectorAll('input[type="number"]')];
  /* Two per line: debit then credit. */
  if (tdsDebit) {
    fireEvent.change(numbers[0], { target: { value: tdsDebit } });
    fireEvent.change(numbers[3], { target: { value: tdsDebit } });
  } else {
    fireEvent.change(numbers[1], { target: { value: tdsCredit } });
    fireEvent.change(numbers[2], { target: { value: tdsCredit } });
  }
};

describe('a journal that touches a TDS ledger', () => {
  beforeEach(() => localStorage.clear());

  it('asks who the adjustment belongs to, and only then', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.queryByText('TDS adjustment')).toBeNull();

    await fillLines(user);
    expect(await screen.findByText('TDS adjustment')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor')).toBeInTheDocument();
  });

  it('names the nature and the amount it will report', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await fillLines(user);

    expect(await screen.findByText(/Contractor.*₹500\.00/)).toBeInTheDocument();
  });

  it('records the adjustment against the party that was named', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);
    await fillLines(user);
    await user.selectOptions(screen.getByLabelText('Vendor'), '9');
    await user.click(screen.getByRole('button', { name: /Create Entry/ }));

    await waitFor(() => expect((saved?.tdsTransactions || []).length).toBe(1));
    expect(saved.tdsTransactions.at(-1)).toMatchObject({
      sourceType: 'journal',
      side: 'PAYABLE',
      partyId: 9,
      panSnapshot: 'AABCU9603R',
      natureCode: CONTRACTOR,
      tdsAmount: 500,
      ledgerId: '101',
    });
  });

  /* A row that cannot be filed is worse in the register than absent from it. */
  it('posts the journal and reports nothing when no party is named', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);
    await fillLines(user);
    await user.click(screen.getByRole('button', { name: /Create Entry/ }));

    await waitFor(() => expect((saved?.journalEntries || []).length).toBe(1));
    expect(saved.tdsTransactions || []).toHaveLength(0);
  });

  /* Reducing a liability is a reversal, kept as a negative against the same
     nature rather than as a deletion — the audit trail keeps both halves. */
  it('records a debit to the payable ledger as a reversal', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);
    await fillLines(user, { tdsDebit: '500' });
    await user.selectOptions(screen.getByLabelText('Vendor'), '9');
    await user.click(screen.getByRole('button', { name: /Create Entry/ }));

    await waitFor(() => expect((saved?.tdsTransactions || []).length).toBe(1));
    expect(saved.tdsTransactions.at(-1).tdsAmount).toBe(-500);
  });
});
