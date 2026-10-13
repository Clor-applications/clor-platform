import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));

import SalesOrders from './SalesOrders';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const dbWith = (over = {}) => ({
  companies: [COMPANY],
  customers: [{ id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders', gstin: '29AAAAA0000A1Z5' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos' }],
  salesOrders: [],
  deliveryChallans: [],
  invoices: [],
  uoms: [],
  gstRates: [],
  ...over,
});

const openForm = (db = dbWith()) => {
  const utils = render(<SalesOrders db={db} setDb={() => {}} currentCompany={COMPANY} />);
  fireEvent.click(screen.getByRole('button', { name: /New Sales Order/i }));
  return utils;
};

/*
 * An order is the same shape of document as an invoice and was entered with a
 * quarter of its form. These say the grid, the keyboard and the company's own
 * fields are all present — the three things it was missing.
 */
describe('the sales order line grid', () => {
  it('carries the columns the invoice grid carries', () => {
    openForm();
    const grid = document.querySelector('table.ui-grid-dense');
    expect(grid).toBeTruthy();
    const heads = within(grid).getAllByRole('columnheader').map((th) => th.textContent.trim());
    expect(heads).toEqual(expect.arrayContaining([expect.stringContaining('Description'), 'Unit', 'Disc %', 'Tax %']));
  });

  it('adds a line and removes it again', () => {
    openForm();
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(1);
    /* Named as the invoice names it — the same control on every document. */
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }));
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(1);
  });

  /* The last line has nowhere to put the cursor back, so it stays. */
  it('will not remove the only line', () => {
    openForm();
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeDisabled();
  });
});

describe('the sales order keyboard', () => {
  /*
   * Enter inside the grid opens the next line. Before this the form had no
   * key handling at all, so Enter submitted the half-typed order.
   */
  it('opens the next line on Enter inside the grid', () => {
    openForm();
    const firstQty = document.querySelector('[data-line-row="0"] input[type="number"]');
    fireEvent.keyDown(firstQty, { key: 'Enter' });
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(2);
  });

  /* Ctrl+= is the add-line chord the other document forms answer to. */
  it('adds a line on Ctrl+=', () => {
    openForm();
    fireEvent.keyDown(document.querySelector('form'), { key: '=', ctrlKey: true });
    expect(document.querySelectorAll('[data-line-row]')).toHaveLength(2);
  });
});

describe('sales order custom fields', () => {
  const withField = (formPlacement) =>
    dbWith({
      companies: [
        {
          ...COMPANY,
          docSettings: {
            customFields: { invoice: [{ key: 'po_ref', label: 'Customer PO ref', type: 'Text', formPlacement, printPlacement: 'none' }] },
          },
        },
      ],
    });

  /*
   * The fields were defined for invoices and stored under that key. An order
   * is where a customer's PO number actually arrives, so it inherits them.
   */
  it('renders a field the company defined', () => {
    const db = withField('header');
    render(<SalesOrders db={db} setDb={() => {}} currentCompany={db.companies[0]} />);
    fireEvent.click(screen.getByRole('button', { name: /New Sales Order/i }));
    expect(screen.getByLabelText('Customer PO ref')).toBeInTheDocument();
  });

  /* A field placed under the notes must not surface in the header block. */
  it('honours the placement it was given', () => {
    const db = withField('notes');
    render(<SalesOrders db={db} setDb={() => {}} currentCompany={db.companies[0]} />);
    fireEvent.click(screen.getByRole('button', { name: /New Sales Order/i }));
    const field = screen.getByLabelText('Customer PO ref');
    expect(field.closest('.grid.sm\\:grid-cols-4')).toBeNull();
  });
});

describe('printing a sales order', () => {
  const ORDER = {
    id: 1,
    companyId: 1,
    number: 'SO-7',
    date: '2026-09-09',
    customerId: 5,
    customerName: 'Acme Traders',
    items: [{ itemId: 11, description: 'MS Angle 50mm', quantity: 4, rate: 100, gstRate: 18, taxableAmount: 400 }],
    subtotal: 400,
    cgstTotal: 36,
    sgstTotal: 36,
    gstTotal: 72,
    total: 472,
    status: 'Open',
  };

  /*
   * The one thing an order could not do: leave the screen. Nothing outside
   * invoices and bills could be put on paper at all.
   */
  it('puts the order on paper', async () => {
    render(<SalesOrders db={dbWith({ salesOrders: [ORDER] })} setDb={() => {}} currentCompany={COMPANY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for sales order SO-7' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Print sales order SO-7' }));
    const paper = document.querySelector('.printable');
    expect(paper).toBeTruthy();
    expect(within(paper).getByText('SALES ORDER')).toBeInTheDocument();
    expect(within(paper).getByText(/SO-7/)).toBeInTheDocument();
    expect(within(paper).getByText('Acme Traders')).toBeInTheDocument();
    expect(within(paper).getByText(/Four Hundred Seventy Two/i)).toBeInTheDocument();
  });

  /* An order is not a tax invoice and the paper has to say so. */
  it('does not call itself a tax invoice', async () => {
    render(<SalesOrders db={dbWith({ salesOrders: [ORDER] })} setDb={() => {}} currentCompany={COMPANY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for sales order SO-7' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Print sales order SO-7' }));
    const paper = document.querySelector('.printable');
    expect(within(paper).queryByText('TAX INVOICE')).toBeNull();
    expect(within(paper).getByText(/not a tax invoice/i)).toBeInTheDocument();
  });

  it('keeps row actions inside the three-dot menu', async () => {
    render(<SalesOrders db={dbWith({ salesOrders: [ORDER] })} setDb={() => {}} currentCompany={COMPANY} onConvertToInvoice={() => {}} />);
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    const actions = screen.getByRole('button', { name: 'Actions for sales order SO-7' });
    fireEvent.click(actions);
    expect(actions).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument());
    expect(screen.getByRole('menuitem', { name: 'Convert to Invoice' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Print sales order SO-7' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });
});
