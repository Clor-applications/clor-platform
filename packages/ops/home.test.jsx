import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsHome: vi.fn(), opsOverview: vi.fn(), opsHealth: vi.fn(), opsAudit: vi.fn(), opsHandover: vi.fn(), opsWriteHandover: vi.fn() }));
vi.mock('./api', () => api);

import { Home } from './Home';

const overview = { accounts: 412, paying: 287, trialsEndingIn7d: 23, legacy: 61, newThisWeek: 9 };
const health = {
  workers: [
    { worker: 'notify.email', state: 'failing', lastStartedAt: new Date().toISOString(), failedToday: 218, lastError: 'Provider 429s' },
    { worker: 'billing.renew', state: 'ok', lastStartedAt: new Date().toISOString(), failedToday: 0, lastError: null },
  ],
};
const quiet = { newDemos: 0, demosToday: 0, followUpsDue: 0, trialsEnding: 0, failedPayments: 0, failedEmails: 0, suspended: 0, overdue: 0, alertsOpen: 0, alertsCritical: 0, ticketsOpen: 0 };
const audit = { events: [{ id: 'e1', at: new Date().toISOString(), label: 'Extended a trial', operator: { fullName: 'Suresh N' }, accountName: 'Kaveri Foods', summary: '#4821 · GST onboarding pending' }] };

beforeEach(() => {
  api.opsOverview.mockResolvedValue(overview);
  api.opsHealth.mockResolvedValue(health);
  api.opsAudit.mockResolvedValue(audit);
  api.opsHandover.mockResolvedValue({ note: null });
});

