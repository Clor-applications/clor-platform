import { useEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => true }) }));
const reconcilePayment = vi.fn(async () => ({}));
vi.mock('@ui/api/payments', () => ({ reconcilePayment: (...a) => reconcilePayment(...a) }));

import BankReconciliation from './BankReconciliation';

/**
 * Reconciliation records the bank's date and a person's confirmation.
 *
 * The two dates are different facts: Transaction Date is the book's and is
 * never overwritten; Bank Date starts equal to it and is edited where the
 * statement disagrees. Nothing is final until Submit — Auto Reconcile and
 * the bulk bar only stage drafts.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

const db0 = {
  companies: [COMPANY],
  accountGroups: [{ id: 21, companyId: 1, name: 'Bank Accounts', parentGroupId: null }],
  accountTypes: [],
  chartOfAccounts: [
    { id: 502, companyId: 1, name: 'HDFC Bank - Current A/c', groupId: 21, serverLedgerAccountId: 'srv-hdfc', openingBalance: 100000, openingBalanceType: 'Dr' },
  ],
  payments: [
    { id: 1, companyId: 1, date: '2026-09-01', voucherType: 'payment', ledgerAccountId: 'srv-hdfc', amount: 100000, partyName: 'ABC Traders', number: 'PAY-0012', backendPaymentId: 'srv-pay-1' },
    { id: 2, companyId: 1, date: '2026-09-02', voucherType: 'receipt', ledgerAccountId: 'srv-hdfc', amount: 50000, partyName: 'XYZ Ltd', number: 'RCPT-0045' },
    { id: 3, companyId: 1, date: '2026-09-05', voucherType: 'receipt', ledgerAccountId: 'srv-hdfc', amount: 35000, partyName: 'UPI Collection', number: 'RCPT-0046', reconciled: true, bankDate: '2026-09-05' },
  ],
  journalEntries: [],
  bankTransactions: [],
  invoices: [], bills: [], expenses: [],
};

const latest = { db: db0 };
const Host = () => {
  const [db, setDb] = useState(db0);
  useEffect(() => {
    latest.db = db;
  }, [db]);
  return (
    <BankReconciliation
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={COMPANY}
      onImportStatement={() => {}}
    />
  );
};

const pickAccount = async (user) => {
  await user.click(screen.getByRole('combobox', { name: 'Account' }));
  await user.click(await screen.findByRole('option', { name: /HDFC Bank/ }));
};

describe('the shape of the screen', () => {
  beforeEach(() => {
    reconcilePayment.mockClear();
    localStorage.clear();
  });

  it('asks for the account first and shows the four figures', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByText('Pick an account')).toBeInTheDocument();

    await pickAccount(user);
    expect(screen.getByText('Book balance')).toBeInTheDocument();
    expect(screen.getByText('Bank statement balance')).toBeInTheDocument();
    expect(screen.getByText('Difference')).toBeInTheDocument();
    expect(screen.getByText('Unreconciled transactions')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  /* The difference IS the net of the unreconciled rows: −100000 + 50000. */
  it('derives the difference from the unreconciled rows alone', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    const card = screen.getByText('Difference').parentElement;
    expect(within(card).getByText(/-\s?₹\s?50,000\.00/)).toBeInTheDocument();
  });

  it('keeps the spec\'s columns, Date first, and Import Statement in the controls row', async () => {
    const user = userEvent.setup();
    render(<Host />);
    /* Present before an account is picked — it sits with Account and Period,
       not behind them. */
    expect(screen.getByRole('button', { name: /Import Statement/ })).toBeInTheDocument();

    await pickAccount(user);
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(heads).toEqual(['', 'Date', 'Description', 'Voucher No.', 'Type', 'Amount (₹)', 'Transaction Date', 'Bank Date', 'Status']);
  });

  it('shows both dates, and only the bank date is editable', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    /* Unreconciled row: bank date is an input seeded with the txn date. */
    expect(screen.getByLabelText('Bank date for PAY-0012')).toHaveValue('2026-09-01');
    /* Reconciled row: plain text, no input. */
    expect(screen.queryByLabelText('Bank date for RCPT-0046')).toBeNull();
    /* No control edits the transaction date anywhere. */
    expect(screen.queryByLabelText(/Transaction date for/)).toBeNull();
  });

  it('does not offer an uncategorised statement row for reconciliation', async () => {
    const user = userEvent.setup();
    const withUncategorised = {
      ...db0,
      bankTransactions: [{
        id: 90,
        companyId: 1,
        cashBankAccountId: 502,
        date: '2026-09-03',
        direction: 'OUT',
        amount: 1250,
        narration: 'Unknown bank debit',
        imported: true,
      }],
    };
    render(
      <BankReconciliation
        db={withUncategorised}
        setDb={() => {}}
        currentCompany={COMPANY}
        onImportStatement={() => {}}
      />
    );
    await pickAccount(user);
    expect(screen.queryByText('Unknown bank debit')).toBeNull();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });
});

