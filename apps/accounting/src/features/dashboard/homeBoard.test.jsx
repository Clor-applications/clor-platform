import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { PermissionContext } from '@ui/permissions/context';
import DashboardOverview from './DashboardOverview';

/**
 * Home, once the books are running.
 *
 * The setup list answers "what do I still have to do". This answers "what is
 * happening", and the day the last setup step is ticked the screen has to
 * become the second one — which is the whole point of the state.
 *
 * Every figure here is checked against the fixture rather than against itself:
 * a panel that renders is worth nothing if the number in it is not the one the
 * books hold.
 */

const co = { id: 1, name: 'Mani beriyanis', state: 'Karnataka' };
const iso = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const running = {
  companies: [co],
  invoices: [
    /* Overdue by nine days. */
    { id: 1, companyId: 1, number: 'INV-0042', customerName: 'Acme Pvt Ltd', date: iso(-12), dueDate: iso(-9), total: 48500, balance: 48500, status: 'Sent' },
    /* Falls due inside the week. */
    { id: 2, companyId: 1, number: 'INV-0041', customerName: 'Kumar Traders', date: iso(-6), dueDate: iso(4), total: 18900, balance: 18900, status: 'Sent' },
    /* Falls due well beyond it. */
    { id: 3, companyId: 1, number: 'INV-0040', customerName: 'Fresh Farms', date: iso(-20), dueDate: iso(30), total: 273750, balance: 273750, status: 'Sent' },
  ],
  bills: [{ id: 1, companyId: 1, number: 'BILL-019', vendorName: 'ABC Supplies', date: iso(-4), dueDate: iso(3), total: 22400, balance: 22400, status: 'Open' }],
  payments: [],
  chartOfAccounts: [],
  customers: [{ id: 1, companyId: 1, name: 'Acme Pvt Ltd' }],
  items: [],
  journalEntries: [],
};

const fresh = { ...running, invoices: [], bills: [], customers: [], payments: [] };

/**
 * Home only offers what the person may do, so the screen is rendered inside a
 * permission context. The default is an owner who may do everything; a test
 * about a restricted person passes its own `can`.
 */
const asUser = (can = () => true) => ({
  loading: false,
  error: '',
  permissions: new Set(),
  roles: [],
  restrictions: { branchIds: [], warehouseIds: [] },
  can,
  canAny: (keys) => (Array.isArray(keys) ? keys : [keys]).some(can),
  canModule: (mod) => can(`${mod}::`),
  reload: () => {},
});

const renderHome = (db, props = {}, permissions = asUser()) =>
  render(
    <PermissionContext.Provider value={permissions}>
      <DashboardOverview
        db={db}
        currentCompany={co}
        userName="manickam"
        onNewInvoice={() => {}}
        onOpenInvoices={() => {}}
        onNavigate={() => {}}
        {...props}
      />
    </PermissionContext.Provider>
  );

describe('the screen follows the state of the books', () => {
  it('shows the setup list while nothing has been billed', () => {
    renderHome(fresh);
    expect(screen.getByText('Finish setting up')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Things to do' })).toBeNull();
  });

  it('shows what is happening once a book is running', () => {
    renderHome(running);
    expect(screen.queryByText('Finish setting up')).toBeNull();
    for (const panel of ['Total Sales', 'Total Purchases', 'Total Expenses', 'Net Profit', 'Income vs Expense', 'Sales by Category', 'Bank & Cash Balance', 'Receivables (Customers)', 'Payables (Vendors)', 'Recent Transactions']) {
      expect(screen.getByRole('region', { name: panel })).toBeInTheDocument();
    }
  });

  it('shows the same dashboard when purchases exist before the first sale', () => {
    renderHome({ ...running, invoices: [] });
    expect(screen.queryByText('Finish setting up')).toBeNull();
    expect(screen.getByRole('region', { name: 'Total Purchases' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent Transactions' })).toBeInTheDocument();
  });

  it('changes the dashboard period and exposes custom dates without a settings button', () => {
    renderHome(running);
    const period = screen.getByRole('combobox', { name: 'Dashboard period' });
    expect(period).toHaveValue('month');
    expect(screen.queryByLabelText('Custom period start')).toBeNull();
    fireEvent.change(period, { target: { value: 'custom' } });
    expect(screen.getByRole('dialog', { name: 'Select custom period' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom period start')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom period end')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog', { name: 'Select custom period' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
  });
});

describe('the figures are the ones the books hold', () => {
  it('lists the customers who owe money with their balances', () => {
    renderHome(running);
    const panel = screen.getByRole('region', { name: 'Receivables (Customers)' });
    expect(within(panel).getByText('Acme Pvt Ltd').closest('li').textContent).toContain('48,500');
    expect(within(panel).getByText('Kumar Traders').closest('li').textContent).toContain('18,900');
    expect(within(panel).getByText('Fresh Farms').closest('li').textContent).toContain('2,73,750');
  });

  it('lists the vendors who are owed money', () => {
    renderHome(running);
    const panel = screen.getByRole('region', { name: 'Payables (Vendors)' });
    expect(within(panel).getByText('ABC Supplies').closest('li').textContent).toContain('22,400');
  });

  it('shows overdue days beside the customer who needs follow-up', () => {
    renderHome(running);
    const receivables = screen.getByRole('region', { name: 'Receivables (Customers)' });
    expect(within(receivables).getByText(/Overdue 9 days/)).toBeInTheDocument();
  });

  it('names the last documents raised, newest first', () => {
    renderHome(running);
    const rows = within(screen.getByRole('region', { name: 'Recent Transactions' })).getAllByRole('listitem');
    const numbers = rows.map((r) => r.textContent);
    expect(numbers[0]).toContain('BILL-019');
    expect(numbers[1]).toContain('INV-0041');
  });
});

describe('a panel with nothing in it says so', () => {
  it('does not print a zero where there is no answer', () => {
    renderHome({ ...running, invoices: running.invoices.slice(0, 1), bills: [] });
    const payables = screen.getByRole('region', { name: 'Payables (Vendors)' });
    expect(within(payables).getByText('No vendor balance is outstanding.')).toBeInTheDocument();
    expect(within(payables).queryByText(/₹0/)).toBeNull();
  });
});

describe('the screen offers only what the person may do', () => {
  const salesOnly = asUser((key) => String(key).startsWith('SALES::'));

  it('hides the bill and report shortcuts from someone with sales rights only', () => {
    renderHome(running, { onNewBill: () => {}, onOpenReports: () => {}, onRecordReceipt: () => {} }, salesOnly);
    expect(screen.queryByRole('button', { name: 'New bill' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reports' })).toBeNull();
    expect(screen.queryByText(/of bills due this week/)).toBeNull();
    // The running-books home (Oct 2026 layout) has no shortcut row; its only
    // ways out are the panels' "View all" links, gated the same way.
    const viewAll = (panel) => within(screen.getByRole('region', { name: panel })).queryByRole('button', { name: /View all/ });
    expect(viewAll('Receivables (Customers)')).toBeInTheDocument();
    expect(viewAll('Payables (Vendors)')).toBeNull();
    expect(viewAll('Recent Transactions')).toBeNull();
  });

  it('keeps a setup step the person cannot do on the list, marked for an administrator', () => {
    renderHome(fresh, {}, salesOnly);
    expect(screen.getAllByText('Needs an administrator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('New invoice').length).toBeGreaterThan(0);
  });
});
