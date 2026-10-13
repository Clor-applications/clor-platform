import { useEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postJournalToLedger = vi.fn(async () => ({}));
vi.mock('@ui/utils/journalSync', () => ({
  postJournalToLedger: (...a) => postJournalToLedger(...a),
}));
vi.mock('@ui/api/purchaseDocs', () => ({ hasApiSession: () => false }));
vi.mock('@ui/api/payments', () => ({
  createPayment: vi.fn(async () => ({})),
  reconcilePayment: vi.fn(async () => ({})),
}));
vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => true }) }));

import AllocationDialog from './AllocationDialog';
import BankReconciliation from './BankReconciliation';
import { cashBankTransactions } from './transactions';

/**
 * The complete Cash & Bank flow, walked once, end to end:
 *
 *   Import → bank-side rows (no accounting) → allocate through the engine →
 *   journal → reconciliation → bank date → submit → Reconciled.
 *
 * Each stage has its own file of tests; this one proves the SEAMS — that the
 * row the import writes is the row allocation reads, and the book the
 * allocation posts is the book reconciliation confirms — with no alternate
 * path anywhere in between.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

/* What the statement import writes: bank-side facts, immutable, no GL. */
const IMPORTED = {
  id: 51,
  companyId: 1,
  cashBankAccountId: '502',
  date: '2026-09-12',
  direction: 'OUT',
  amount: 10000,
  description: 'NEFT CHG 4411',
  reference: 'UTR-4411',
  imported: true,
  importBatchId: 'imp-1-1757700000000',
  sourceRow: 3,
};

const db0 = {
  companies: [COMPANY],
  accountGroups: [{ id: 21, companyId: 1, name: 'Bank Accounts', parentGroupId: null }],
  chartOfAccounts: [
    { id: 502, companyId: 1, name: 'HDFC Bank', groupId: 21, openingBalance: 50000, openingBalanceType: 'Dr' },
    { id: 620, companyId: 1, name: 'Bank Charges', groupId: 99 },
  ],
  vendors: [],
  customers: [],
  bills: [],
  expenses: [],
  invoices: [],
  debitNotes: [],
  payments: [],
  journalEntries: [],
  bankTransactions: [IMPORTED],
  bankAllocations: [],
};

const latest = { db: db0 };
const Stage = ({ which, db: initialDb }) => {
  const [db, setDb] = useState(initialDb);
  useEffect(() => {
    latest.db = db;
  }, [db]);
  const shared = {
    db,
    setDb: (next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next)),
    currentCompany: COMPANY,
  };
  return which === 'allocate' ? (
    <AllocationDialog {...shared} txn={IMPORTED} onClose={() => {}} />
  ) : (
    <BankReconciliation {...shared} onImportStatement={() => {}} />
  );
};

