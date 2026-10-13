import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => true }) }));

import { ItemForm } from '../../App';

/**
 * The item master asks only what the item is.
 *
 * A service has no stock, an item nobody counts has no opening balance, and an
 * exempt item has no rate — because a rate of zero and "exempt" are different
 * answers that a return cannot tell apart afterwards.
 */

const co = { id: 1, name: 'Mani beriyanis', state: 'Karnataka' };
const db = {
  companies: [co],
  items: [],
  itemCategories: [{ id: 1, companyId: 1, name: 'Beverages' }],
  uoms: [{ id: 1, companyId: 1, name: 'Pcs' }],
  gstRates: [{ id: 1, companyId: 1, rate: 5 }, { id: 2, companyId: 1, rate: 18 }],
};
const branches = [
  { id: 1, companyId: 1, branchCode: 'BLR001', branchName: 'Bengaluru' },
  { id: 2, companyId: 1, branchCode: 'MAA001', branchName: 'Chennai' },
];
const warehouses = [
  { id: 9, companyId: 1, branchId: 1, name: 'Bengaluru store' },
  { id: 10, companyId: 1, branchId: 2, name: 'Chennai store' },
];

const renderForm = (props = {}) =>
  render(
    <ItemForm
      fullPage
      db={db}
      setDb={() => {}}
      currentCompany={co}
      branches={branches}
      warehouses={warehouses}
      onClose={() => {}}
      {...props}
    />
  );

const inventory = () => screen.queryByRole('heading', { name: 'Inventory Details' });

describe('what the form shows follows what the item is', () => {
  it('asks a service nothing about stock', () => {
    renderForm();
    expect(inventory()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Service' }));
    expect(inventory()).toBeNull();
    expect(screen.queryByLabelText('Opening Stock')).toBeNull();
    expect(screen.queryByLabelText(/^Branch/)).toBeNull();
  });

  it('asks nothing about opening stock for goods nobody counts', () => {
    renderForm();
    expect(screen.getByLabelText('Opening Stock')).toBeInTheDocument();
    expect(screen.getByLabelText('Track batches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(inventory()).toBeInTheDocument();
    for (const field of ['Opening Stock', 'Opening Stock Rate', 'Opening Stock Date']) {
      expect(screen.queryByLabelText(field)).toBeNull();
    }
    expect(screen.queryByLabelText(/^Warehouse/)).toBeNull();
    expect(screen.queryByLabelText('Track batches')).toBeNull();
    expect(screen.queryByLabelText('Track expiry')).toBeNull();
  });

  it('asks for a rate only where one applies', () => {
    renderForm();
    expect(screen.getByLabelText(/^GST Rate/)).toBeInTheDocument();
    for (const taxability of ['Exempt', 'Nil Rated', 'Non-GST']) {
      fireEvent.change(screen.getByLabelText(/^Taxability/), { target: { value: taxability } });
      expect(screen.queryByLabelText(/^GST Rate/)).toBeNull();
    }
    fireEvent.change(screen.getByLabelText(/^Taxability/), { target: { value: 'Taxable' } });
    expect(screen.getByLabelText(/^GST Rate/)).toBeInTheDocument();
  });

  it('offers the rates the master holds, and no typed-in one', () => {
    renderForm();
    const rate = screen.getByLabelText(/^GST Rate/);
    expect(rate.tagName).toBe('SELECT');
    expect([...rate.options].map((o) => o.textContent)).toEqual(['5%', '18%']);
  });

});

describe('where the opening stock goes', () => {
  it('offers only the warehouses of the branch chosen', () => {
    renderForm();
    const warehouse = screen.getByLabelText(/^Warehouse/);
    expect(warehouse).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Branch/), { target: { value: '1' } });
    expect([...screen.getByLabelText(/^Warehouse/).options].map((o) => o.textContent)).toEqual([
      'Select warehouse',
      'Bengaluru store',
    ]);
  });

  it('drops the warehouse when the branch changes under it', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Branch/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^Warehouse/), { target: { value: '9' } });
    expect(screen.getByLabelText(/^Warehouse/).value).toBe('9');

    /* Bengaluru's store is not a place Chennai's stock can be. */
    fireEvent.change(screen.getByLabelText(/^Branch/), { target: { value: '2' } });
    expect(screen.getByLabelText(/^Warehouse/).value).toBe('');
  });

  it('works the value out rather than asking for it', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Opening Stock'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Opening Stock Rate'), { target: { value: '250' } });
    /* 12 × 250, and no field to disagree with it in. */
    expect(screen.getByText(/3,000/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Opening Stock Value/ })).toBeNull();
  });

  it('will not record stock with nowhere to be', () => {
    const setDb = vi.fn();
    renderForm({ setDb });
    fireEvent.change(screen.getByLabelText(/^Item Name/), { target: { value: 'Masala tea' } });
    fireEvent.change(screen.getByLabelText('Opening Stock'), { target: { value: '5' } });
    fireEvent.submit(screen.getByLabelText(/^Item Name/).closest('form'));

    expect(setDb).not.toHaveBeenCalled();
    expect(screen.getByText('Choose the branch this stock is in')).toBeInTheDocument();
  });
});

describe('the menu behind the three dots', () => {
  it('offers custom fields, and nothing about active, on a new item', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /More options/i }));
    expect(screen.getByText('Custom fields')).toBeInTheDocument();
    /* A new item is active from the moment it is made; the question has an
       answer already. */
    expect(screen.queryByText(/Mark inactive/)).toBeNull();
  });

  it('offers retiring one that already exists', () => {
    renderForm({ initialData: { id: 4, companyId: 1, name: 'Masala tea', type: 'Goods', isActive: true } });
    fireEvent.click(screen.getByRole('button', { name: /More options/i }));
    expect(screen.getByText('Mark inactive')).toBeInTheDocument();
    expect(screen.getByText('Custom fields')).toBeInTheDocument();
  });
});