describe('staging and submitting', () => {
  beforeEach(() => {
    reconcilePayment.mockClear();
    localStorage.clear();
  });

  it('marks nothing until Submit', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    await user.click(screen.getByLabelText('Select PAY-0012'));
    fireEvent.change(screen.getByLabelText('Bank date for PAY-0012'), { target: { value: '2026-09-03' } });

    expect(latest.db.payments.find((p) => p.id === 1).reconciled).toBeUndefined();
  });

  it('submit records the bank date and the confirmation, transaction date untouched', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    await user.click(screen.getByLabelText('Select PAY-0012'));
    fireEvent.change(screen.getByLabelText('Bank date for PAY-0012'), { target: { value: '2026-09-03' } });
    await user.click(screen.getByRole('button', { name: /Submit 1 as reconciled/ }));

    await waitFor(() => expect(latest.db.payments.find((p) => p.id === 1).reconciled).toBe(true));
    const row = latest.db.payments.find((p) => p.id === 1);
    expect(row.bankDate).toBe('2026-09-03');
    expect(row.date).toBe('2026-09-01');
  });

  it('tells the server about payments it knows, and survives the ones it does not', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    await user.click(screen.getByLabelText('Select PAY-0012'));
    await user.click(screen.getByLabelText('Select RCPT-0045'));
    await user.click(screen.getByRole('button', { name: /Submit 2 as reconciled/ }));

    await waitFor(() => expect(latest.db.payments.find((p) => p.id === 2).reconciled).toBe(true));
    /* Only PAY-0012 carries a backendPaymentId. */
    expect(reconcilePayment).toHaveBeenCalledTimes(1);
    expect(reconcilePayment).toHaveBeenCalledWith('srv-pay-1', { reconciled: true, bankDate: '2026-09-01' });
  });

  /* The spec's flow: Select → Auto Reconcile → Review → Submit. Staging
     touches only the selection, and a staged date is still the user's to
     change before anything is final. */
  it('Auto Reconcile stages only the selected rows, and the date stays editable', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    /* Drift PAY-0012's draft away, select only RCPT-0045, auto reconcile. */
    fireEvent.change(screen.getByLabelText('Bank date for PAY-0012'), { target: { value: '2026-09-20' } });
    await user.click(screen.getByLabelText('Select RCPT-0045'));
    await user.click(screen.getByRole('button', { name: /Auto Reconcile \(Same Date\)/ }));

    /* Only the selected row was staged to its transaction date; the other
       row's draft was not touched. */
    expect(screen.getByLabelText('Bank date for RCPT-0045')).toHaveValue('2026-09-02');
    expect(screen.getByLabelText('Bank date for PAY-0012')).toHaveValue('2026-09-20');
    expect(screen.getByText('1 transaction(s) selected')).toBeInTheDocument();
    expect(latest.db.payments.find((p) => p.id === 2).reconciled).toBeUndefined();

    /* Review: the staged date can still be changed before Submit... */
    fireEvent.change(screen.getByLabelText('Bank date for RCPT-0045'), { target: { value: '2026-09-04' } });
    await user.click(screen.getByRole('button', { name: /Submit 1 as reconciled/ }));

    /* ...and Submit is what makes it Reconciled, at the reviewed date. */
    await waitFor(() => expect(latest.db.payments.find((p) => p.id === 2).reconciled).toBe(true));
    expect(latest.db.payments.find((p) => p.id === 2).bankDate).toBe('2026-09-04');
    /* The unselected row was never touched. */
    expect(latest.db.payments.find((p) => p.id === 1).reconciled).toBeUndefined();
  });

  /* Step 7 of the bulk flow: Submit validates before it confirms. */
  it('refuses to submit a row whose bank date was cleared', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    await user.click(screen.getByLabelText('Select PAY-0012'));
    fireEvent.change(screen.getByLabelText('Bank date for PAY-0012'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: /Submit 1 as reconciled/ }));

    /* Nothing was written — the boundary held. */
    expect(latest.db.payments.find((p) => p.id === 1).reconciled).toBeUndefined();
    expect(reconcilePayment).not.toHaveBeenCalled();
  });

  it('Auto Reconcile stages every unreconciled row without finalizing', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    await user.click(screen.getByRole('button', { name: /Auto Reconcile \(Same Date\)/ }));

    /* Staged: both rows selected, nothing written. */
    expect(screen.getByText('2 transaction(s) selected')).toBeInTheDocument();
    expect(latest.db.payments.find((p) => p.id === 1).reconciled).toBeUndefined();

    await user.click(screen.getByRole('button', { name: /Submit 2 as reconciled/ }));
    await waitFor(() => expect(latest.db.payments.find((p) => p.id === 2).reconciled).toBe(true));
  });

  /*
   * The spec's own example: the user moves the bank date; the accounting
   * date must not move, the status must flip only at Submit, and the change
   * must leave an audit entry saying from what, to what, by whom.
   */
  it('a changed bank date is audited, and the transaction date survives it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('userEmail', 'suresh@neev.one');
    render(<Host />);
    await pickAccount(user);

    await user.click(screen.getByLabelText('Select PAY-0012'));
    fireEvent.change(screen.getByLabelText('Bank date for PAY-0012'), { target: { value: '2026-09-15' } });

    /* Still a draft: unreconciled, nothing audited. */
    expect(latest.db.bankDateAudit).toBeUndefined();
    await user.click(screen.getByRole('button', { name: /Submit 1 as reconciled/ }));

    await waitFor(() => expect(latest.db.payments.find((p) => p.id === 1).reconciled).toBe(true));
    const row = latest.db.payments.find((p) => p.id === 1);
    expect(row.bankDate).toBe('2026-09-15');
    expect(row.date).toBe('2026-09-01');

    const audit = latest.db.bankDateAudit;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      kind: 'payment',
      voucherNo: 'PAY-0012',
      transactionDate: '2026-09-01',
      previousBankDate: '2026-09-01',
      bankDate: '2026-09-15',
      action: 'RECONCILED',
      by: 'suresh@neev.one',
    });

    /* The reconciled row says both dates out loud. */
    expect(screen.getByText(/\(txn 01\/09\/2026\)/)).toBeInTheDocument();
  });

  it('the bulk bar resets bank dates to transaction dates for the selection', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickAccount(user);

    fireEvent.change(screen.getByLabelText('Bank date for PAY-0012'), { target: { value: '2026-09-09' } });
    await user.click(screen.getByLabelText('Select PAY-0012'));
    await user.click(screen.getByRole('button', { name: /Bulk Reconcile/ }));

    expect(screen.getByLabelText('Bank date for PAY-0012')).toHaveValue('2026-09-01');
  });
});
