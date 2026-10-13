import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const featureState = vi.hoisted(() => ({ branches: true, warehouses: true }));
vi.mock('@ui/permissions/useFeatures', () => ({
  useFeatures: () => ({ isEnabled: (key) => key === 'branches' ? featureState.branches : key === 'warehouses' ? featureState.warehouses : false }),
}));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  updateDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import { BillForm } from './index';

/**
 * A bill belongs to a place.
 *
 * The form already needed a branch — it scopes the number series and it is
 * what the purchase is filed under — but it was reading one out of whichever
 * warehouse happened to be chosen. A company with one warehouse serving two
 * branches, or a bill for something that never touches a shelf, had no way to
 * say where the purchase belongs. These tests hold the sales invoice's
 * arrangement: branch asked first, warehouses narrowed to it, the leftover
 * warehouse dropped rather than carried across.
 */

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const BRANCHES = [
  { id: 'b-blr', companyId: 1, name: 'Bengaluru', code: 'BLR' },
  { id: 'b-hyd', companyId: 1, name: 'Hyderabad', code: 'HYD' },
];

const WAREHOUSES = [
  { id: 'w-blr', companyId: 1, name: 'Bengaluru Store', branchId: 'b-blr' },
  { id: 'w-hyd', companyId: 1, name: 'Hyderabad Store', branchId: 'b-hyd' },
];

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co', gstin: '29BBBBB0000B1Z5' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
  bills: [],
  purchaseOrders: [],
  batches: [],
  uoms: [],
  gstRates: [],
  ...over,
});

const renderForm = (props = {}) =>
  render(
    <BillForm
      db={dbWith()}
      setDb={() => {}}
      currentCompany={COMPANY}
      warehouses={WAREHOUSES}
      branches={BRANCHES}
      onClose={() => {}}
      {...props}
    />
  );

/** The combobox under a given label on the form. */
const fieldNamed = (name) => screen.getByRole('combobox', { name });

/** What the open panel is offering. */
const optionLabels = () =>
  screen.getAllByRole('option').map((o) => o.textContent.replace(/\s+/g, ' ').trim());

describe('the branch on a bill', () => {
  /* The form remembers the last branch chosen, as the invoice does — so each
     test starts from a company nobody has raised a document for yet. */
  beforeEach(() => {
    localStorage.clear();
    featureState.branches = true;
    featureState.warehouses = true;
  });

  it('asks for one', () => {
    renderForm();
    expect(fieldNamed('Branch')).toBeInTheDocument();
  });

  it('offers the branches it was given', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(fieldNamed('Branch'));
    expect(optionLabels()).toEqual(expect.arrayContaining(['All branches', 'Bengaluru', 'Hyderabad']));
  });

  /*
   * The reason the two fields sit in that order: goods received onto a shelf
   * belonging to another branch is the mis-post this is here to stop.
   */
  it('offers every warehouse while no branch is chosen', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(fieldNamed('Warehouse *'));
    expect(optionLabels()).toEqual(expect.arrayContaining(['Bengaluru Store', 'Hyderabad Store']));
  });

  it('narrows the warehouses to the chosen branch', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(fieldNamed('Branch'));
    await user.click(screen.getByRole('option', { name: 'Bengaluru' }));

    await user.click(fieldNamed('Warehouse *'));
    expect(optionLabels()).toEqual(['Bengaluru Store']);
  });

  it('drops a warehouse that belongs to the branch just left', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(fieldNamed('Warehouse *'));
    await user.click(screen.getByRole('option', { name: 'Hyderabad Store' }));
    expect(fieldNamed('Warehouse *')).toHaveTextContent('Hyderabad Store');

    await user.click(fieldNamed('Branch'));
    await user.click(screen.getByRole('option', { name: 'Bengaluru' }));

    expect(fieldNamed('Warehouse *')).toHaveTextContent('Select Warehouse');
  });

  it('keeps a warehouse that belongs to the branch just chosen', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(fieldNamed('Warehouse *'));
    await user.click(screen.getByRole('option', { name: 'Bengaluru Store' }));

    await user.click(fieldNamed('Branch'));
    await user.click(screen.getByRole('option', { name: 'Bengaluru' }));

    expect(fieldNamed('Warehouse *')).toHaveTextContent('Bengaluru Store');
  });

  /* Branch and warehouse answer one question — where — so they share a line,
     and the vendor's name gets the width it needs underneath. */
  it('puts branch and warehouse on one row, above the vendor', () => {
    renderForm();
    const branchField = document.querySelector('#bill-branch-field');
    expect(branchField).toBeTruthy();
    const row = branchField.parentElement;
    expect(row.className).toMatch(/sm:grid-cols-2/);
    expect(within(row).getByRole('combobox', { name: 'Warehouse *' })).toBeInTheDocument();
    expect(within(row).queryByText('Select Vendor')).toBeNull();
  });

  it('shows the default branch and warehouse as locked when both features are disabled', () => {
    featureState.branches = false;
    featureState.warehouses = false;
    renderForm({ defaultWarehouseId: 'w-blr' });

    expect(screen.queryByRole('combobox', { name: 'Branch' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Warehouse *' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Branch' })).toHaveValue('Bengaluru');
    expect(screen.getByRole('textbox', { name: 'Warehouse' })).toHaveValue('Bengaluru Store');
  });

  it('shows only the selector for the enabled feature', () => {
    featureState.branches = false;
    featureState.warehouses = true;
    renderForm({ defaultWarehouseId: 'w-blr' });
    expect(screen.queryByRole('combobox', { name: 'Branch' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Branch' })).toHaveValue('Bengaluru');
    expect(screen.getByRole('textbox', { name: 'Warehouse' })).toHaveValue('Bengaluru Store');
  });
});
