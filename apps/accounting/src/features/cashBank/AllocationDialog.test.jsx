import { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postJournalToLedger = vi.fn(async () => ({}));
vi.mock('@ui/utils/journalSync', () => ({
  postJournalToLedger: (...a) => postJournalToLedger(...a),
}));
vi.mock('@ui/api/purchaseDocs', () => ({ hasApiSession: () => false }));
vi.mock('@ui/api/payments', () => ({ createPayment: vi.fn(async () => ({})) }));

/*
 * The receipt engine is its own machinery with its own tests; a stub hands
 * back the voucher it would have written. The VENDOR side is deliberately NOT
 * stubbed: settling several vendors from one debit runs inline through the
 * payment service, and that path is what this file proves.
 */
vi.mock('../payments/RecordReceiptForm', () => ({
  default: ({ onSaved }) => (
    <button type="button" onClick={() => onSaved({ id: 66, number: 'RCPT-0066', netCashAmount: 50000 })}>
      engine: settle invoices
    </button>
  ),
}));

import AllocationDialog from './AllocationDialog';

const COMPANY = { id: 1, name: 'Neev Steels' };

/* The use case verbatim: one bank debit of ₹1,00,000. */
const TXN_OUT = {
  id: 31,
  companyId: 1,
  cashBankAccountId: '502',
  direction: 'OUT',
  amount: 100000,
  date: '2026-09-01',
  description: 'NEFT OUT 991',
};

const db0 = {
  companies: [COMPANY],
  chartOfAccounts: [
    { id: 502, companyId: 1, name: 'HDFC Bank' },
    { id: 610, companyId: 1, name: 'Vendor A A/c' },
    { id: 611, companyId: 1, name: 'Vendor B A/c' },
    { id: 620, companyId: 1, name: 'Bank Charges' },
    { id: 410, companyId: 1, name: 'ABC Industries A/c' },
  ],
  vendors: [
    { id: 7, companyId: 1, name: 'Vendor A', accountId: 610 },
    { id: 8, companyId: 1, name: 'Vendor B', accountId: 611 },
  ],
  customers: [{ id: 3, companyId: 1, name: 'ABC Industries', accountId: 410 }],
  bills: [
    { id: 91, companyId: 1, vendorId: 7, number: 'BILL-91', date: '2026-08-01', total: 12000, paidAmount: 0, status: 'Unpaid' },
    { id: 92, companyId: 1, vendorId: 7, number: 'BILL-92', date: '2026-08-10', total: 8000, paidAmount: 0, status: 'Unpaid' },
    { id: 93, companyId: 1, vendorId: 8, number: 'BILL-93', date: '2026-08-05', total: 40000, paidAmount: 0, status: 'Unpaid' },
    /* Another vendor's bill and a draft never enter a queue. */
    { id: 94, companyId: 1, vendorId: 9, number: 'BILL-94', date: '2026-08-06', total: 500, paidAmount: 0, status: 'Unpaid' },
    { id: 95, companyId: 1, vendorId: 7, number: 'BILL-95', date: '2026-08-07', total: 900, paidAmount: 0, status: 'Draft' },
  ],
  expenses: [],
  debitNotes: [],
  payments: [],
  bankTransactions: [TXN_OUT],
  bankAllocations: [],
  journalEntries: [],
};

const latest = { db: db0 };
const Host = ({ txn = TXN_OUT }) => {
  const [db, setDb] = useState(db0);
  useEffect(() => {
    latest.db = db;
  }, [db]);
  return (
    <AllocationDialog
      db={db}
      setDb={(next) => setDb((prev) => (typeof next === 'function' ? next(prev) : next))}
      currentCompany={COMPANY}
      txn={txn}
      onClose={() => {}}
    />
  );
};

const ledgerSelects = () => screen.getAllByLabelText('Ledger');
const amountInputs = () => screen.getAllByLabelText('Amount');

describe('a vendor row opens its bills in place', () => {
  beforeEach(() => {
    postJournalToLedger.mockClear();
    latest.db = db0;
  });

  it('unfolds the outstanding queue inline — no payment form', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.selectOptions(ledgerSelects()[0], '610');
    await user.click(screen.getByRole('button', { name: /Allocate Bills/ }));

    /* Vendor A's two live bills, oldest first; the draft and the other
       vendor's stay out. */
    expect(screen.getByText('BILL-91')).toBeInTheDocument();
    expect(screen.getByText('BILL-92')).toBeInTheDocument();
    expect(screen.queryByText('BILL-93')).toBeNull();
    expect(screen.queryByText('BILL-94')).toBeNull();
    expect(screen.queryByText('BILL-95')).toBeNull();
  });

  it('ticking a bill fills the row amount; part-payment is typed over it', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.selectOptions(ledgerSelects()[0], '610');
    await user.click(screen.getByRole('button', { name: /Allocate Bills/ }));

    await user.click(screen.getByLabelText('Settle BILL-91'));
    expect(amountInputs()[0]).toHaveValue(12000);

    const pay = screen.getByLabelText('Amount against BILL-91');
    await user.clear(pay);
    await user.type(pay, '5000');
    expect(amountInputs()[0]).toHaveValue(5000);
  });

  it('refuses to post while a bill is allocated past its balance', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.selectOptions(ledgerSelects()[0], '610');
    await user.click(screen.getByRole('button', { name: /Allocate Bills/ }));
    await user.click(screen.getByLabelText('Settle BILL-91'));
    const pay = screen.getByLabelText('Amount against BILL-91');
    await user.clear(pay);
    await user.type(pay, '99999');

    expect(screen.getByRole('button', { name: /Allocate & post/ })).toBeDisabled();
    expect(screen.getByText(/BILL-91: allocated more than its balance/)).toBeInTheDocument();
  });
});

