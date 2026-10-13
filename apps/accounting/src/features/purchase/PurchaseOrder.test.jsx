import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/*
 * Warehouses on, everything else off.
 *
 * The bill form hides its warehouse field unless the feature is on, so a mock
 * that answers false to everything renders a form these tests then cannot
 * find their way around. BillBranch.test.jsx was given a switchable version
 * when that gate arrived; its five siblings were not, and every one of them
 * has been red since.
 */
vi.mock('@ui/permissions/useFeatures', () => ({
  useFeatures: () => ({ isEnabled: (key) => key === 'warehouses' || key === 'branches' }),
}));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
}));

import { PurchaseOrderForm, PurchaseOrdersList } from './index';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Supply Co', displayName: 'Steel Supply Co', gstin: '29BBBBB0000B1Z5' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos', purchasePrice: 100 }],
  purchaseOrders: [],
  bills: [],
  uoms: [],
  gstRates: [],
  ...over,
});

describe('the purchase order line grid', () => {
  const renderForm = (db = dbWith()) =>
    render(<PurchaseOrderForm db={db} setDb={() => {}} currentCompany={COMPANY} onClose={() => {}} />);

  it('carries unit, discount and tax columns', () => {
    renderForm();
    const grid = document.querySelector('table.ui-grid-dense');
    expect(grid).toBeTruthy();
    const heads = within(grid).getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(heads).toEqual(expect.arrayContaining(['Unit', 'Disc %', 'Tax %']));
  });

  /*
   * The discount is not decoration: it changes what the order is worth, and
   * the amount column has to follow it.
   */
  it('takes the discount off the line amount', () => {
    renderForm();
    const row = document.querySelector('[data-line-row="0"]');
    const numbers = row.querySelectorAll('input[type="number"]');
    const [qty, rate, disc] = numbers;
    fireEvent.change(qty, { target: { value: '10' } });
    fireEvent.change(rate, { target: { value: '100' } });
    expect(within(row).getByText(/1,000\.00/)).toBeInTheDocument();
    fireEvent.change(disc, { target: { value: '10' } });
    expect(within(row).getByText(/900\.00/)).toBeInTheDocument();
  });

  it('keeps the last line', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeDisabled();
  });

  it('renders a field the company defined', () => {
    const company = {
      ...COMPANY,
      docSettings: {
        customFields: { invoice: [{ key: 'proj', label: 'Project code', type: 'Text', formPlacement: 'header', printPlacement: 'none' }] },
      },
    };
    render(<PurchaseOrderForm db={dbWith({ companies: [company] })} setDb={() => {}} currentCompany={company} onClose={() => {}} />);
    expect(screen.getByLabelText('Project code')).toBeInTheDocument();
  });
});

describe('the purchase order wears the bill\'s header', () => {
  const BRANCHES = [
    { id: 'b-blr', companyId: 1, name: 'Bengaluru', code: 'BLR' },
    { id: 'b-hyd', companyId: 1, name: 'Hyderabad', code: 'HYD' },
  ];
  const WAREHOUSES = [
    { id: 'w-blr', companyId: 1, name: 'Bengaluru Store', branchId: 'b-blr' },
    { id: 'w-hyd', companyId: 1, name: 'Hyderabad Store', branchId: 'b-hyd' },
  ];
  const renderWithBranches = () =>
    render(
      <PurchaseOrderForm
        db={dbWith()}
        setDb={() => {}}
        currentCompany={COMPANY}
        onClose={() => {}}
        branches={BRANCHES}
        warehouses={WAREHOUSES}
      />
    );

  it('asks which branch, before the warehouse', () => {
    renderWithBranches();
    expect(screen.getByRole('combobox', { name: 'Branch' })).toBeInTheDocument();
  });

  /* A shelf that belongs to another branch is the mis-post the ordering
     exists to stop — same rule as the bill and the return. */
  it('narrows the warehouses to the chosen branch', async () => {
    const user = userEvent.setup();
    renderWithBranches();
    await user.click(screen.getByRole('combobox', { name: 'Branch' }));
    await user.click(screen.getByRole('option', { name: 'Bengaluru' }));
    await user.click(screen.getByRole('combobox', { name: /^Warehouse/ }));
    const panel = screen.getByRole('listbox');
    expect(within(panel).getAllByRole('option').map((o) => o.textContent.trim())).toEqual(['Bengaluru Store']);
  });

  it('keeps the series control on the number field', () => {
    renderWithBranches();
    expect(screen.getByRole('button', { name: /numbering/i })).toBeInTheDocument();
  });
});

describe('printing a purchase order', () => {
  const PO = {
    id: 1,
    companyId: 1,
    number: 'PO-5',
    date: '2026-09-09',
    vendorId: 9,
    vendorName: 'Steel Supply Co',
    items: [{ itemId: '11', description: 'MS Angle 50mm', quantity: 10, rate: 100, gstRate: 18, unit: 'Nos', amount: 1000 }],
    subtotal: 1000,
    total: 1000,
    status: 'Pending',
  };

  const openPaper = () => {
    render(
      <PurchaseOrdersList db={dbWith({ purchaseOrders: [PO] })} setDb={() => {}} openModal={() => {}} currentCompany={COMPANY} />
    );
    // Print lives in the row's actions menu, beside Edit and Convert to Bill.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for PO-5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print purchase order PO-5' }));
    return document.querySelector('.printable');
  };

  /*
   * A purchase order exists to be sent to a vendor. It could not leave the
   * screen, which is the one thing the document is for.
   */
  it('puts the order on paper', () => {
    const paper = openPaper();
    expect(paper).toBeTruthy();
    expect(within(paper).getByText('PURCHASE ORDER')).toBeInTheDocument();
    expect(within(paper).getByText(/PO-5/)).toBeInTheDocument();
    expect(within(paper).getByText('Steel Supply Co')).toBeInTheDocument();
  });

  /* The vendor has to know what to quote back. */
  it('asks the vendor to quote the order number', () => {
    const paper = openPaper();
    expect(within(paper).getByText(/quote this order number/i)).toBeInTheDocument();
  });
});
