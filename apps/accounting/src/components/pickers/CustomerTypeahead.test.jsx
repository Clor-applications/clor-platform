import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/masters', async (importOriginal) => ({
  ...(await importOriginal()),
  listCustomers: () => Promise.reject(new Error('offline')),
  createCustomer: vi.fn(),
}));

import CustomerPicker from './CustomerPicker';

/**
 * A field somebody types a name into.
 *
 * It used to be a button reading "Select Customer" that did nothing until it
 * was clicked, and then opened a dialog with its own search box — so the name
 * already in the operator's hands had nowhere to go, and the document they
 * were writing was hidden behind a scrim to look one up.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

const db = {
  companies: [COMPANY],
  customers: [
    { id: 1, companyId: 1, name: 'ABC Industries', displayName: 'ABC Industries', email: 'ap@abc.example' },
    { id: 2, companyId: 1, name: 'Acme Works', displayName: 'Acme Works' },
    { id: 3, companyId: 1, name: 'Zenith Traders', displayName: 'Zenith Traders' },
    { id: 4, companyId: 1, name: 'Dormant Buyer', displayName: 'Dormant Buyer', isActive: false },
  ],
  accountGroups: [{ id: 1, companyId: 1, name: 'Sundry Debtors' }],
  chartOfAccounts: [],
  invoices: [],
};

const Host = () => {
  const [value, setValue] = useState('');
  return (
    <form>
      <CustomerPicker db={db} setDb={() => {}} currentCompany={COMPANY} value={value} onChange={setValue} />
    </form>
  );
};

const field = () => screen.getByRole('combobox');

describe('the customer field', () => {
  it('is a field to type in, not a button saying Select Customer', () => {
    render(<Host />);
    expect(field().tagName).toBe('INPUT');
    expect(screen.queryByText('Select Customer')).toBeNull();
    expect(field()).toHaveAttribute('placeholder', 'Type a customer name');
  });

  it('suggests every customer as soon as the caret arrives', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());

    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('ABC Industries'), expect.stringContaining('Zenith Traders')])
    );
    expect(within(list).queryByText(/Dormant Buyer/)).toBeNull();
  });

  it('narrows as the letters arrive — all of them', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), 'zen');

    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option')).toHaveTextContent('Zenith Traders');
    expect(field()).toHaveValue('zen');
  });

  it('picks what was highlighted, and shows the name in the field', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), 'acme');
    await user.click(await screen.findByRole('option', { name: /Acme Works/ }));

    expect(field()).toHaveValue('Acme Works');
  });

  /* The other half of the same motion: a name that matches nothing is usually
     a customer nobody has entered yet. */
  it('offers to create the name that matched nothing', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), 'Brand New Buyer');

    expect(await screen.findByText(/No customer matches “Brand New Buyer”/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create “Brand New Buyer”/ })).toBeInTheDocument();
  });

  it('carries the typed name into the creation form', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), 'Brand New Buyer');
    await user.click(screen.getByRole('button', { name: /Create “Brand New Buyer”/ }));

    /* The field behind it still holds what was typed, so the assertion is
       scoped to the form that opened. */
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Brand New Buyer')).toBeInTheDocument();
  });

  it('still walks the list with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(field().value).toBeTruthy();
    expect(field().value).not.toBe('');
  });
});
