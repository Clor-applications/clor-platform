import { useEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/utils/bankBookSync', () => ({
  pushBankTransaction: vi.fn(async () => ({})),
  removeBankTransaction: vi.fn(async () => ({})),
}));

import CashBankModule from './CashBankModule';

/**
 * A bank statement, imported as evidence.
 *
 * Imported rows are the BANK's side of events. They must not post to the
 * ledger, mint a voucher, or move a balance until somebody allocates them —
 * and once in, what the bank said (date, amount, direction, narration,
 * reference) is immutable. Allocation is the one thing an edit may change,
 * and it is stored beside the evidence, never over it.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

const db0 = {
  companies: [COMPANY],
  accountGroups: [
    { id: 20, companyId: 1, name: 'Cash-in-Hand', parentGroupId: null },
    { id: 21, companyId: 1, name: 'Bank Accounts', parentGroupId: null },
  ],
  accountTypes: [],
  chartOfAccounts: [
    { id: 502, companyId: 1, name: 'HDFC Current A/c', type: 'Asset', groupId: 21 },
    { id: 610, companyId: 1, name: 'Bank Charges', type: 'Expense' },
  ],
  bankTransactions: [],
  journalEntries: [],
  customers: [], vendors: [], invoices: [], bills: [], payments: [], items: [], uoms: [], gstRates: [],
};

const STATEMENT = [
  'Date,Payments,Receipts,Narration,Ref No / UTR',
  '01-09-2026,10000,,GST Paid,UTR900111',
  '02-09-2026,,12000,Customer NEFT,UTR900222',
].join('\n');

/* The test reads state through a box rather than reassigning from render —
   the compiler is right that a render must not write outer variables. */
const latest = { db: db0 };
const Host = () => {
  const [db, setDb] = useState(db0);
  useEffect(() => {
    latest.db = db;
  }, [db]);
  return (
    <CashBankModule
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={COMPANY}
      openModal={() => {}}
      openLedgerCreate={() => {}}
      openTxnLedgerCreate={() => {}}
    />
  );
};

const importStatement = async (user) => {
  /* Paste lives in the header's More menu, beside Upload. */
  await user.click(screen.getByRole('button', { name: /More/i }));
  await user.click(await screen.findByRole('menuitem', { name: /Paste statement rows/i }));
  const box = await screen.findByLabelText('Statement rows');
  fireEvent.change(box, { target: { value: STATEMENT } });
  await user.click(screen.getByRole('button', { name: 'Import rows' }));
};

describe('what an import writes', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the payments and receipts columns apart, with the reference', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await importStatement(user);

    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));
    const [out, into] = latest.db.bankTransactions;
    expect(out).toMatchObject({ direction: 'OUT', amount: 10000, reference: 'UTR900111' });
    expect(into).toMatchObject({ direction: 'IN', amount: 12000, reference: 'UTR900222' });
  });

  it('stamps every row with its batch and source line', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await importStatement(user);

    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));
    const [a, b] = latest.db.bankTransactions;
    expect(a.imported).toBe(true);
    expect(a.importBatchId).toBeTruthy();
    expect(a.importBatchId).toBe(b.importBatchId);
    expect([a.sourceRow, b.sourceRow]).toEqual([1, 2]);
  });

  /* The critical architecture line: a statement import is not an accounting
     event. Nothing posts until an allocation says what the money was. */
  it('creates no journal, no payment and no ledger movement', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await importStatement(user);

    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));
    expect(latest.db.journalEntries).toHaveLength(0);
    expect(latest.db.payments).toHaveLength(0);
    expect(latest.db.bankTransactions.every((t) => t.ledgerId === undefined || t.ledgerId === null)).toBe(true);
  });

  it('allocates a mapped ledger and creates its balanced journal during import', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const mapped = [
      'Cash / bank account,Date,Payments,Receipts,Narration,Ref No / UTR,Ledger Name',
      'HDFC Current A/c,03-09-2026,450,,,UTR900333,Bank Charges',
    ].join('\n');

    await user.click(screen.getByRole('button', { name: /More/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Paste statement rows/i }));
    fireEvent.change(await screen.findByLabelText('Statement rows'), { target: { value: mapped } });
    await user.click(screen.getByRole('button', { name: 'Import rows' }));

    await waitFor(() => expect(latest.db.bankTransactions).toHaveLength(1));
    expect(latest.db.bankTransactions[0]).toMatchObject({ ledgerId: 610, allocationStatus: 'Allocated' });
    expect(latest.db.journalEntries).toHaveLength(1);
    expect(latest.db.journalEntries[0]).toMatchObject({
      totalDebit: 450,
      totalCredit: 450,
      sourceBankTransactionId: latest.db.bankTransactions[0].id,
    });
  });
});

