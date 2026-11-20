import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsMarkQueue: vi.fn(), opsUnmarkQueue: vi.fn(), opsHome: vi.fn(), opsOverview: vi.fn(), opsHealth: vi.fn(), opsAudit: vi.fn(), opsHandover: vi.fn(), opsWriteHandover: vi.fn() }));
vi.mock('./api', () => api);
const ask = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: (...a) => ask(...a) }));

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

  it('lists paying customers gone quiet and trials nobody came back to, and says yesterday in numbers', async () => {
    api.opsHome.mockResolvedValue({
      ...quiet,
      ticketsOverADay: 2,
      yesterday: { signUps: 12, demos: 1, collected: 12000000, invoicesPaid: 3, lost: 0 },
      work: {
        tickets: { total: 1, items: [{ id: 't1', code: 'T-9', subject: 'Payroll will not run', priority: 'URGENT', assigned: false, createdAt: new Date().toISOString(), customer: 'Kaveri Foods' }] },
        quiet: { total: 7, items: [{ accountId: 'a1', customer: 'Neev Textiles', lastActiveAt: '2026-10-20T05:00:00Z', monthly: 1800000 }, { accountId: 'a2', customer: 'Asha Traders', lastActiveAt: null, monthly: null }] },
        stalled: { total: 1, items: [{ accountId: 'a3', customer: 'Vels Stores', signedUpAt: '2026-11-10T05:00:00Z', trialEndsAt: '2026-12-10T05:00:00Z', lastActiveAt: null }] },
      },
    });
    const go = vi.fn();
    render(<Home go={go} has={() => true} />);
    const quietList = within(await screen.findByRole('list', { name: 'Paying customers gone quiet' }));
    /* What they pay a month sits beside the name: that is what is at stake. */
    expect(quietList.getByText(/18,000/)).toBeInTheDocument();
    expect(quietList.getByText(/Nobody has signed in since/)).toBeInTheDocument();
    expect(quietList.getByText('Nobody has ever signed in')).toBeInTheDocument();
    fireEvent.click(quietList.getByRole('button', { name: 'Neev Textiles' }));
    expect(go).toHaveBeenCalledWith('customers', {}, 'a1');
    fireEvent.click(screen.getByRole('button', { name: 'See all 7: Paying customers gone quiet' }));
    expect(go).toHaveBeenCalledWith('customers', { status: 'active' });
    const stalledList = within(screen.getByRole('list', { name: 'Trials nobody came back to' }));
    expect(stalledList.getByText(/never signed in/)).toBeInTheDocument();
    fireEvent.click(stalledList.getByRole('button', { name: 'Vels Stores' }));
    expect(go).toHaveBeenCalledWith('customers', {}, 'a3');
    expect(screen.getByRole('heading', { name: /2 have waited over a day/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Yesterday').textContent).toMatch(/12 sign-ups · 1 demo request · .*1,20,000.* collected on 3 invoices · 0 customers left/);
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

  /* 20 Nov 2026: two people called the same customer; and a row that cannot move today stayed in the way. */
  it('marks a row "Mine" for everybody to see, and puts one away until tomorrow', async () => {
    const work = {
      invoices: { total: 2, items: [
        { id: 'i1', number: 'CLOR/1', accountId: 'a1', customer: 'Kaveri Foods', total: 590000, dueDate: '2026-11-01T00:00:00Z' },
        { id: 'i2', number: 'CLOR/2', accountId: 'a2', customer: 'Nila Traders', total: 118000, dueDate: '2026-11-05T00:00:00Z' },
      ] },
    };
    api.opsHome.mockResolvedValue({ ...quiet, work, marks: { mine: { 'invoices:i2': { name: 'Asha Rao', me: false } }, later: [] } });
    api.opsMarkQueue.mockImplementation(async (key, kind) => ({ marks: kind === 'MINE' ? { mine: { [key]: { name: 'Me', me: true }, 'invoices:i2': { name: 'Asha Rao', me: false } }, later: [] } : { mine: {}, later: [key] } }));
    render(<Home go={vi.fn()} has={() => true} me={{ role: 'SALES' }} />);
    const second = (await screen.findByRole('button', { name: 'Nila Traders' })).closest('li');
    expect(second).toHaveTextContent('Asha Rao is on it');
    expect(within(second).getByRole('button', { name: 'Take over: Nila Traders' })).toBeInTheDocument();
    /* Taking a row from a colleague asks first, by name; saying no leaves it with them. */
    ask.mockResolvedValueOnce(false);
    fireEvent.click(within(second).getByRole('button', { name: 'Take over: Nila Traders' }));
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Take over from Asha Rao?', confirmLabel: 'Take over' })));
    expect(api.opsMarkQueue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Mine: Kaveri Foods' }));
    expect(api.opsMarkQueue).toHaveBeenCalledWith('invoices:i1', 'MINE');
    expect(await screen.findByRole('button', { name: 'Let go: Kaveri Foods' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not today: Kaveri Foods' }));
    expect(api.opsMarkQueue).toHaveBeenCalledWith('invoices:i1', 'LATER');
    expect(await screen.findByText(/1 row put away until tomorrow/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kaveri Foods' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.getByRole('button', { name: 'Bring back: Kaveri Foods' })).toBeInTheDocument();
  });

  it('a read-only colleague sees who is on a row and has no marks to give', async () => {
    api.opsHome.mockResolvedValue({ ...quiet, work: { invoices: { total: 1, items: [{ id: 'i2', number: 'CLOR/2', accountId: 'a2', customer: 'Nila Traders', total: 118000, dueDate: '2026-11-05T00:00:00Z' }] } }, marks: { mine: { 'invoices:i2': { name: 'Asha Rao', me: false } }, later: [] } });
    render(<Home go={vi.fn()} has={() => true} me={{ role: 'READ_ONLY' }} />);
    expect((await screen.findByRole('button', { name: 'Nila Traders' })).closest('li')).toHaveTextContent('Asha Rao is on it');
    expect(screen.queryByRole('button', { name: /^Mine:|^Take over:|^Not today:/ })).toBeNull();
  });

  /* 20 Nov 2026: one long list for five kinds of staff; each wants their own part first. */
  it('filters the queue by whose work it is, counts each part, and offers only the parts that have rows', async () => {
    const work = {
      invoices: { total: 1, items: [{ id: 'i1', number: 'CLOR/1', accountId: 'a1', customer: 'Kaveri Foods', total: 590000, dueDate: '2026-11-01T00:00:00Z' }] },
      tickets: { total: 1, items: [{ id: 't1', code: 'T-1', subject: 'Payroll will not run', accountId: 'a2', customer: 'Nila Traders', priority: 'URGENT', assigned: false, createdAt: '2026-11-19T06:00:00Z' }] },
      quiet: { total: 1, items: [{ accountId: 'a3', customer: 'Sundar Mills', lastActiveAt: '2026-10-20T06:00:00Z', monthly: 250000 }] },
    };
    api.opsHome.mockResolvedValue({ ...quiet, failedEmails: 2, work, marks: { mine: { 'tickets:t1': { name: 'Me', me: true } }, later: [] } });
    render(<Home go={vi.fn()} has={() => true} me={{ role: 'SUPPORT' }} />);
    const tabs = await screen.findByRole('tablist', { name: 'Whose work' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All', 'Mine (1)', 'Customers (1)', 'Money (1)', 'Support (1)', 'Platform (1)']);
    const shown = () => ['Kaveri Foods', 'Payroll will not run', 'Sundar Mills'].filter((name) => screen.queryByRole('button', { name }));

    expect(shown()).toHaveLength(3);
    expect(screen.getByText('2 emails failed')).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Money (1)' }));
    expect(shown()).toEqual(['Kaveri Foods']);
    expect(screen.queryByText('2 emails failed')).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Platform (1)' }));
    expect(shown()).toEqual([]);
    expect(screen.getByText('2 emails failed')).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Mine (1)' }));
    expect(shown()).toEqual(['Payroll will not run']);

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Customers (1)' }));
    expect(shown()).toEqual(['Sundar Mills']);
  });

  it('shows no filters when the queue is all one part', async () => {
    api.opsHome.mockResolvedValue({ ...quiet, work: { invoices: { total: 1, items: [{ id: 'i1', number: 'CLOR/1', accountId: 'a1', customer: 'Kaveri Foods', total: 590000, dueDate: '2026-11-01T00:00:00Z' }] } }, marks: { mine: {}, later: [] } });
    render(<Home go={vi.fn()} has={() => true} me={{ role: 'BILLING' }} />);
    expect(await screen.findByRole('button', { name: 'Kaveri Foods' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Whose work' })).toBeNull();
  });
});


