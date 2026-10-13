import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createPayment = vi.fn(async () => ({}));

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/payments', () => ({ createPayment: (...a) => createPayment(...a) }));
vi.mock('./usePaymentModes', () => ({
  default: () => ({ modes: [{ id: 'srv-hdfc', code: '1200', name: 'HDFC Current A/c', controlKind: 'BANK' }], loading: false, error: '' }),
  modeLabel: (m) => `${m.code} · ${m.name}`,
}));

import RecordReceiptForm from './RecordReceiptForm';

/**
 * A receipt is numbered from the company's series, like everything else.
 *
 * It used to take whatever the server minted, which made it the one document
 * whose numbering nobody could see or change: the gear every other form
 * carries had nothing to govern here. The series is read on the form and sent
 * with the receipt — the server allocates a number only when it is given none
 * — so there is still exactly one series in play, and a number the server does
 * return still wins.
 */

const COMPANY = {
  id: 1,
  name: 'Neev Steels',
  state: 'Karnataka',
  docSettings: { numbering: { receipt: { mode: 'auto', prefix: 'RC-', nextNumber: 41 } } },
};

const db0 = {
  companies: [COMPANY],
  customers: [{ id: 3, companyId: 1, name: 'ABC Industries', displayName: 'ABC Industries' }],
  accountGroups: [],
  chartOfAccounts: [{ id: 401, companyId: 1, name: 'Interest Received', groupId: 21 }],
  invoices: [],
  creditNotes: [],
  payments: [],
  tdsTransactions: [],
};

const Host = ({ onSaved = () => {} }) => {
  const [db, setDb] = useState(db0);
  return (
    <RecordReceiptForm
      db={db}
      setDb={(next) => {
        const value = typeof next === 'function' ? next(db) : next;
        onSaved(value);
        setDb(value);
      }}
      currentCompany={COMPANY}
      onClose={() => {}}
    />
  );
};

const fill = async (user) => {
  /* No party picker and no amount box: the receipt is worth whatever is
     allocated, so a ledger and a figure on one row is the whole entry. */
  await user.click(screen.getByLabelText(/Account, allocation row 1/i));
  await user.type(screen.getByLabelText(/Account, allocation row 1/i), 'Interest');
  await user.click(await screen.findByRole('option', { name: /Interest Received/ }));
  fireEvent.change(screen.getByLabelText(/Amount, allocation row 1/i), { target: { value: '5000' } });
};

describe('the receipt number', () => {
  beforeEach(() => {
    createPayment.mockClear();
    localStorage.clear();
  });

  it('is shown, and comes from the series', () => {
    render(<Host />);
    expect(screen.getByLabelText('Receipt No.')).toHaveValue('RC-41');
  });

  it('carries the series control, as every other form does', () => {
    render(<Host />);
    expect(screen.getByRole('button', { name: /Receipt numbering settings/ })).toBeInTheDocument();
  });

  it('is sent to the server rather than left for it to invent', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Record Receipt/ }));

    await waitFor(() => expect(createPayment).toHaveBeenCalled());
    expect(createPayment.mock.calls[0][0]).toMatchObject({ number: 'RC-41', direction: 'RECEIPT' });
  });

  /* The server stays the authority where it answers: two tabs cannot both
     mint RC-41, and whatever comes back is what the books record. */
  it('prefers the number the server returns', async () => {
    createPayment.mockResolvedValueOnce({ number: 'RC-99' });
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Record Receipt/ }));

    await waitFor(() => expect((saved?.payments || []).length).toBe(1));
    expect(saved.payments.at(-1).number).toBe('RC-99');
  });

  it('moves the series on past the number it used', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<Host onSaved={(next) => { saved = next; }} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: /Record Receipt/ }));

    await waitFor(() => expect((saved?.payments || []).length).toBe(1));
    expect(saved.companies[0].docSettings.numbering.receipt.nextNumber).toBe(42);
  });
});
