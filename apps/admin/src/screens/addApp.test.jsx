import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Apps the customer adds themselves (server: billing/selfServeApps.ts): on at once, a prorated invoice opens to pay. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast }));

import PlanChange from './PlanChange';

const plan = { ownedApps: ['accounting'], mayChangePlan: true, mayStopPlan: true, subscription: { status: 'active', currentPeriodEnd: '2026-12-10T00:00:00Z', cancelAtPeriodEnd: false } };
const PEOPLE = {
  appCode: 'people',
  appName: 'People',
  plans: [
    { code: 'people-starter', name: 'People Starter', description: 'Records and the employee app.', unit: 'EMPLOYEE', includedUnits: 10, startAt: 10, basePrice: 30000, extraUnitPrice: 3000 },
    { code: 'people-growth', name: 'People Growth', description: 'Onboarding, approvals and more.', unit: 'EMPLOYEE', includedUnits: 10, startAt: 10, basePrice: 60000, extraUnitPrice: 6000 },
  ],
};
const PAYROLL = { appCode: 'payroll', appName: 'Payroll', plans: [{ code: 'payroll-starter', name: 'Payroll Starter', description: null, unit: 'EMPLOYEE', includedUnits: 10, startAt: 10, basePrice: 50000, extraUnitPrice: 5000 }] };
const apps = (extra = {}) => ({ open: true, eligible: true, reason: null, code: null, invoiceId: null, period: 'month', payDays: 14, options: [PEOPLE, PAYROLL], addOns: [], ...extra });
const quoteFor = (planCode, quantity) => ({ appCode: planCode.split('-')[0], appName: 'People', planCode, planName: 'People Growth', unit: 'EMPLOYEE', quantity, perPeriod: 150000, period: 'month', from: '2026-11-19', to: '2026-12-09', subtotal: 105000, taxTotal: 18900, total: 123900, dueOn: '2026-12-03', payDays: 14 });

beforeEach(() => {
  fetches.call.mockReset();
  toast.success.mockReset();
});

function serve(a) {
  fetches.call.mockImplementation(async (path, opts) => {
    if (path === '/billing/subscription') return plan;
    if (path === '/billing/seats') return { open: true, eligible: false, code: 'NOT_BY_HEAD' };
    if (path === '/billing/apps' && !opts) return a;
    if (path.startsWith('/billing/apps/quote')) {
      const u = new URLSearchParams(path.split('?')[1]);
      return { quote: quoteFor(u.get('plan'), Number(u.get('quantity'))) };
    }
    if (path === '/billing/apps' && opts?.method === 'POST') return { change: { id: 'c1', status: 'OPEN', appCode: 'people' }, invoice: { id: 'inv7', number: 'CLOR/26-27/0050', total: 123900 } };
    return {};
  });
}

describe('adding an app from Workspace', () => {
  it('chooses the app, its plan and how many, shows the price, adds it and opens the invoice', async () => {
    serve(apps());
    const onInvoice = vi.fn();
    render(<PlanChange onInvoice={onInvoice} />);
    expect(await screen.findByText(/Add People or Payroll to this plan/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add an app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });
    expect(within(dialog).getByRole('radio', { name: 'People' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('radio', { name: /People Growth/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '25' } });
    expect(within(dialog).getByText('₹600.00 each month covers 10 employees; ₹60.00 for each one more.')).toBeInTheDocument();
    expect(await within(dialog).findByText('₹1,239.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/To pay by 3 Dec 2026/)).toBeInTheDocument();
    expect(within(dialog).getByText('₹1,500.00, before GST')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add People · pay ₹1,239.00' }));
    await waitFor(() => expect(onInvoice).toHaveBeenCalledWith('inv7'));
    const sent = fetches.call.mock.calls.find(([p, o]) => p === '/billing/apps' && o?.method === 'POST');
    expect(sent[1].body).toEqual({ plan: 'people-growth', quantity: 25, total: 123900 });
    expect(toast.success).toHaveBeenCalledWith('People added. Invoice CLOR/26-27/0050 is open to pay.');
  });

  it('starts a one-plan app at its own count, with the plan named', async () => {
    serve(apps());
    render(<PlanChange />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add an app' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Payroll' }));
    expect(within(dialog).getByText('Payroll Starter')).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton')).toHaveValue(10);
    expect(within(dialog).getByRole('button', { name: /^Add Payroll/ })).toBeInTheDocument();
  });

  it('marks an app the customer added, and says why when one waits to be paid', async () => {
    serve(apps({ eligible: false, code: 'OPEN', reason: 'People, added on invoice CLOR/26-27/0050, is waiting to be paid. Pay it, then add more.', invoiceId: 'inv7', options: [], addOns: [{ id: 'a1', appCode: 'accounting', appName: 'Books' }] }));
    const onInvoice = vi.fn();
    render(<PlanChange onInvoice={onInvoice} />);
    expect(await screen.findByText(/is waiting to be paid/)).toBeInTheDocument();
    expect(screen.getByText('Apps on this plan: Books (added).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an app' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the invoice' }));
    expect(onInvoice).toHaveBeenCalledWith('inv7');
  });

  it('offers nothing while CLOR has it switched off', async () => {
    serve({ ...apps(), open: false, eligible: false, code: 'OFF', options: [] });
    render(<PlanChange />);
    expect(await screen.findByText(/Apps on this plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an app' })).toBeNull();
  });
});
