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
  createSalesman: vi.fn(async () => ({})),
  deactivateSalesman: vi.fn(async () => ({})),
  createCustomer: vi.fn(async () => ({})),
  updateCustomer: vi.fn(async () => ({})),
  createVendor: vi.fn(async () => ({})),
  updateVendor: vi.fn(async () => ({})),
}));
vi.mock('../../api/share', () => ({ createInvoiceShareLink: vi.fn(async () => ({})) }));

import CustomersList from './CustomersList';
import VendorsList from './VendorsList';
import Salesmen from '../sales/Salesmen';
import PaymentReminders from '../sales/PaymentReminders';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const db = {
  companies: [COMPANY],
  customers: [
    { id: 5, companyId: 1, name: 'Acme Traders', displayName: 'Acme Traders', gstin: '29AAAAA0000A1Z5', mobile: '9000000001' },
    { id: 6, companyId: 1, name: 'Coastal Fab', displayName: 'Coastal Fab', gstRegistration: 'Unregistered' },
  ],
  vendors: [
    { id: 9, companyId: 1, name: 'Steel Depot', displayName: 'Steel Depot', gstin: '29BBBBB0000B1Z5' },
  ],
  salesmen: [{ id: 3, companyId: 1, name: 'R. Iyer', phone: '9000000009', commissionPct: 2 }],
  invoices: [
    { id: 1, companyId: 1, number: 'INV-1', customerId: 5, customerName: 'Acme Traders', date: '2026-08-01', dueDate: '2026-08-15', total: 11800, subtotal: 10000, paidAmount: 0, status: 'Unpaid', salesmanId: 3 },
    // Not yet due, so outstanding and overdue differ — otherwise one figure
    // standing in for the other passes a test that proves nothing.
    { id: 2, companyId: 1, number: 'INV-2', customerId: 5, customerName: 'Acme Traders', date: '2026-09-01', dueDate: '2099-12-31', total: 5000, subtotal: 4300, paidAmount: 0, status: 'Unpaid', salesmanId: 3 },
  ],
  bills: [
    { id: 1, companyId: 1, number: 'BILL-1', vendorId: 9, date: '2026-08-01', dueDate: '2026-08-20', total: 5900, paidAmount: 1000, status: 'Partial' },
  ],
  estimates: [], creditNotes: [], debitNotes: [], purchaseOrders: [], expenses: [], payments: [], uoms: [], gstRates: [],
};

const noop = () => {};

/*
 * The CRM screens, held to the same layout contract as the document lists.
 *
 * Customers and Vendors carried a stored `balance` nothing maintained, so both
 * showed ₹0.00 against every name while the invoice list showed lakhs owed by
 * the same customers. What each party owes is now read off the documents, and
 * the four screens are laid out like every other list in the product.
 */
const PAGES = [
  {
    name: 'Customers',
    heading: /Customers/i,
    primary: /New Customer/i,
    search: /Search customers/i,
    hasKpis: false,
    render: () => <CustomersList db={db} setDb={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Vendors',
    heading: /Vendors/i,
    primary: /New Vendor/i,
    search: /Search vendors/i,
    render: () => <VendorsList db={db} setDb={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Salesmen',
    heading: /Salesmen/i,
    primary: /Add salesman/i,
    search: /Search salesmen/i,
    render: () => <Salesmen db={db} setDb={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Payment Reminders',
    heading: /Payment Reminders/i,
    primary: null,
    search: /Search collectibles/i,
    render: () => <PaymentReminders db={db} setDb={noop} currentCompany={COMPANY} />,
  },
];

describe.each(PAGES)('$name, laid out like every other list', (page) => {
  it('names itself in a page heading', () => {
    render(page.render());
    expect(screen.getByRole('heading', { name: page.heading })).toBeTruthy();
  });

  it('puts search in the header', () => {
    render(page.render());
    expect(screen.getByLabelText(page.search)).toBeTruthy();
  });

  it('carries five figures across the top', () => {
    render(page.render());
    if (page.hasKpis === false) {
      expect(screen.queryByRole('region', { name: /Summary/i })).toBeNull();
      return;
    }
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('offers its filters in the page header with counts', () => {
    render(page.render());
    const filter = screen.queryByRole('combobox');
    if (filter) {
      expect(filter.options.length).toBeGreaterThanOrEqual(3);
      expect(filter.value).toBe(filter.options[0].value);
      for (const option of filter.options) expect(option.textContent.trim().length).toBeGreaterThan(0);
      return;
    }
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps page-level actions behind More', () => {
    render(page.render());
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = render(page.render());
    const card = container.querySelector('table.ui-table').closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});

describe('what the party lists say about money', () => {
  it('opens the complete customer page from a customer row', () => {
    render(<CustomersList db={db} setDb={noop} currentCompany={COMPANY} />);
    fireEvent.click(screen.getByText('Acme Traders'));

    expect(screen.getByRole('heading', { name: 'Acme Traders' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tablist', { name: 'Customer information' })).getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Basic Details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
    expect(screen.getByLabelText('Transaction type')).toBeTruthy();
    expect(screen.getByLabelText('Transaction period')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Transaction period'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('Custom period from')).toBeTruthy();
    expect(screen.getByLabelText('Custom period to')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Custom period from'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Custom period to'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByLabelText('Custom period from')).toBeNull();
    expect(screen.getByLabelText('Transaction period').selectedOptions[0].textContent).toContain('2026-08-01');
    expect(screen.getByText('INV-1')).toBeTruthy();
    for (const heading of ['Date', 'Type', 'Voucher No.', 'Debit', 'Credit', 'Balance']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeTruthy();
    }
  });

  it('shows what a customer actually owes, not a stored zero', () => {
    // The old column read the `balance` field, which nothing ever wrote to.
    render(<CustomersList db={db} setDb={noop} currentCompany={COMPANY} />);
    const cells = [...screen.getByText('Acme Traders').closest('tr').querySelectorAll('td')];
    // 11,800 overdue plus 5,000 not yet due. The overdue column beside it
    // carries only the first, so the two cannot stand in for each other.
    expect(cells[5].textContent).toMatch(/16,800/);
    expect(cells[6].textContent).toMatch(/11,800/);
  });

  it('marks the part of it that is late', () => {
    render(<CustomersList db={db} setDb={noop} currentCompany={COMPANY} />);
    const overdue = [...screen.getByRole('combobox', { name: 'Customer filter' }).options].find((option) => /Overdue/.test(option.textContent));
    expect(overdue.textContent).toMatch(/1/);
  });

  it('shows the vendor side as what is still payable on the bill', () => {
    // 5,900 billed less 1,000 paid. Showing the billed figure would have
    // somebody pay a vendor twice.
    render(<VendorsList db={db} setDb={noop} currentCompany={COMPANY} />);
    const row = screen.getByText('Steel Depot').closest('tr');
    expect(row.textContent).toMatch(/4,900/);
  });
});
