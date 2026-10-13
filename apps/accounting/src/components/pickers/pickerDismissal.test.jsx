import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/masters', async (importOriginal) => ({
  ...(await importOriginal()),
  listCustomers: () => Promise.reject(new Error('offline')),
  listVendors: () => Promise.reject(new Error('offline')),
  listItems: () => Promise.reject(new Error('offline')),
  createCustomer: vi.fn(),
  createVendor: vi.fn(),
  createItem: vi.fn(),
}));

import CustomerPicker from './CustomerPicker';
import VendorPicker from './VendorPicker';
import ItemPicker from './ItemPicker';

/**
 * An open list lets go of the form.
 *
 * The field opened on focus and, on closing, handed the caret back to itself —
 * so dismissing the list refocused the field, which reopened the list over
 * whatever had just been clicked. The form was unusable until the page was
 * reloaded: every other control was covered by a list that would not stay
 * shut.
 *
 * Opening is a click or a keystroke now, never focus alone, and a dismissal
 * that came from outside does not drag the caret back.
 */

const COMPANY = { id: 1, name: 'Neev Steels' };

const db = {
  companies: [COMPANY],
  customers: [{ id: 1, companyId: 1, name: 'ABC Industries', displayName: 'ABC Industries' }],
  vendors: [{ id: 2, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co' }],
  items: [{ id: 3, companyId: 1, name: 'MS Angle 50mm', code: 'A50', gstRate: 18 }],
  accountGroups: [
    { id: 1, companyId: 1, name: 'Sundry Debtors' },
    { id: 2, companyId: 1, name: 'Sundry Creditors' },
  ],
  chartOfAccounts: [],
  invoices: [],
  uoms: [],
  gstRates: [],
};

const PICKERS = [
  { name: 'customer', Component: CustomerPicker, placeholder: 'Type a customer name' },
  { name: 'vendor', Component: VendorPicker, placeholder: 'Type a vendor name' },
  { name: 'item', Component: ItemPicker, placeholder: 'Type an item name or code' },
];

for (const { name, Component, placeholder } of PICKERS) {
  describe(`the ${name} field`, () => {
    const Host = () => {
      const [value, setValue] = useState('');
      return (
        <form>
          <Component db={db} setDb={() => {}} currentCompany={COMPANY} value={value} onChange={setValue} />
          <input aria-label="something else" />
        </form>
      );
    };

    it('closes when something else is clicked', async () => {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByPlaceholderText(placeholder));
      expect(await screen.findByRole('listbox')).toBeInTheDocument();

      await user.click(screen.getByLabelText('something else'));
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    /* The bug: closing handed the caret back, and the field reopened on it.
       The hand-back is deferred a frame, so the frame is let through here. */
    it('does not reopen itself once dismissed', async () => {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByPlaceholderText(placeholder));
      await user.click(screen.getByLabelText('something else'));
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      /* The other field keeps the caret, and no list is covering it. */
      expect(document.activeElement).toBe(screen.getByLabelText('something else'));
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('lets the other field be typed into afterwards', async () => {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByPlaceholderText(placeholder));
      await user.click(screen.getByLabelText('something else'));
      await user.keyboard('hello');

      expect(screen.getByLabelText('something else')).toHaveValue('hello');
    });

    it('closes on Escape too', async () => {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByPlaceholderText(placeholder));
      expect(await screen.findByRole('listbox')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });
}
