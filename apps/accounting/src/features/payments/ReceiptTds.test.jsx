import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/payments', () => ({ createPayment: vi.fn(async () => ({})) }));
vi.mock('./usePaymentModes', () => ({
  default: () => ({ modes: [{ id: 'srv-hdfc', code: '1200', name: 'HDFC Current A/c', controlKind: 'BANK' }], loading: false, error: '' }),
  modeLabel: (m) => `${m.code} · ${m.name}`,
}));

import RecordReceiptForm from './RecordReceiptForm';

/**
 * TDS the customer actually deducted.
 *
 * The invoice only ever expected this. The asset is recognised here, when the
 * money arrives short by exactly the tax — §18, and the reason the sell side
 * never debits TDS Receivable at invoice time: an expectation that never
 * arrives would sit in the books as tax somebody else had paid for us.
 */

const CONTRACTOR = 'CONTRACTOR_SUB_CONTRACTOR';

/* The customer's own control account. Choosing it in an allocation row is how
   the party is chosen now, so the fixture has to carry the link. */
const CUSTOMER_ACCOUNT_ID = '301';

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  state: 'Karnataka',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};

const INVOICE = {
  id: 5, companyId: 1, customerId: 3, number: 'INV-1', date: '2026-09-01',
  total: 118000, subtotal: 100000, paidAmount: 0, status: 'Unpaid',
  /* What the invoice said the customer was expected to withhold. */
  tdsExpectedAmount: 1000,
};

const db0 = {
  companies: [COMPANY],
  customers: [
    { id: 3, companyId: 1, name: 'ABC Industries', displayName: 'ABC Industries', pan: 'AABCU9603R', tdsNatureCode: CONTRACTOR, accountId: Number(CUSTOMER_ACCOUNT_ID) },
  ],
  accountGroups: [
    { id: 11, companyId: 1, name: 'TDS Payable', parentGroupId: null },
    { id: 12, companyId: 1, name: 'TDS Receivable', parentGroupId: null },
    { id: 13, companyId: 1, name: 'Sundry Debtors', parentGroupId: null },
  ],
  chartOfAccounts: [
    { id: 101, companyId: 1, name: 'TDS Payable - Contractor', groupId: 11, tdsNatureCode: CONTRACTOR },
    { id: 201, companyId: 1, name: 'TDS Receivable - Contractor', groupId: 12, tdsNatureCode: CONTRACTOR },
    { id: 301, companyId: 1, name: 'ABC Industries', groupId: 13 },
  ],
  invoices: [INVOICE],
  creditNotes: [],
  payments: [],
  tdsTransactions: [],
};

const Host = ({ onSaved = () => {}, company = COMPANY }) => {
  const [db, setDb] = useState(db0);
  return (
    <RecordReceiptForm
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

const pickCustomer = async (user) => {
  /* The party is a ledger now, and the ledger is typed: the operator types a
     name, the list narrows, and the suggestion is taken. */
  await user.click(screen.getByLabelText(/Account, allocation row 1/i));
  await user.type(screen.getByLabelText(/Account, allocation row 1/i), 'ABC');
  await user.click(await screen.findByRole('option', { name: /ABC Industries/ }));
};

const selectInvoice = async (user) => {
  /*
   * The order the screen asks for: ledger, then the amount, then which of that
   * customer's invoices it settles. `pickCustomer` has chosen the ledger.
   */
  fireEvent.change(screen.getByLabelText(/Amount, allocation row 1/i), { target: { value: '118000' } });
  await user.click(await screen.findByRole('button', { name: /View Bills/i }));
  const row = (await screen.findByText('INV-1')).closest('tr');
  await user.click(row.querySelector('input[type="checkbox"]'));
  await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));
};

describe('what the receipt offers', () => {
  /* §2: with TDS off the compact control is not offered at all. */
  it('shows the TDS section but will not take a figure while TDS is off', () => {
    /*
     * It used to vanish entirely, which is defensible until somebody looks for
     * it, finds nothing, and cannot tell a missing feature from a setting. The
     * section states the setting and its controls do not take input.
     */
    const off = { ...COMPANY, profile: { taxCompliances: { tds: { enabled: false } } } };
    render(<Host company={off} />);
    expect(screen.getByText('TDS (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('TDS Amount').disabled).toBe(true);
    expect(screen.getByLabelText('TDS Ledger').disabled).toBe(true);
    expect(screen.getByText(/Settings → Tax & Compliance/)).toBeInTheDocument();
  });

  beforeEach(() => localStorage.clear());

  it('offers what the invoice expected the customer to withhold', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);
    await selectInvoice(user);

    expect(await screen.findByText(/The invoices expected ₹1,000\.00/)).toBeInTheDocument();
  });

  it('takes up the expectation, and asks where it posts', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);
    await selectInvoice(user);
    await user.click(await screen.findByRole('button', { name: 'Use it' }));

    expect(screen.getByLabelText('TDS Amount')).toHaveValue(1000);
    expect(screen.getByLabelText('TDS Ledger')).toHaveValue('201');
  });

  /* The receivable side only — a payable ledger is what we owe, and cannot
     hold tax somebody else withheld from us. */
  it('offers receivable ledgers only', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);
    await selectInvoice(user);
    fireEvent.change(screen.getByLabelText('TDS Amount'), { target: { value: '1000' } });

    const options = [...screen.getByLabelText('TDS Ledger').options].map((o) => o.textContent);
    expect(options).toEqual(['Select TDS ledger', 'TDS Receivable - Contractor']);
  });
});

