import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/payments', () => ({ createPayment: vi.fn(async () => ({ id: 'srv-1' })) }));
vi.mock('@ui/api/cashbank', () => ({ listPaymentModes: vi.fn(async () => []) }), { virtual: true });

import RecordDisbursementForm from './RecordDisbursementForm';

/**
 * A payment settles more than it moves.
 *
 * A bill of 10,000 with 1,000 of TDS is settled in full and takes 9,000 out of
 * the account. Before this the two were the same number, so either the bill was
 * left part-paid or the bank was overstated by exactly the tax deducted.
 */

const co = {
  id: 1,
  name: 'Mani beriyanis',
  state: 'Karnataka',
  /* The TDS control is offered only where the company tracks it. */
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F' } } },
};
const db = {
  companies: [co],
  /* The payee is chosen by picking its control account in an allocation row,
     so the fixture carries the link. */
  vendors: [{ id: 3, companyId: 1, name: 'ABC Supplies', displayName: 'ABC Supplies', accountId: 301 }],
  bills: [{ id: 1, companyId: 1, vendorId: 3, number: 'PUR-1', date: '2026-08-10', dueDate: '2026-08-25', total: 10000, paidAmount: 0, status: 'Open' }],
  expenses: [],
  debitNotes: [],
  payments: [],
  accountGroups: [{ id: 12, companyId: 1, name: 'Sundry Creditors', parentGroupId: null }],
  chartOfAccounts: [{ id: 301, companyId: 1, name: 'ABC Supplies', groupId: 12 }],
};

const renderForm = (props = {}) =>
  render(
    <RecordDisbursementForm db={db} setDb={() => {}} currentCompany={co} onClose={() => {}} screenTitle="New Payment" {...props} />
  );

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/*
 * A payment is worth what its rows say, and a row counts only once it has both
 * a ledger and a figure — so naming the amount means naming where it goes.
 */
const allocate = async (user, value) => {
  const field = screen.getByLabelText(/Account, allocation row 1/i);
  await user.click(field);
  await user.type(field, 'ABC');
  await user.click(await screen.findByRole('option', { name: /ABC Supplies/ }));
  fireEvent.change(screen.getByLabelText(/Amount, allocation row 1/i), { target: { value } });
};

describe('the payment carries a number', () => {
  it('opens on the next one in the company series', () => {
    renderForm();
    /* PAY- and one, from the series already configured under Numbering — this
       screen does not invent a second scheme. */
    expect(screen.getByLabelText('Payment No.').value).toMatch(/^PAY-\d+$/);
  });

  it('walks past a number already in the book', () => {
    render(
      <RecordDisbursementForm
        db={{ ...db, payments: [{ id: 1, companyId: 1, number: 'PAY-1' }] }}
        setDb={() => {}}
        currentCompany={co}
        onClose={() => {}}
        screenTitle="New Payment"
      />
    );
    expect(screen.getByLabelText('Payment No.').value).not.toBe('PAY-1');
  });

  it('refuses a number another payment already wears', () => {
    const setDb = vi.fn();
    render(
      <RecordDisbursementForm
        db={{ ...db, payments: [{ id: 1, companyId: 1, number: 'PAY-9' }] }}
        setDb={setDb}
        currentCompany={co}
        onClose={() => {}}
        screenTitle="New Payment"
        initialData={{ vendorId: '3', amount: '500' }}
      />
    );
    fireEvent.change(screen.getByLabelText('Payment No.'), { target: { value: 'PAY-9' } });
    fireEvent.submit(screen.getByLabelText('Payment No.').closest('form'));
    /* Two payments wearing one number cannot be told apart in a ledger or on a
       bank statement. */
    expect(setDb).not.toHaveBeenCalled();
    expect(screen.getByText(/already used by another payment/i)).toBeInTheDocument();
  });
});

