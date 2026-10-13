import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/payments', () => ({ createPayment: vi.fn(async () => ({})) }));
vi.mock('./usePaymentModes', () => ({
  default: () => ({ modes: [{ id: 'srv-hdfc', code: '1200', name: 'HDFC Current A/c', controlKind: 'BANK' }], loading: false, error: '' }),
  modeLabel: (m) => `${m.code} · ${m.name}`,
}));

import RecordDisbursementForm from './RecordDisbursementForm';

/**
 * TDS when the money actually leaves.
 *
 * The law deducts at credit or payment, whichever is earlier. So a payment
 * deducts what the bill did not — and where the bill already did, deducting
 * again would pay the department twice out of one obligation and leave the
 * vendor short by exactly the tax. §16 calls that mandatory; this is where it
 * is enforced.
 */

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  state: 'Karnataka',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const dbWith = (bills) => ({
  companies: [COMPANY],
  vendors: [
    {
      id: 9,
      companyId: 1,
      name: 'Steel Supply Co',
      displayName: 'Steel Supply Co',
      pan: 'AABCU9603R',
      tdsApplicable: true,
      tdsNatureCode: CONTRACTOR,
      /* The payee is chosen by picking its control account in a row, so the
         fixture has to carry the link. */
      accountId: 301,
    },
  ],
  accountGroups: [
    { id: 11, companyId: 1, name: 'TDS Payable', parentGroupId: null },
    { id: 12, companyId: 1, name: 'Sundry Creditors', parentGroupId: null },
  ],
  chartOfAccounts: [
    { id: 101, companyId: 1, name: 'TDS on Contractors', groupId: 11, tdsNatureCode: CONTRACTOR },
    { id: 301, companyId: 1, name: 'Steel Supply Co', groupId: 12 },
  ],
  bills,
  expenses: [],
  debitNotes: [],
  payments: [],
  tdsTransactions: [],
});

/** A bill that never deducted, and one that did. */
const plainBill = {
  id: 7, companyId: 1, vendorId: 9, number: 'BILL-1', date: '2026-09-01', dueDate: '2026-10-01',
  total: 118000, subtotal: 100000, paidAmount: 0, status: 'Unpaid',
};
const deductedBill = {
  ...plainBill, id: 8, number: 'BILL-2',
  tdsAmount: 2000, tdsNatureCode: CONTRACTOR, tdsLedgerId: '101',
};

const Host = ({ bills = [plainBill], onSaved = () => {}, company = COMPANY }) => {
  const [db, setDb] = useState(() => dbWith(bills));
  return (
    <RecordDisbursementForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved(value);
        setDb(value);
      }}
      currentCompany={company}
      onClose={() => {}}
    />
  );
};

const pickVendor = async (user) => {
  /* The payee is a ledger now, and the ledger is typed: the operator types a
     name, the list narrows, and the suggestion is taken. */
  const field = screen.getByLabelText(/Account, allocation row 1/i);
  await user.click(field);
  await user.type(field, 'Steel');
  await user.click(await screen.findByRole('option', { name: /Steel Supply Co/ }));
};

const selectBill = async (user, number) => {
  /* The bills are a dialog, opened from the payee's own allocation row, and
     the payment is worth whatever is allocated — there is no "amount paid" to
     type first. */
  fireEvent.change(screen.getByLabelText(/Amount, allocation row 1/i), { target: { value: '118000' } });
  const open = await screen.findByRole('button', { name: /View Bills/i });
  if (!screen.queryByText('Allocate Outstanding Bills')) await user.click(open);
  const row = (await screen.findByText(number)).closest('tr');
  await user.click(row.querySelector('input[type="checkbox"]'));
  await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));
};