describe('what the receipt records', () => {
  beforeEach(() => localStorage.clear());

  it('recognises the receivable, against the mapped ledger', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await pickCustomer(user);
    await selectInvoice(user);
    await user.click(await screen.findByRole('button', { name: 'Use it' }));
    await user.click(screen.getByRole('button', { name: /Record Receipt/ }));

    await waitFor(() => expect((saved?.tdsTransactions || []).length).toBe(1));
    expect(saved.tdsTransactions.at(-1)).toMatchObject({
      sourceType: 'receipt',
      side: 'RECEIVABLE',
      partyId: 3,
      natureCode: CONTRACTOR,
      tdsAmount: 1000,
      ledgerId: '201',
      status: 'Posted',
    });
  });

  it('records nothing where the customer deducted nothing', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);

    await pickCustomer(user);
    await selectInvoice(user);
    await user.click(screen.getByRole('button', { name: /Record Receipt/ }));

    await waitFor(() => expect((saved?.payments || []).length).toBe(1));
    expect(saved.tdsTransactions || []).toHaveLength(0);
  });
});

/**
 * The order the screen asks in: a ledger, an amount, then which of that
 * customer's invoices the amount settles — and what it means when the answer
 * to the last one is "none of them".
 */
describe('money against a customer', () => {
  beforeEach(() => localStorage.clear());

  const partyRow = () =>
    screen.getByRole('button', { name: /View Bills/i }).closest('tr');

  it('offers the bills once the amount on a customer row is named', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);

    expect(screen.queryByText('Allocate Outstanding Bills')).toBeNull();

    const amount = screen.getByLabelText(/Amount, allocation row 1/i);
    fireEvent.change(amount, { target: { value: '50000' } });
    fireEvent.blur(amount);

    expect(await screen.findByText('Allocate Outstanding Bills')).toBeInTheDocument();
  });

  it('does not reopen the dialog while the figure is corrected', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);

    const amount = screen.getByLabelText(/Amount, allocation row 1/i);
    fireEvent.change(amount, { target: { value: '50000' } });
    fireEvent.blur(amount);
    const dialog = (await screen.findByText('Allocate Outstanding Bills')).closest('[role="dialog"]');
    await user.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));

    /* A typo corrected on the way past must not trap the operator in a dialog
       they have just dismissed. */
    fireEvent.change(amount, { target: { value: '60000' } });
    fireEvent.blur(amount);
    expect(screen.queryByText('Allocate Outstanding Bills')).toBeNull();
  });

  it('calls it on account when the money is placed on nobody’s invoice', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);

    const amount = screen.getByLabelText(/Amount, allocation row 1/i);
    fireEvent.change(amount, { target: { value: '50000' } });
    fireEvent.blur(amount);
    await screen.findByText('Allocate Outstanding Bills');
    await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));

    expect(within(partyRow()).getByText('On account')).toBeInTheDocument();
  });

  it('names the part left over when only some of it lands on an invoice', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);

    const amount = screen.getByLabelText(/Amount, allocation row 1/i);
    fireEvent.change(amount, { target: { value: '150000' } });
    fireEvent.blur(amount);
    await screen.findByText('Allocate Outstanding Bills');

    const inv = (await screen.findByText('INV-1')).closest('tr');
    await user.click(inv.querySelector('input[type="checkbox"]'));
    await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));

    /* 118,000 of the 150,000 settles the invoice; the rest waits on them. */
    expect(within(partyRow()).getByText(/1 invoice · .*32,000/)).toBeInTheDocument();
  });

  it('takes the allocation as the amount when the dialog is used first', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await pickCustomer(user);

    await user.click(screen.getByRole('button', { name: /View Bills/i }));
    const inv = (await screen.findByText('INV-1')).closest('tr');
    await user.click(inv.querySelector('input[type="checkbox"]'));
    await user.click(screen.getByRole('button', { name: /Apply Allocation/i }));

    expect(screen.getByLabelText(/Amount, allocation row 1/i).value).toBe('118000');
  });
});
