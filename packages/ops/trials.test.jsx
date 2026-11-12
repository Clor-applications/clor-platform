import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ accounts: vi.fn(), signups: vi.fn(), extend: vi.fn(), grant: vi.fn(), resend: vi.fn() }));
vi.mock('./api', () => ({
  opsAccounts: (p) => api.accounts(p),
  opsSignups: (p) => api.signups(p),
  opsExtendTrial: (id, days, reason) => api.extend(id, days, reason),
  opsGrantPlan: (id, body) => api.grant(id, body),
  opsResendSignup: (id) => api.resend(id),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Trials, daysLeft } from './Trials';

const DAY = 86_400_000;
const rao = { id: 'a1', name: 'Rao Textiles', code: '4831920657', owner: { name: 'Asha Rao', email: 'asha@rao.in' }, apps: ['accounting', 'people', 'attendance'], plan: 'trialing', trialEndsAt: new Date(Date.now() + 3 * DAY).toISOString(), lastActiveAt: null, companies: 1, users: 1 };
const signups = {
  total: 2,
  page: 0,
  pageSize: 25,
  counts: { PENDING: 1, CONFIRMED: 1 },
  offer: { apps: [{ code: 'accounting', name: 'Books' }, { code: 'people', name: 'People' }], trialDays: 14, planCode: null, source: 'default' },
  signups: [
    { id: 's1', email: 'new@one.in', app: 'people', status: 'PENDING', sendCount: 1, createdAt: '2026-11-09T05:00:00Z', accountId: null },
    { id: 's2', email: 'asha@rao.in', app: 'accounting', status: 'CONFIRMED', sendCount: 1, createdAt: '2026-11-08T05:00:00Z', accountId: 'a1', companyName: 'Rao Textiles', apps: ['accounting', 'people', 'attendance'], trialDays: 14 },
  ],
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.accounts.mockResolvedValue({ total: 1, page: 0, pageSize: 25, accounts: [rao] });
  api.signups.mockResolvedValue(signups);
});

describe('Trials in the operator console', () => {
  it('counts the days left in plain words', () => {
    expect(daysLeft(new Date(Date.now() + 3 * DAY).toISOString())).toBe('3 days left');
    expect(daysLeft(new Date(Date.now() + 0.5 * DAY).toISOString())).toBe('1 day left');
    expect(daysLeft(new Date(Date.now() - 0.2 * DAY).toISOString())).toBe('ends today');
    expect(daysLeft(new Date(Date.now() - 1.5 * DAY).toISOString())).toBe('ended yesterday');
    expect(daysLeft(new Date(Date.now() - 2.5 * DAY).toISOString())).toBe('ended 2 days ago');
  });

  it('lists accounts on trial with the days left, and the sign-ups from clor.in with what the offer is', async () => {
    render(<Trials role="SUPPORT" openAccount={() => {}} />);
    expect((await screen.findAllByRole('button', { name: 'Rao Textiles' })).length).toBe(2);
    expect(api.accounts).toHaveBeenCalledWith({ status: 'trialing' });
    expect(screen.getByText('1 on trial · 1 ending within a week')).toBeInTheDocument();
    expect(screen.getByText('3 days left')).toBeInTheDocument();
    expect(screen.getByText('Books, People, Attendance')).toBeInTheDocument();
    expect(screen.getByText(/A trial from clor.in runs 14 days with Books, People\. No prices are published yet/)).toBeInTheDocument();
    expect(screen.getByText('new@one.in')).toBeInTheDocument();
    expect(screen.getByText('Link sent')).toBeInTheDocument();
    expect(screen.getByText('Account made')).toBeInTheDocument();
    /* Support sends a link again, but neither extends nor converts. */
    expect(screen.queryByRole('button', { name: 'Extend trial' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument();
    api.resend.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'Send link again' }));
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith('s1'));
  });

  it('lets Billing extend a trial with a reason, and convert it to an active plan set by hand', async () => {
    api.extend.mockResolvedValue({ trialEndsAt: new Date(Date.now() + 17 * DAY).toISOString() });
    api.grant.mockResolvedValue({});
    render(<Trials role="BILLING" openAccount={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Extend trial' }));
    expect(await screen.findByRole('heading', { name: 'Extend the trial' })).toBeInTheDocument();
    const extend = screen.getAllByRole('button', { name: 'Extend trial' }).pop();
    expect(extend).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Asked for a week more' } });
    fireEvent.click(extend);
    await waitFor(() => expect(api.extend).toHaveBeenCalledWith('a1', 14, 'Asked for a week more'));

    fireEvent.click(await screen.findByRole('button', { name: 'Convert' }));
    expect(await screen.findByRole('heading', { name: 'Convert to a paid plan' })).toBeInTheDocument();
    expect(screen.getByText(/Only CLOR can do this/)).toBeInTheDocument();
    /* The trial's apps are ticked already; Payroll is added. */
    fireEvent.click(screen.getByLabelText(/Payroll/));
    fireEvent.click(screen.getAllByRole('button', { name: 'Convert' }).pop());
    await waitFor(() =>
      expect(api.grant).toHaveBeenCalledWith('a1', {
        apps: [{ appCode: 'accounting', priceModel: 'free' }, { appCode: 'people', priceModel: 'free' }, { appCode: 'attendance', priceModel: 'free' }, { appCode: 'payroll', priceModel: 'free' }],
        status: 'active',
      }),
    );
  });
});
