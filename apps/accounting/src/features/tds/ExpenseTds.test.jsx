import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));

import { ExpenseForm } from '../../App';
import { reconcileExpenseTdsTransactions } from './expenseReconciliation';

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  currency: 'INR',
  state: 'Karnataka',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const EXPENSE = {
  id: 7,
  companyId: 1,
  number: 'EXP-7',
  date: '2026-09-29',
  dueDate: '2026-09-29',
  vendorId: 9,
  lines: [{ ledgerId: 201, amount: 250000, gstRate: 0, description: '' }],
  subtotal: 250000,
  total: 250000,
  tdsLedgerId: 101,
  tdsRate: 10,
  tdsBaseAmount: 250000,
  tdsAmount: 25000,
  status: 'Unpaid',
};

const initialDb = {
  companies: [COMPANY],
  vendors: [{ id: 9, companyId: 1, name: 'Consultant', displayName: 'Consultant', pan: 'AABCU9603R' }],
  customers: [],
  expenses: [EXPENSE],
  accountTypes: [],
  accountGroups: [
    { id: 11, companyId: 1, name: 'TDS Payable' },
    { id: 12, companyId: 1, name: 'Indirect Expenses', groupCategory: 'Expense' },
  ],
  chartOfAccounts: [
    { id: 101, companyId: 1, name: 'TDS 194J - Professional', groupId: 11, tdsSection: '194J(b)', tdsSide: 'PAYABLE' },
    { id: 201, companyId: 1, name: 'Professional fees', groupId: 12, tdsApplicable: true },
  ],
  tdsTransactions: [],
  fyLocks: [],
  costCenters: [],
};

const Host = ({ onSaved }) => {
  const [db, setDb] = useState(initialDb);
  return (
    <ExpenseForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved(value);
        setDb(value);
      }}
      currentCompany={COMPANY}
      openModal={() => {}}
      onClose={() => {}}
      initialData={EXPENSE}
    />
  );
};

describe('expense TDS compliance wiring', () => {
  it('writes the deducted expense into the normalized TDS register', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<Host onSaved={onSaved} />);

    expect(screen.getByLabelText('TDS amount')).toHaveTextContent('25,000');
    await user.click(screen.getByRole('button', { name: 'Update Expense' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = onSaved.mock.calls.at(-1)[0];
    expect(saved.tdsTransactions).toHaveLength(1);
    expect(saved.tdsTransactions[0]).toMatchObject({
      sourceType: 'expense',
      sourceId: 7,
      sourceNumber: 'EXP-7',
      partyId: 9,
      side: 'PAYABLE',
      sectionCode: '194J(b)',
      baseAmount: 250000,
      rate: 10,
      tdsAmount: 25000,
      status: 'Posted',
    });
  });

  it('backfills a deducted expense that arrived without a compliance event', () => {
    const repaired = reconcileExpenseTdsTransactions(initialDb, COMPANY);
    expect(repaired.tdsTransactions).toHaveLength(1);
    expect(repaired.tdsTransactions[0]).toMatchObject({
      sourceType: 'expense',
      sourceId: 7,
      tdsAmount: 25000,
      status: 'Posted',
    });
  });
});