describe('one debit, many vendors, one pass', () => {
  beforeEach(() => {
    postJournalToLedger.mockClear();
    latest.db = db0;
  });

  it('settles two vendors and the charges without a single payment form', async () => {
    const user = userEvent.setup();
    render(<Host />);

    /* Vendor A — both bills, ₹20,000. */
    await user.selectOptions(ledgerSelects()[0], '610');
    await user.click(screen.getByRole('button', { name: /Allocate Bills/ }));
    await user.click(screen.getByLabelText('Settle BILL-91'));
    await user.click(screen.getByLabelText('Settle BILL-92'));

    /* Vendor B — part of one bill, ₹15,000. */
    await user.click(screen.getByRole('button', { name: /Add Allocation/ }));
    await user.selectOptions(ledgerSelects()[1], '611');
    await user.click(screen.getAllByRole('button', { name: /Allocate Bills/ })[1]);
    await user.click(screen.getByLabelText('Settle BILL-93'));
    const payB = screen.getByLabelText('Amount against BILL-93');
    await user.clear(payB);
    await user.type(payB, '15000');

    /* Bank charges — a plain ledger row for the remaining ₹65,000. */
    await user.click(screen.getByRole('button', { name: /Add Allocation/ }));
    await user.selectOptions(ledgerSelects()[2], '620');
    await user.type(amountInputs()[2], '65000');

    await user.click(screen.getByRole('button', { name: /Allocate & post/ }));

    await waitFor(() => expect(latest.db.payments).toHaveLength(2));
    const [payA, payB2] = latest.db.payments;

    /* Two vouchers, consecutive numbers, each carrying its knock-off. */
    expect(payA).toMatchObject({ vendorId: 7, amount: 20000, allocatedAmount: 20000, advanceAmount: 0, direction: 'OUT', sourceBankTransactionId: 31 });
    expect(payA.allocations.map((a) => [a.voucherId, a.amount])).toEqual([[91, 12000], [92, 8000]]);
    expect(payB2).toMatchObject({ vendorId: 8, amount: 15000, allocatedAmount: 15000 });
    expect(payA.number).not.toBe(payB2.number);

    /* The bills moved through the engine's own ladder. */
    const bills = new Map(latest.db.bills.map((b) => [b.id, b]));
    expect(bills.get(91)).toMatchObject({ paidAmount: 12000, status: 'Paid' });
    expect(bills.get(92)).toMatchObject({ paidAmount: 8000, status: 'Paid' });
    expect(bills.get(93)).toMatchObject({ paidAmount: 15000, status: 'Partial' });

    /* Children: two voucher-settled, one journal-settled. */
    const children = latest.db.bankAllocations.filter((a) => String(a.bankTransactionId) === '31');
    expect(children).toHaveLength(3);
    expect(children.filter((a) => a.paymentId)).toHaveLength(2);
    const plain = children.find((a) => !a.paymentId);
    expect(plain).toMatchObject({ ledgerId: '620', amount: 65000 });

    /* One journal, bank leg = the charges alone — the vouchers already
       posted their ₹35,000. */
    const jv = latest.db.journalEntries.find((j) => j.sourceBankTransactionId === 31);
    expect(jv.totalDebit).toBe(65000);
    expect(jv.lines).toEqual([
      expect.objectContaining({ accountId: '502', credit: 65000, debit: 0 }),
      expect.objectContaining({ accountId: '620', debit: 65000, credit: 0 }),
    ]);
    expect(postJournalToLedger).toHaveBeenCalledTimes(1);
  });

  it('an amount past the ticked bills becomes the vendor advance', async () => {
    const user = userEvent.setup();
    render(<Host txn={{ ...TXN_OUT, id: 32, amount: 25000 }} />);

    await user.selectOptions(ledgerSelects()[0], '610');
    await user.click(screen.getByRole('button', { name: /Allocate Bills/ }));
    await user.click(screen.getByLabelText('Settle BILL-91'));
    const amt = amountInputs()[0];
    await user.clear(amt);
    await user.type(amt, '25000');
    expect(screen.getByText(/beyond the ticked bills will be recorded as an advance/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Allocate & post/ }));
    await waitFor(() => expect(latest.db.payments).toHaveLength(1));
    expect(latest.db.payments[0]).toMatchObject({ amount: 25000, allocatedAmount: 12000, advanceAmount: 13000 });
  });

  it('post stays locked until the rows meet the bank amount', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.selectOptions(ledgerSelects()[0], '620');
    await user.type(amountInputs()[0], '99999');
    expect(screen.getByRole('button', { name: /Allocate & post/ })).toBeDisabled();
  });
});

describe('the receivable side is unchanged', () => {
  beforeEach(() => {
    postJournalToLedger.mockClear();
    latest.db = db0;
  });

  it('a customer ledger on a credit still hands over to the receipt engine', async () => {
    const user = userEvent.setup();
    render(<Host txn={{ ...TXN_OUT, id: 33, direction: 'IN', amount: 50000 }} />);

    await user.selectOptions(ledgerSelects()[0], '410');
    await user.click(screen.getByRole('button', { name: 'Allocate Invoices' }));
    await user.click(screen.getByRole('button', { name: 'engine: settle invoices' }));
    await user.click(screen.getByRole('button', { name: /Allocate & post/ }));

    await waitFor(() => {
      const children = latest.db.bankAllocations.filter((a) => String(a.bankTransactionId) === '33');
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ paymentId: 66, partyKind: 'customer', journalEntryId: null });
    });
    expect(postJournalToLedger).not.toHaveBeenCalled();
  });
});