describe('what the payment offers to deduct', () => {
  beforeEach(() => localStorage.clear());

  /* §2: with TDS off the compact control is not offered at all — an
     ordinary user sees TDS only where it is relevant. */
  it('offers no TDS control while TDS is switched off for the company', () => {
    const off = { ...COMPANY, profile: { taxCompliances: { tds: { enabled: false } } } };
    render(<Host company={off} />);
    expect(screen.queryByLabelText('TDS deduction')).toBeNull();
  });

  it('suggests the engine’s figure for a bill that never deducted', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickVendor(user);
    await selectBill(user, 'BILL-1');

    /* 194C at 2% on the taxable value, not on the bill total. */
    expect(await screen.findByText(/suggests ₹2,000\.00 at 2% on ₹1,00,000\.00/)).toBeInTheDocument();
  });

  it('puts the suggestion in the field when it is taken up', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickVendor(user);
    await selectBill(user, 'BILL-1');
    await user.click(await screen.findByRole('button', { name: 'Use it' }));

    expect(screen.getByLabelText('TDS deduction')).toHaveValue(2000);
    expect(screen.getByLabelText('TDS ledger')).toHaveValue('101');
  });

  /* The whole point of §16. */
  it('refuses to suggest again where the bill already deducted', async () => {
    const user = userEvent.setup();
    render(<Host bills={[deductedBill]} />);
    await pickVendor(user);
    await selectBill(user, 'BILL-2');

    expect(await screen.findByText(/Already deducted on the bills being settled: ₹2,000\.00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull();
  });

  /* §15 — double deduction is a BLOCKING error. The engine already said
     these bills deducted at source; a figure typed over that answer must
     stop the save, not ride along as a warning. */
  it('BLOCKS a typed deduction against a bill that already deducted', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    render(<Host bills={[deductedBill]} onSaved={saved} />);
    await pickVendor(user);
    await selectBill(user, 'BILL-2');

    fireEvent.change(screen.getByLabelText('TDS deduction'), { target: { value: '2000' } });
    fireEvent.submit(document.querySelector('form'));

    /* Nothing was written — the boundary held. */
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).not.toHaveBeenCalled();
  });

  /* The vendor is owed the NET of a source-deducting bill: ₹1,18,000 less
     ₹2,000 already owed to the department. Paying that net settles it. */
  it('offers the net balance and settles the bill at it', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    render(<Host bills={[deductedBill]} onSaved={saved} />);
    await pickVendor(user);

    /* The vendor is owed the net, and the dialog is where that is read. */
    fireEvent.change(screen.getByLabelText(/Amount, allocation row 1/i), { target: { value: '116000' } });
    await user.click(await screen.findByRole('button', { name: /View Bills/i }));
    const row = (await screen.findByText('BILL-2')).closest('tr');
    expect(row.textContent).toMatch(/1,16,000\.00/);
    await user.click(row.querySelector('input[type="checkbox"]'));
    await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));
    fireEvent.submit(document.querySelector('form'));

    await waitFor(() => expect(saved).toHaveBeenCalled());
    const db = saved.mock.calls.at(-1)[0];
    const bill = db.bills.find((b) => b.id === 8);
    expect(bill.status).toBe('Paid');
    expect(bill.paidAmount).toBe(116000);
  });

  it('offers only the ledgers mapped to the vendor’s nature', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickVendor(user);
    await selectBill(user, 'BILL-1');
    await user.click(await screen.findByRole('button', { name: 'Use it' }));

    const options = [...screen.getByLabelText('TDS ledger').options].map((o) => o.textContent);
    expect(options).toEqual(['Select ledger', 'TDS on Contractors']);
  });
});

describe('what the payment records', () => {
  beforeEach(() => localStorage.clear());

  const recordPayment = async (user) => {
    await user.click(screen.getByRole('button', { name: /Record Payment/ }));
  };

  it('writes a compliance record for a deduction it made itself', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await pickVendor(user);
    await selectBill(user, 'BILL-1');
    await user.click(await screen.findByRole('button', { name: 'Use it' }));
    await recordPayment(user);

    await waitFor(() => expect((saved?.tdsTransactions || []).length).toBe(1));
    expect((saved.tdsTransactions || []).at(-1)).toMatchObject({
      sourceType: 'payment',
      partyId: 9,
      natureCode: CONTRACTOR,
      sectionCode: '194C',
      tdsAmount: 2000,
      ledgerId: '101',
      status: 'Posted',
    });
  });

  /* A deduction that exists only as the difference between two figures cannot
     be reported — the return is built from these records. */
  it('keeps the nature and the rule version on the payment itself', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await pickVendor(user);
    await selectBill(user, 'BILL-1');
    await user.click(await screen.findByRole('button', { name: 'Use it' }));
    await recordPayment(user);

    await waitFor(() => expect((saved?.payments || []).length).toBe(1));
    const payment = saved.payments.at(-1);
    expect(payment.tdsAmount).toBe(2000);
    expect(payment.tdsNatureCode).toBe(CONTRACTOR);
    expect(payment.tdsRuleVersionId).toBeTruthy();
  });

  it('writes no record where nothing was deducted', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await pickVendor(user);
    await selectBill(user, 'BILL-1');
    await recordPayment(user);

    await waitFor(() => expect((saved?.payments || []).length).toBe(1));
    expect(saved.tdsTransactions || []).toHaveLength(0);
  });

  /* Typed over, because a certificate or a part-payment is the operator's
     call — but still recorded as a deduction under the resolved nature. */
  it('records a figure typed over the suggestion', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await pickVendor(user);
    await selectBill(user, 'BILL-1');
    fireEvent.change(screen.getByLabelText('TDS deduction'), { target: { value: '500' } });
    await recordPayment(user);

    await waitFor(() => expect((saved?.tdsTransactions || []).length).toBe(1));
    expect(saved.tdsTransactions.at(-1).tdsAmount).toBe(500);
  });
});