describe('the bills a payment can settle', () => {
  /* They are a dialog now, opened from the payee's own allocation row, rather
     than a permanent table halfway down the form. */
  const openBills = async (user) => {
    await user.click(await screen.findByRole('button', { name: /View Bills/i }));
    return (await screen.findByText('PUR-1')).closest('table');
  };

  it('shows the bill, what is left of it, and when it fell due', async () => {
    const user = userEvent.setup();
    renderForm({ initialData: { vendorId: '3' } });
    const table = await openBills(user);
    expect(table.textContent).toMatch(/Bill Amount/);
    expect(table.textContent).toMatch(/Outstanding/);
    /* The bill's own date. The permanent table this replaced showed the DUE
       date instead, which is the more useful of the two when deciding what to
       settle — noted rather than smuggled back in, because the column set is
       the one the drawing specifies. */
    expect(table.textContent).toMatch(/2026-08-10/);
  });

  it('queues the oldest bill first', async () => {
    const user = userEvent.setup();
    renderForm({ initialData: { vendorId: '3' } });
    const table = await openBills(user);
    const rows = [...table.querySelectorAll('tbody tr')];
    /* Not a list, a queue: the bill that has waited longest is the one being
       settled, and it belongs at the top. */
    expect(rows[0].textContent).toMatch(/PUR-1/);
  });

  it('ticks and unticks every bill from the header', async () => {
    const user = userEvent.setup();
    renderForm({ initialData: { vendorId: '3' } });
    fireEvent.change(screen.getByLabelText(/Amount, allocation row 1/i), { target: { value: '15000' } });
    const table = await openBills(user);
    await user.click(screen.getByLabelText(/Select every bill/i));
    const boxes = [...table.querySelectorAll('tbody input[type="checkbox"]')];
    expect(boxes.some((b) => b.checked)).toBe(true);
    await user.click(screen.getByLabelText(/Clear every bill/i));
    expect([...table.querySelectorAll('tbody input[type="checkbox"]')].every((b) => !b.checked)).toBe(true);
  });
});

describe('the running bar agrees with the summary', () => {
  it('shows what leaves the account, not what settles the bills', async () => {
    const user = userEvent.setup();
    renderForm();
    await allocate(user, '10000');
    type('TDS deduction', '1000');
    /* The label says "paid from the account", and 9,000 is what goes. */
    const bar = document.querySelector('.ui-entry-summary');
    expect(bar.textContent).toMatch(/9,000/);
    expect(bar.textContent).not.toMatch(/10,000/);
  });
});

describe('what is held back', () => {
  it('totals the deductions and shows what actually leaves', async () => {
    const user = userEvent.setup();
    renderForm();
    await allocate(user, '10000');
    type('TDS deduction', '1000');

    const summary = screen.getByRole('region', { name: 'Payment summary' });
    /* 10,000 settles the bill; 1,000 is held back; 9,000 leaves the bank. */
    expect(summary.textContent).toMatch(/1,000/);
    expect(summary.textContent).toMatch(/9,000/);
  });

  /*
   * Bank charges used to be a box beside TDS that reduced the cash and posted
   * to nothing. It is an allocation row now, so the charge names the expense
   * account it belongs to and the entry says what the money was.
   */
  it('takes a bank charge as an allocation row rather than a deduction box', () => {
    renderForm();
    expect(screen.queryByLabelText('Bank charges')).toBeNull();
    expect(screen.queryByLabelText('Other deductions')).toBeNull();
    expect(screen.getByLabelText(/Account, allocation row 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount, allocation row 1/i)).toBeInTheDocument();
  });

  it('says the unallocated part is an advance', async () => {
    const user = userEvent.setup();
    renderForm();
    await allocate(user, '10000');
    const summary = screen.getByRole('region', { name: 'Payment summary' });
    /* Nothing allocated yet, so the whole payment is sitting on account. */
    expect(summary.textContent).toMatch(/Advance \(unallocated\)/i);
    expect(summary.textContent).toMatch(/10,000/);
  });

  it('reads the net back in words', async () => {
    const user = userEvent.setup();
    renderForm();
    await allocate(user, '10000');
    type('TDS deduction', '1000');
    expect(screen.getByText(/Rupees Nine Thousand/i)).toBeInTheDocument();
  });

  it('keeps the gross and the net apart', async () => {
    const user = userEvent.setup();
    renderForm();
    await allocate(user, '5000');
    type('TDS deduction', '500');
    const summary = screen.getByRole('region', { name: 'Payment summary' });
    /* Both figures on screen: one settles the bills, the other moves. */
    expect(summary.textContent).toMatch(/5,000/);
    expect(summary.textContent).toMatch(/4,500/);
  });
});