describe('importing the same statement twice', () => {
  beforeEach(() => localStorage.clear());

  /* Nothing suspect goes in or out silently: the second import stops at a
     review, duplicates unticked, the verdict and the collision both shown. */
  it('stops at a review naming each duplicate', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await importStatement(user);
    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));

    await importStatement(user);
    expect(await screen.findByText('Review before importing')).toBeInTheDocument();
    expect(screen.getAllByText('Duplicate')).toHaveLength(2);
    expect(screen.getAllByText(/already in the book/)).toHaveLength(2);
    /* Nothing imported yet. */
    expect(latest.db.bankTransactions).toHaveLength(2);
  });

  it('imports only what was ticked', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await importStatement(user);
    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));

    await importStatement(user);
    await screen.findByText('Review before importing');
    /* Duplicates start unticked; tick one deliberately. */
    await user.click(screen.getByRole('checkbox', { name: 'Import row 1' }));
    await user.click(screen.getByRole('button', { name: /Import 1 row/ }));

    await waitFor(() => expect(latest.db.bankTransactions).toHaveLength(3));
  });

  it('flags a same-day same-amount row as possible, ticked by default', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await importStatement(user);
    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));

    /* Same day and amount as the GST payment, different narration and ref. */
    const NEAR = [
      'Date,Payments,Receipts,Narration,Ref No / UTR',
      '01-09-2026,10000,,Vendor advance,UTR777000',
    ].join('\n');
    await user.click(screen.getByRole('button', { name: /More/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Paste statement rows/i }));
    fireEvent.change(await screen.findByLabelText('Statement rows'), { target: { value: NEAR } });
    await user.click(screen.getByRole('button', { name: 'Import rows' }));

    expect(await screen.findByText('Review before importing')).toBeInTheDocument();
    expect(screen.getByText('Possible duplicate')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Import row 1' })).toBeChecked();
  });
});

describe('allocating an imported line', () => {
  beforeEach(() => localStorage.clear());

  const openAllocate = async (user) => {
    await importStatement(user);
    await waitFor(() => expect((latest.db.bankTransactions || []).length).toBe(2));
    /* Description and narration both print the text; anchor on the row. */
    const row = screen.getAllByText('GST Paid').map((el) => el.closest('tr')).find(Boolean);
    await user.click(within(row).getByTitle('Actions'));
    await user.click(await screen.findByRole('button', { name: /Allocate \/ split/ }));
    return screen.findByText('Allocate bank transaction');
  };

  it('shows the parent read-only with bank, allocated and difference', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openAllocate(user);

    expect(screen.getByText('Bank amount')).toBeInTheDocument();
    expect(screen.getByText('Allocated')).toBeInTheDocument();
    expect(screen.getByText('Difference')).toBeInTheDocument();
    /* Nothing on the dialog edits the parent's amount. */
    expect(screen.queryByDisplayValue('10000')).toBeNull();
  });

  it('refuses to post a partial split, saves it instead', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openAllocate(user);

    await user.selectOptions(screen.getByLabelText('Ledger'), '610');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '8000' } });

    expect(screen.getByRole('button', { name: /Allocate & post/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect((latest.db.bankAllocations || []).length).toBe(1));
    expect(latest.db.bankAllocations[0]).toMatchObject({ ledgerId: '610', amount: 8000, journalEntryId: null });
    expect(latest.db.journalEntries || []).toHaveLength(0);
  });

  it('posts one balanced journal when the difference reaches zero', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openAllocate(user);

    await user.selectOptions(screen.getByLabelText('Ledger'), '610');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
    await user.click(screen.getByRole('button', { name: /Allocate & post/ }));

    await waitFor(() => expect((latest.db.journalEntries || []).length).toBe(1));
    const journal = latest.db.journalEntries[0];
    expect(journal.totalDebit).toBe(10000);
    expect(journal.totalCredit).toBe(10000);
    expect(journal.sourceBankTransactionId).toBeTruthy();
    /* The child rows carry the accounting linkage. */
    expect(latest.db.bankAllocations[0].journalEntryId).toBe(journal.id);
    /* And the parent's bank-side facts are exactly as imported. */
    const parent = latest.db.bankTransactions.find((t) => String(t.id) === String(journal.sourceBankTransactionId));
    expect(parent.amount).toBe(10000);
    expect(parent.imported).toBe(true);
  });
});
