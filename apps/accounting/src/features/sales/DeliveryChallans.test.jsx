import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/masters', () => ({
  createDeliveryChallan: vi.fn(async () => ({})),
  updateDeliveryChallan: vi.fn(async () => ({})),
}));

import DeliveryChallans from './DeliveryChallans';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  customers: [{ id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', unit: 'Nos', salePrice: 100 }],
  deliveryChallans: [],
  uoms: [],
  gstRates: [],
  ...over,
});

const openForm = (db = dbWith()) => {
  render(<DeliveryChallans db={db} setDb={() => {}} currentCompany={COMPANY} />);
  fireEvent.click(screen.getByRole('button', { name: /New Challan/i }));
};

describe('the delivery challan line grid', () => {
  it('carries a description and a unit, not just a quantity and a rate', () => {
    openForm();
    const grid = document.querySelector('table.ui-grid-dense');
    expect(grid).toBeTruthy();
    const heads = within(grid).getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(heads).toEqual(expect.arrayContaining([expect.stringContaining('Description'), 'Unit']));
  });

  it('adds and removes lines', () => {
    openForm();
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }));
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(1);
  });
});

describe('the delivery challan keyboard', () => {
  /* Typed at a loading bay against a waiting lorry — the worst place to find
     that Enter submits the document. */
  it('opens the next line on Enter inside the grid', () => {
    openForm();
    const qty = document.querySelector('[data-line-row="0"] input[type="number"]');
    fireEvent.keyDown(qty, { key: 'Enter' });
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(2);
  });
});

describe('printing a delivery challan', () => {
  const CHALLAN = {
    id: 1,
    companyId: 1,
    number: 'DC-4',
    date: '2026-09-09',
    customerId: 5,
    customerName: 'Acme Traders',
    purpose: 'Job Work',
    vehicleNo: 'KA01AB1234',
    items: [{ itemId: 11, description: 'MS Angle 50mm', quantity: 4, rate: 100, unit: 'Nos' }],
    value: 400,
    status: 'Open',
  };

  const openPaper = () => {
    render(<DeliveryChallans db={dbWith({ deliveryChallans: [CHALLAN] })} setDb={() => {}} currentCompany={COMPANY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print challan DC-4' }));
    return document.querySelector('.printable');
  };

  /*
   * The document that most needed paper and had none. A challan rides with the
   * consignment and is handed over at the gate; it existed only on screen.
   */
  it('puts the challan on paper with its vehicle number', () => {
    const paper = openPaper();
    expect(paper).toBeTruthy();
    expect(within(paper).getByText('DELIVERY CHALLAN')).toBeInTheDocument();
    expect(within(paper).getByText(/DC-4/)).toBeInTheDocument();
    expect(within(paper).getByText('KA01AB1234')).toBeInTheDocument();
  });

  /* No GST is charged on a challan, so no tax column may appear on it. */
  it('prints no tax column', () => {
    const paper = openPaper();
    const heads = within(paper).getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(heads).not.toContain('Tax %');
    expect(within(paper).getByText(/Rule 55/)).toBeInTheDocument();
  });

  /* The consignee, not "Bill To" — the goods are going somewhere, not being sold. */
  it('names the consignee', () => {
    const paper = openPaper();
    expect(within(paper).getByText('Consignee')).toBeInTheDocument();
    expect(within(paper).getByText('Acme Traders')).toBeInTheDocument();
  });
});