describe('Overview', () => {
  it('shows the four numbers, the services, what needs action and what staff did, each opening its place', async () => {
    api.opsHome.mockResolvedValue({ newDemos: 3, demosToday: 1, trialsEnding: 1, failedPayments: 0, failedEmails: 2, suspended: 0, overdue: 1 });
    const go = vi.fn();
    render(<Home go={go} has={(k) => k !== 'trials' && k !== 'payments'} />);
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(await screen.findByText('412')).toBeInTheDocument();
    expect(screen.getByText('+9 this week')).toBeInTheDocument();
    expect(screen.getByText('70% of accounts')).toBeInTheDocument();
    expect(screen.getByText('Every app is open to them: move each to a plan')).toBeInTheDocument();
    expect(await screen.findByText('Notify email')).toBeInTheDocument();
    expect(screen.getByText('Failing')).toBeInTheDocument();
    expect(await screen.findByText('3 new requests wait for a call · 1 came in today')).toBeInTheDocument();
    expect(screen.getByText('1 trial ends in the next 7 days')).toBeInTheDocument();
    expect(screen.getByText('2 emails this week did not go')).toBeInTheDocument();
    /* Nothing failed in payments, so it is not listed as needing action. */
    expect(screen.queryByText(/could not be applied/)).toBeNull();
    expect(await screen.findByText(/Reason: #4821/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Failed emails' }));
    expect(go).toHaveBeenCalledWith('emailLog', { status: 'FAILED' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Trials ending this week' }));
    expect(go).toHaveBeenCalledWith('customers', { status: 'trialing' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Demo requests' }));
    expect(go).toHaveBeenCalledWith('demos');
    fireEvent.click(screen.getByRole('button', { name: /Paying/ }));
    expect(go).toHaveBeenCalledWith('customers', { status: 'active' });
  });

  it('opens Trials and Payments once the console has them, and says when nothing needs action', async () => {
    api.opsHome.mockResolvedValue({ newDemos: 0, demosToday: 0, trialsEnding: 0, failedPayments: 1, failedEmails: 0, suspended: 0, overdue: 0 });
    const go = vi.fn();
    render(<Home go={go} has={() => true} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Failed payments' }));
    expect(go).toHaveBeenCalledWith('payments');
    fireEvent.click(screen.getByRole('button', { name: /Trials ending in 7 days/ }));
    expect(go).toHaveBeenCalledWith('trials');
    fireEvent.click(screen.getByRole('button', { name: 'Post an announcement' }));
    expect(go).toHaveBeenCalledWith('announcements');
  });

  it('lists the work itself, each row opening the thing and each "See all" its list already filtered', async () => {
    const DAY = 86_400_000;
    const soon = new Date(Date.now() + 2.5 * DAY).toISOString();
    api.opsHome.mockResolvedValue({
      ...quiet,
      trialsEnding: 9,
      ticketsOpen: 6,
      approvalsWaiting: 1,
      invoicesOverdue: 7,
      work: {
        trials: { total: 9, items: [{ accountId: 'a1', customer: 'Rao Textiles', trialEndsAt: soon }] },
        invoices: { total: 7, items: [{ id: 'i1', number: 'CLOR/26-27/0042', accountId: 'a2', customer: 'Kaveri Foods', total: 1180000, dueDate: new Date(Date.now() - 12.5 * DAY).toISOString() }] },
        tickets: {
          total: 6,
          items: [
            { id: 't1', code: 'T-1042', subject: 'Payroll will not run', accountId: 'a2', customer: 'Kaveri Foods', priority: 'URGENT', assigned: true, createdAt: new Date(Date.now() - 2 * DAY).toISOString() },
            { id: 't2', code: 'T-1050', subject: 'How do I add a branch', accountId: 'a1', customer: 'Rao Textiles', priority: 'NORMAL', assigned: false, createdAt: new Date().toISOString() },
          ],
        },
        approvals: { total: 1, items: [{ id: 'p1', kindWord: 'Subscription deal', summary: 'Growth, yearly, 40% off', accountId: 'a1', customer: 'Rao Textiles', askedBy: 'Meena', createdAt: new Date().toISOString() }] },
        payments: { total: 1, items: [{ id: 'e1', what: 'Payment received', accountId: null, customer: null, amount: 59000, detail: 'No customer matches this payment', at: new Date().toISOString() }] },
      },
    });
    const go = vi.fn();
    render(<Home go={go} has={() => true} />);
    expect(await screen.findByRole('heading', { name: 'Needs you today' })).toBeInTheDocument();

    /* A trial opens the account's Subscription tab; "See all" opens Trials narrowed to the same week. */
    const trials = within(screen.getByRole('list', { name: 'Trials ending this week' }));
    expect(trials.getByText('3 days left')).toBeInTheDocument();
    fireEvent.click(trials.getByRole('button', { name: 'Rao Textiles' }));
    expect(go).toHaveBeenLastCalledWith('customers', {}, 'a1', 'subscription');
    fireEvent.click(screen.getByRole('button', { name: 'See all 9: Trials ending this week' }));
    expect(go).toHaveBeenLastCalledWith('trials', { ending: '7' });

    /* An invoice shows who, its number, the amount and how late, and opens the invoice. */
    const invoices = within(screen.getByRole('list', { name: 'Overdue invoices' }));
    expect(invoices.getByText('CLOR/26-27/0042')).toHaveClass('ui-mono');
    expect(invoices.getByText(/12 days overdue/)).toBeInTheDocument();
    expect(invoices.getByText('₹11,800')).toHaveClass('tabular-nums', 'text-right');
    fireEvent.click(invoices.getByRole('button', { name: 'Kaveri Foods' }));
    expect(go).toHaveBeenLastCalledWith('invoices', {}, 'i1');
    fireEvent.click(screen.getByRole('button', { name: 'See all 7: Overdue invoices' }));
    expect(go).toHaveBeenLastCalledWith('invoices', { status: 'OVERDUE' });

    /* Tickets: urgent first, each with its state in words; the link names what it opens, without a number. */
    const tickets = within(screen.getByRole('list', { name: 'Tickets: urgent or not taken' }));
    expect(tickets.getAllByRole('listitem').map((li) => li.querySelector('.ws-pill').textContent)).toEqual(['Urgent', 'Not taken']);
    fireEvent.click(tickets.getByRole('button', { name: 'Payroll will not run' }));
    expect(go).toHaveBeenLastCalledWith('tickets', {}, 't1');
    fireEvent.click(screen.getByRole('button', { name: 'All tickets: Tickets: urgent or not taken' }));
    expect(go).toHaveBeenLastCalledWith('tickets');

    /* One approval, all of it shown: no "See all". */
    const approvals = within(screen.getByRole('list', { name: 'Approvals waiting' }));
    expect(approvals.getByText('Subscription deal · Rao Textiles · asked by Meena')).toBeInTheDocument();
    fireEvent.click(approvals.getByRole('button', { name: 'Growth, yearly, 40% off' }));
    expect(go).toHaveBeenLastCalledWith('approvals');
    expect(screen.queryByRole('button', { name: /Approvals waiting$/ })).toBeNull();

    /* A payment matched to nobody opens the Payments log. */
    const payments = within(screen.getByRole('list', { name: 'Failed payments' }));
    expect(payments.getByText('₹590')).toBeInTheDocument();
    fireEvent.click(payments.getByRole('button', { name: 'Payment received' }));
    expect(go).toHaveBeenLastCalledWith('payments');

    /* What is listed is not counted a second time underneath. */
    expect(screen.queryByRole('button', { name: 'Open Tickets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Trials ending this week' })).toBeNull();
  });

  it('shows only the groups that have something in them', async () => {
    api.opsHome.mockResolvedValue({
      ...quiet,
      ticketsOpen: 4,
      work: { trials: { total: 0, items: [] }, invoices: { total: 1, items: [{ id: 'i1', number: 'CLOR/26-27/0042', accountId: 'a2', customer: 'Kaveri Foods', total: 1180000, dueDate: '2026-01-01' }] }, tickets: { total: 0, items: [] }, approvals: { total: 0, items: [] }, payments: { total: 0, items: [] } },
    });
    const go = vi.fn();
    render(<Home go={go} has={() => true} />);
    expect(await screen.findByRole('list', { name: 'Overdue invoices' })).toBeInTheDocument();
    for (const name of ['Trials ending this week', 'Tickets: urgent or not taken', 'Approvals waiting', 'Failed payments']) expect(screen.queryByRole('heading', { name })).toBeNull();
    expect(screen.queryByRole('button', { name: /^See all/ })).toBeNull();
    /* Four open tickets, all taken and none urgent: still said, as a number that opens Tickets. */
    fireEvent.click(screen.getByRole('button', { name: 'Open Tickets' }));
    expect(go).toHaveBeenLastCalledWith('tickets');
  });

  it('still shows the rest when one part cannot load', async () => {
    api.opsHome.mockResolvedValue({ newDemos: 0, demosToday: 0, trialsEnding: 0, failedPayments: 0, failedEmails: 0, suspended: 0, overdue: 0 });
    api.opsAudit.mockRejectedValue(new Error('Not for your role.'));
    render(<Home go={vi.fn()} has={() => false} />);
    expect(await screen.findByText('Nothing needs you today.')).toBeInTheDocument();
    expect(await screen.findByText('Not for your role.')).toBeInTheDocument();
    expect(await screen.findByText('412')).toBeInTheDocument();
  });
});