describe('the whole flow, one seam at a time', () => {
  beforeEach(() => {
    postJournalToLedger.mockClear();
    localStorage.clear();
    latest.db = db0;
  });

  it('import → allocate → journal → reconcile → Reconciled', async () => {
    const user = userEvent.setup();

    /* 1. The imported row exists as bank-side data only: no journal, no
       voucher, status Unallocated. */
    expect(db0.journalEntries).toHaveLength(0);
    expect(db0.payments).toHaveLength(0);
    const [row0] = cashBankTransactions(db0, 1, { accountId: '502' });
    expect(row0).toMatchObject({ kind: 'statement', status: 'Uncategorised', amount: 10000 });

    /* 2. Allocation: the whole line is bank charges. Posting writes ONE
       journal through the engine — nothing else moves. */
    const alloc = render(<Stage which="allocate" db={db0} />);
    await user.selectOptions(screen.getByLabelText('Ledger'), '620');
    await user.type(screen.getByLabelText('Amount'), '10000');
    await user.click(screen.getByRole('button', { name: /Allocate & post/ }));
    await waitFor(() => expect(latest.db.bankAllocations).toHaveLength(1));

    const afterAllocation = latest.db;
    expect(postJournalToLedger).toHaveBeenCalledTimes(1);
    const jv = afterAllocation.journalEntries.find((j) => j.sourceBankTransactionId === 51);
    expect(jv.totalDebit).toBe(10000);

    /* The imported row's bank-side facts did not move — only the note that
       its accounting now exists. */
    const parent = afterAllocation.bankTransactions.find((t) => t.id === 51);
    expect(parent).toMatchObject({ amount: 10000, date: '2026-09-12', reference: 'UTR-4411', imported: true });
    expect(parent.allocationJournalId).toBe(jv.id);
    alloc.unmount();

    /* 3. Reconciliation over the same book: the row appears, bank date
       defaults to the transaction date, and is moved to when the bank saw
       it. */
    render(<Stage which="reconcile" db={afterAllocation} />);
    await user.click(screen.getByRole('combobox', { name: 'Account' }));
    await user.click(await screen.findByRole('option', { name: /HDFC Bank/ }));

    const dateInput = screen.getByLabelText(/Bank date for/);
    expect(dateInput).toHaveValue('2026-09-12');
    fireEvent.change(dateInput, { target: { value: '2026-09-15' } });
    await user.click(screen.getByRole('checkbox', { name: 'Select NEFT CHG 4411' }));

    /* Nothing is final before Submit. */
    expect(latest.db.bankTransactions.find((t) => t.id === 51).reconciled).toBeUndefined();

    await user.click(screen.getByRole('button', { name: /Submit 1 as reconciled/ }));
    await waitFor(() => expect(latest.db.bankTransactions.find((t) => t.id === 51).reconciled).toBe(true));

    /* 4. The end state: reconciled at the bank's date, the transaction date
       untouched, the change audited. */
    const done = latest.db.bankTransactions.find((t) => t.id === 51);
    expect(done.bankDate).toBe('2026-09-15');
    expect(done.date).toBe('2026-09-12');
    expect(latest.db.bankDateAudit).toHaveLength(1);
    expect(latest.db.bankDateAudit[0]).toMatchObject({
      kind: 'statement',
      transactionDate: '2026-09-12',
      bankDate: '2026-09-15',
      action: 'RECONCILED',
    });
  });

  /* The one sanctioned way past a residual difference: a CONFIGURED
     adjustment ledger, resolved as a visible row — never a silent write-off,
     and never available without the configuration. */
  it('a residual difference resolves only through the configured adjustment ledger', async () => {
    const user = userEvent.setup();

    /* Unconfigured: no shortcut is offered. */
    const plain = render(<Stage which="allocate" db={db0} />);
    await user.selectOptions(screen.getByLabelText('Ledger'), '620');
    await user.type(screen.getByLabelText('Amount'), '8000');
    expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Allocate & post/ })).toBeDisabled();
    plain.unmount();

    /* Configured: the ₹2,000 residual lands on the named ledger as a row of
       its own, and only then does the post unlock. */
    const configured = { ...COMPANY, profile: { cashBank: { adjustmentLedgerId: '620' } } };
    const Host = () => {
      const [db, setDb] = useState(db0);
      useEffect(() => {
        latest.db = db;
      }, [db]);
      return (
        <AllocationDialog
          db={db}
          setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
          currentCompany={configured}
          txn={IMPORTED}
          onClose={() => {}}
        />
      );
    };
    render(<Host />);
    await user.selectOptions(screen.getByLabelText('Ledger'), '620');
    await user.type(screen.getByLabelText('Amount'), '8000');

    await user.click(screen.getByRole('button', { name: /Resolve .*via Bank Charges/ }));
    expect(screen.getByRole('button', { name: /Allocate & post/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /Allocate & post/ }));
    await waitFor(() => expect(latest.db.bankAllocations).toHaveLength(2));
    const amounts = latest.db.bankAllocations.map((a) => a.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([2000, 8000]);
  });
});
