import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  deleteDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
  saveSettlementApi: vi.fn(async () => ({})),
}));
vi.mock('@ui/api/masters', () => ({
  createDeliveryChallan: vi.fn(async () => ({})),
  updateDeliveryChallan: vi.fn(async () => ({})),
}));
vi.mock('@ui/api/recurring', () => ({
  createSchedule: vi.fn(async () => ({})),
  deleteSchedule: vi.fn(async () => ({})),
  listSchedules: vi.fn(async () => ({ schedules: [] })),
  runSchedulesNow: vi.fn(async () => ({ raised: 0 })),
  updateSchedule: vi.fn(async () => ({})),
}));

import { EstimatesList, CreditNotesList } from './index';
import SalesOrders from './SalesOrders';
import DeliveryChallans from './DeliveryChallans';
import RecurringInvoices from './RecurringInvoices';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const db = {
  companies: [COMPANY],
  customers: [{ id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm', gstRate: 18, unit: 'Nos' }],
  estimates: [{ id: 1, companyId: 1, number: 'QT-1', customerName: 'Acme Traders', date: '2026-09-01', dueDate: '2026-12-31', total: 11800, status: 'Sent' }],
  creditNotes: [{ id: 1, companyId: 1, number: 'CN-1', customerName: 'Acme Traders', date: '2026-09-02', total: 1180, status: 'Open', originalInvoiceNumber: 'INV-1' }],
  salesOrders: [{ id: 1, companyId: 1, number: 'SO-1', customerName: 'Acme Traders', date: '2026-09-03', total: 5900, items: [{ itemId: 11, quantity: 2, rate: 2500 }] }],
  deliveryChallans: [{ id: 1, companyId: 1, number: 'DC-1', customerName: 'Acme Traders', date: '2026-09-04', purpose: 'Job Work', value: 4000, status: 'Open', items: [] }],
  recurringTemplates: [],
  invoices: [],
  payments: [],
  uoms: [],
  gstRates: [],
};

const noop = () => {};

/*
 * The five sibling lists, held to the layout Sales Invoices sets.
 *
 * They had drifted into five different screens: a bare heading on one, a
 * PageHeader on another, search in the header here and in a filter band there,
 * no figures and no status tabs on any of them. Moving between two lists of
 * documents in the same product meant learning the page again, and a person
 * who could read the invoice list at a glance could not read the quotation
 * list at all.
 *
 * Each of these is the layout contract, not decoration: the figures, the
 * status tabs with counts, search in the header, page actions behind More, one
 * primary top right, and a single card holding the table.
 */
const PAGES = [
  {
    name: 'Quotations',
    heading: /Quotations/i,
    primary: /New Quotation/i,
    search: /Search quotations/i,
    status: /Quotation status/i,
    render: () => <EstimatesList db={db} setDb={noop} openModal={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Sales Orders',
    heading: /Sales Orders/i,
    primary: /New Sales Order/i,
    search: /Search sales orders/i,
    status: /Sales order status/i,
    render: () => <SalesOrders db={db} setDb={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Delivery Challans',
    heading: /Delivery Challans/i,
    primary: /New Challan/i,
    search: /Search challans/i,
    status: /Challan status/i,
    render: () => <DeliveryChallans db={db} setDb={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Sales Returns',
    heading: /Sales Returns/i,
    primary: /New Credit Note/i,
    search: /Search credit notes/i,
    status: /Credit note status/i,
    render: () => <CreditNotesList db={db} setDb={noop} openModal={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Recurring Invoices',
    heading: /Recurring Invoices/i,
    primary: /New Schedule/i,
    search: /Search schedules/i,
    status: /Schedule status/i,
    render: () => <RecurringInvoices db={db} setDb={noop} currentCompany={COMPANY} />,
  },
];

describe.each(PAGES)('$name, laid out like Sales Invoices', (page) => {
  it('names itself in a page heading', () => {
    page.render && render(page.render());
    expect(screen.getByRole('heading', { name: page.heading })).toBeTruthy();
  });

  it('puts search in the header, where it is on every other list', () => {
    render(page.render());
    expect(screen.getByLabelText(page.search)).toBeTruthy();
  });

  it('carries five figures across the top', () => {
    render(page.render());
    const summary = screen.getByRole('region', { name: /Summary/i });
    // Five, because that is what the row is designed around: fewer leaves a
    // ragged grid, more wraps onto a second line nobody reads.
    expect(summary.children).toHaveLength(5);
  });

  it('puts a compact status dropdown with counts before search', () => {
    render(page.render());
    const status = screen.getByRole('combobox', { name: page.status });
    const search = screen.getByLabelText(page.search);
    expect(status.querySelectorAll('option').length).toBeGreaterThanOrEqual(3);
    for (const option of status.querySelectorAll('option')) expect(option.textContent).toMatch(/\d/);
    expect(status.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps page-level actions behind More', () => {
    render(page.render());
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
  });

  it('has exactly one primary action, top right', () => {
    render(page.render());
    const primaries = screen.getAllByRole('button', { name: page.primary });
    expect(primaries).toHaveLength(1);
    expect(primaries[0].className).toMatch(/ui-btn-primary/);
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = render(page.render());
    const table = container.querySelector('table.ui-table');
    expect(table).toBeTruthy();
    const card = table.closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});

describe('an empty list is centred on what you can see', () => {
  /*
   * The empty state used to sit in a cell spanning the table, and these tables
   * are wider than the screen — so "centred" meant centred across a width that
   * runs off the right-hand edge, and the card drifted left of the view. Out of
   * the table and inside the scroller, its width is the visible width.
   */
  it('the invoice list renders its empty state outside the table', async () => {
    const { InvoicesList } = await import('./index');
    render(<InvoicesList db={db} setDb={noop} openModal={noop} currentCompany={COMPANY} />);
    const pane = document.querySelector('.ui-empty-pane');
    expect(pane).toBeTruthy();
    expect(pane.closest('table')).toBeNull();
    expect(within(pane).getByText('No invoices yet')).toBeInTheDocument();
  });

  it('and so does the quotation list', () => {
    /* The shared fixture has a quotation in it; this one must not. */
    render(<EstimatesList db={{ ...db, estimates: [] }} setDb={noop} openModal={noop} currentCompany={COMPANY} />);
    const pane = document.querySelector('.ui-empty-pane');
    expect(pane).toBeTruthy();
    expect(pane.closest('table')).toBeNull();
    expect(within(pane).getByText('No quotations yet')).toBeInTheDocument();
  });
});

describe('the recurring schedule narrowings remain compact', () => {
  /*
   * They were a band across the page — a strip of controls in a card of their
   * own above the table, which is the one piece of furniture the shared shell
   * has no slot for. The status row was already on the screen with an empty
   * right half, so that is where they went.
   */
  it('keeps customer, frequency and the date window on the screen', () => {
    render(
      <RecurringInvoices db={db} setDb={noop} currentCompany={COMPANY} branches={[]} warehouses={[]} />
    );
    expect(screen.getByRole('combobox', { name: 'Customer' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Frequency' })).toBeTruthy();
    expect(screen.getByLabelText('Next invoice date from')).toBeTruthy();
    expect(screen.getByLabelText('Next invoice date to')).toBeTruthy();
  });

  it('keeps them together in one compact row above the table', () => {
    render(
      <RecurringInvoices db={db} setDb={noop} currentCompany={COMPANY} branches={[]} warehouses={[]} />
    );
    const row = screen.getByRole('combobox', { name: 'Customer' }).parentElement;
    expect(row.contains(screen.getByRole('combobox', { name: 'Customer' }))).toBe(true);
    expect(row.className).toContain('flex');
  });

  it('still narrows the list', () => {
    render(
      <RecurringInvoices db={db} setDb={noop} currentCompany={COMPANY} branches={[]} warehouses={[]} />
    );
    /* The control is bound to the filtering, not decoration: choosing a
       frequency no schedule has empties the list. */
    fireEvent.change(screen.getByRole('combobox', { name: 'Frequency' }), { target: { value: 'YEARLY' } });
    expect(screen.getByText(/No recurring schedules|Nothing matches/i)).toBeTruthy();
  });

  it('opens the same window from the column it narrows', () => {
    render(
      <RecurringInvoices db={db} setDb={noop} currentCompany={COMPANY} branches={[]} warehouses={[]} />
    );
    fireEvent.click(screen.getByLabelText('Sort and filter Next invoice date'));
    expect(screen.getAllByLabelText('Next invoice date from')).toHaveLength(2);
  });
});
