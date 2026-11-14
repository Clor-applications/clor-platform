import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsHome: vi.fn(), opsOverview: vi.fn(), opsHealth: vi.fn(), opsAudit: vi.fn() }));
vi.mock('./api', () => api);

import { Home } from './Home';

const overview = { accounts: 412, paying: 287, trialsEndingIn7d: 23, legacy: 61, newThisWeek: 9 };
const health = {
  workers: [
    { worker: 'notify.email', state: 'failing', lastStartedAt: new Date().toISOString(), failedToday: 218, lastError: 'Provider 429s' },
    { worker: 'billing.renew', state: 'ok', lastStartedAt: new Date().toISOString(), failedToday: 0, lastError: null },
  ],
};
const audit = { events: [{ id: 'e1', at: new Date().toISOString(), label: 'Extended a trial', operator: { fullName: 'Suresh N' }, accountName: 'Kaveri Foods', summary: '#4821 · GST onboarding pending' }] };

beforeEach(() => {
  api.opsOverview.mockResolvedValue(overview);
  api.opsHealth.mockResolvedValue(health);
  api.opsAudit.mockResolvedValue(audit);
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
    expect(screen.getByText('Fail-open: must move to a plan')).toBeInTheDocument();
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

  it('still shows the rest when one part cannot load', async () => {
    api.opsHome.mockResolvedValue({ newDemos: 0, demosToday: 0, trialsEnding: 0, failedPayments: 0, failedEmails: 0, suspended: 0, overdue: 0 });
    api.opsAudit.mockRejectedValue(new Error('Not for your role.'));
    render(<Home go={vi.fn()} has={() => false} />);
    expect(await screen.findByText('Nothing needs a staff member right now.')).toBeInTheDocument();
    expect(await screen.findByText('Not for your role.')).toBeInTheDocument();
    expect(await screen.findByText('412')).toBeInTheDocument();
  });
});
