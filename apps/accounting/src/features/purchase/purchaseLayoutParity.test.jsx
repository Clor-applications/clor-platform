import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/api/purchaseDocs', () => ({
  createDocApi: vi.fn(async () => ({})),
  deleteDocApi: vi.fn(async () => ({})),
  hasApiSession: () => false,
  saveSettlementApi: vi.fn(async () => ({})),
  updateDocApi: vi.fn(async () => ({})),
}));

import { BillsList, PurchaseOrdersList, DebitNotesList } from './index';
import PurchaseOverview from './PurchaseOverview';

const COMPANY = { id: 1, name: 'Neev Steels', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' };

const db = {
  companies: [COMPANY],
  vendors: [{ id: 9, companyId: 1, name: 'Steel Depot', displayName: 'Steel Depot' }],
  items: [{ id: 11, companyId: 1, name: 'MS Angle 50mm' }],
  bills: [
    { id: 1, companyId: 1, number: 'BILL-1', vendorId: 9, vendorName: 'Steel Depot', date: '2026-09-02', dueDate: '2026-09-20', total: 23600, paidAmount: 10000, status: 'Partial', items: [] },
  ],
  purchaseOrders: [
    { id: 1, companyId: 1, number: 'PO-1', vendorId: 9, vendorName: 'Steel Depot', date: '2026-09-01', total: 59000, status: 'Open', items: [] },
  ],
  debitNotes: [
    { id: 1, companyId: 1, number: 'DN-1', vendorId: 9, vendorName: 'Steel Depot', date: '2026-09-03', total: 1180, status: 'Open' },
  ],
  invoices: [], expenses: [], payments: [], customers: [], uoms: [], gstRates: [],
};

const noop = () => {};

/*
 * The purchase lists, held to the layout the invoice list sets — the same
 * contract the sales siblings and the CRM screens are held to.
 */
const PAGES = [
  {
    name: 'Purchase Invoices',
    heading: /Purchase Invoices/i,
    primary: /New Bill/i,
    search: /Search bills/i,
    render: () => <BillsList db={db} setDb={noop} openModal={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Purchase Orders',
    heading: /Purchase Orders/i,
    primary: /New PO/i,
    search: /Search purchase orders/i,
    render: () => <PurchaseOrdersList db={db} setDb={noop} openModal={noop} currentCompany={COMPANY} />,
  },
  {
    name: 'Purchase Returns',
    heading: /Purchase Returns/i,
    primary: /New Debit Note/i,
    search: /Search debit notes/i,
    render: () => <DebitNotesList db={db} setDb={noop} openModal={noop} currentCompany={COMPANY} />,
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
    expect(screen.getByRole('region', { name: /Summary/i }).children).toHaveLength(5);
  });

  it('offers status filtering: a dropdown on bills, counted tabs elsewhere', () => {
    render(page.render());
    if (page.name === 'Purchase Invoices') {
      /* A compact dropdown, as on Sales Invoices: plain status names, no
         counts (InvoicesList and Bills both, since the import, 00f6a61a).
         The tab lists below keep their counts. */
      const status = screen.getByRole('combobox', { name: /Bill status/i });
      const search = screen.getByLabelText(page.search);
      expect(status.querySelectorAll('option').length).toBeGreaterThanOrEqual(3);
      expect(status.querySelector('option').textContent).toBe('All');
      expect(status.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return;
    }
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    for (const tab of tabs) expect(tab.textContent).toMatch(/\d/);
  });

  it('keeps page-level actions behind More', () => {
    render(page.render());
    expect(screen.getByRole('button', { name: /^More$/i })).toBeTruthy();
  });

  it('has exactly one primary action', () => {
    render(page.render());
    const primaries = screen.getAllByRole('button', { name: page.primary });
    expect(primaries).toHaveLength(1);
    expect(primaries[0].className).toMatch(/ui-btn-primary/);
  });

  it('lines the row up with the header it sits under', () => {
    // The columns were reordered to match the invoice list and the row cells
    // were not, so the Date column showed a dash and the reference date showed
    // the bill's date.
    const { container } = render(page.render());
    const heads = [...container.querySelectorAll('thead th')].length;
    const firstRow = [...container.querySelectorAll('tbody tr')][0];
    expect(firstRow.querySelectorAll('td')).toHaveLength(heads);
  });

  it('puts the rows in one card, not a card inside a card', () => {
    const { container } = render(page.render());
    const card = container.querySelector('table.ui-table').closest('.ui-card');
    expect(card).toBeTruthy();
    expect(card.parentElement.closest('.ui-card')).toBeNull();
  });
});

/*
 * The overview shipped as a placeholder beside a Sales page with six figures
 * and two charts. It answers the mirror question now, off the same furniture.
 *
 * Updated 30 Oct 2026 to the overview as shipped (unchanged since the import,
 * 00f6a61a, and the same shape as Sales Overview): a period picker, four
 * figures, a trend and a category panel, and vendor payables by age. The
 * "Compare: Previous Period" line, the six-figure row and the Performance /
 * Breakdowns / Recent Bills panels it used to check are not on either
 * overview. The payable guard is unchanged.
 */
describe('the purchase overview', () => {
  it('reads like the sales one: a period, four figures, panels', () => {
    render(<PurchaseOverview db={db} currentCompany={COMPANY} />);

    expect(screen.getByRole('heading', { name: /Purchase Overview/i })).toBeTruthy();
    /* The period picker, which governs every figure below it. */
    expect(screen.getAllByRole('button').some((b) => b.getAttribute('aria-haspopup') === 'listbox')).toBe(true);
    for (const label of ['Total Purchases', 'Bills', 'Debit Notes', 'Active Vendors']) {
      expect(screen.getByRole('article', { name: label })).toBeTruthy();
    }
    for (const title of ['Purchase Trend', 'Purchases by Category', 'Vendor Payables (Outstanding)']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('counts a payable as what is left on the bill', () => {
    // The overview opens on this month; the fixture bill is from September.
    // Without a fixed clock this passed only while September lasted.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));
    try {
      // 23,600 billed less 10,000 paid. Counting the billed figure would say the
      // business owes money it has already sent.
      render(<PurchaseOverview db={db} currentCompany={COMPANY} />);
      const insights = screen.getByRole('complementary', { name: 'Payables insights' });
      const outstanding = within(insights).getByText('Total Outstanding').closest('div');
      expect(outstanding.textContent).toMatch(/13,600/);
    } finally {
      vi.useRealTimers();
    }
  });
});
