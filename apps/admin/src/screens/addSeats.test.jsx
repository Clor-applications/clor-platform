import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Seats the customer adds themselves (server: billing/selfServe.ts): on at once, a prorated invoice opens to pay. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast }));

import PlanChange from './PlanChange';

const plan = { ownedApps: ['people', 'attendance'], mayChangePlan: true, mayStopPlan: true, subscription: { status: 'active', currentPeriodEnd: '2026-12-10T00:00:00Z', cancelAtPeriodEnd: false } };
const open = (extra = {}) => ({ open: true, eligible: true, reason: null, code: null, invoiceId: null, unit: 'USER', quantity: 3, maxPerChange: 20, payDays: 14, changes: [], ...extra });
const QUOTE = { add: 2, unit: 'USER', quantityNow: 3, quantityAfter: 5, perPeriodMore: 100000, period: 'month', from: '2026-11-18', to: '2026-12-09', subtotal: 73333, taxTotal: 13200, total: 86533, dueOn: '2026-12-02', payDays: 14, planName: 'Growth' };

beforeEach(() => {
  fetches.call.mockReset();
  toast.success.mockReset();
});

function serve(seats, extra = {}) {
  fetches.call.mockImplementation(async (path, opts) => {
    if (path === '/billing/subscription') return plan;
    if (path === '/billing/seats' && !opts) return seats;
    if (path.startsWith('/billing/seats/quote')) return { quote: { ...QUOTE, add: Number(path.split('add=')[1]) } };
    if (path === '/billing/seats' && opts?.method === 'POST') return extra.post ?? { change: { id: 'c1', status: 'OPEN', added: 2, toQuantity: 5 }, invoice: { id: 'inv9', number: 'CLOR/26-27/0042', total: 86533 } };
    return {};
  });
}

describe('adding users from Workspace', () => {
  it('shows the price, adds them, and opens the invoice to pay', async () => {
    serve(open());
    const onInvoice = vi.fn();
    render(<PlanChange onInvoice={onInvoice} />);
    expect(await screen.findByText(/This plan is paid for 3 users/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add users' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add users' });
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '2' } });
    expect(within(dialog).getByText('3 users now, 5 users after.')).toBeInTheDocument();
    expect(await within(dialog).findByText('₹865.33')).toBeInTheDocument();
    expect(within(dialog).getByText(/To pay by 2 Dec 2026/)).toBeInTheDocument();
    expect(within(dialog).getByText('₹1,000.00 more, before GST')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 users' }));
    await waitFor(() => expect(onInvoice).toHaveBeenCalledWith('inv9'));
    const sent = fetches.call.mock.calls.find(([p, o]) => p === '/billing/seats' && o?.method === 'POST');
    expect(sent[1].body).toEqual({ add: 2, total: 86533 });
    expect(toast.success).toHaveBeenCalledWith('2 users added. Invoice CLOR/26-27/0042 is open to pay.');
  });

  it('holds the count to the cap and asks nothing past it', async () => {
    serve(open({ maxPerChange: 5 }));
    render(<PlanChange />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add users' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '9' } });
    expect(within(dialog).getByText('From 1 to 5 at a time. For more, ask CLOR.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add users' })).toBeDisabled();
  });

  it('says why when seats wait to be paid, with the invoice to open', async () => {
    serve(open({ eligible: false, code: 'OPEN', reason: '2 users added on invoice CLOR/26-27/0042 are waiting to be paid. Pay it, then add more.', invoiceId: 'inv9' }));
    const onInvoice = vi.fn();
    render(<PlanChange onInvoice={onInvoice} />);
    expect(await screen.findByText(/are waiting to be paid/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add users' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the invoice' }));
    expect(onInvoice).toHaveBeenCalledWith('inv9');
  });

  it('offers nothing while CLOR has it switched off', async () => {
    serve({ ...open(), open: false, eligible: false, code: 'OFF' });
    render(<PlanChange />);
    expect(await screen.findByText(/Apps on this plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add (users|employees)/ })).toBeNull();
  });
});
