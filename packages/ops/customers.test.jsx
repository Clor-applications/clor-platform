import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => Object.fromEntries(
  ['opsAccounts', 'opsAccount', 'opsCancelSubscription', 'opsChangeApps', 'opsCustomerActivity', 'opsCustomerPayments', 'opsCustomerRequests', 'opsCustomerUsers', 'opsExtendTrial', 'opsGrantPlan', 'opsReinstate', 'opsReopenSubscription', 'opsResendInvitation', 'opsSendResetLink', 'opsSignOutEverywhere', 'opsSuspend'].map((k) => [k, vi.fn()]),
));
vi.mock('./api', () => api);
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify, confirmDialog: vi.fn(() => Promise.resolve(true)) }));

import { CustomerPage, Customers, customerStatus } from './Customers';

const row = {
  id: 'a1', name: 'Rao Textiles', code: '4831920657', owner: { name: 'Asha Rao', email: 'asha@rao.in' }, apps: ['accounting', 'people'],
  plan: 'trialing', trialEndsAt: '2099-11-20T00:00:00Z', renewsAt: null, interval: null, byHand: true, users: 3, lastActiveAt: null, createdAt: '2026-11-01T00:00:00Z',
};
const detail = (over = {}) => ({
  account: { id: 'a1', name: 'Rao Textiles', code: '4831920657', createdAt: '2026-11-01T00:00:00Z', suspendedAt: null, suspendedReason: null, legacyUnrestrictedAt: null },
  members: [{ userId: 'u1', role: 'OWNER', name: 'Asha Rao', email: 'asha@rao.in', lastLoginAt: null }],
  companies: [{ id: 'o1', name: 'Rao Textiles', code: '1234567890', createdAt: '2026-11-01T00:00:00Z', people: 3, branches: [{ id: 'b1', name: 'Head office', code: 'HO', state: 'Karnataka' }] }],
  lastActiveAt: null,
  subscription: { status: 'trialing', trialEndsAt: '2099-11-20T00:00:00Z', currentPeriodStart: null, currentPeriodEnd: null, billingInterval: null, gateway: null, createdAt: '2026-11-01T00:00:00Z', apps: ['accounting'] },
  securityEvents: [],
  operatorEvents: [],
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  notify.success.mockReset();
});

describe('Customers', () => {
  it('lists customers with owner, apps, plan, status, trial end, users and last sign-in, and filters', async () => {
    api.opsAccounts.mockResolvedValue({ total: 1, page: 0, pageSize: 25, accounts: [row] });
    const open = vi.fn();
    render(<Customers openCustomer={open} />);
    expect(await screen.findByText('Rao Textiles')).toBeInTheDocument();
    expect(screen.getByText('asha@rao.in')).toBeInTheDocument();
    expect(screen.getByText('Books, People')).toBeInTheDocument();
    expect(screen.getByText('Set by hand')).toBeInTheDocument();
    expect(screen.getByText('Trial', { selector: '.ws-pill' })).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'overdue' } });
    await waitFor(() => expect(api.opsAccounts).toHaveBeenLastCalledWith({ q: '', status: 'overdue', page: 0 }));
    fireEvent.change(screen.getByPlaceholderText('Name, company ID or owner email'), { target: { value: 'asha@' } });
    await waitFor(() => expect(api.opsAccounts).toHaveBeenLastCalledWith({ q: 'asha@', status: 'overdue', page: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Rao Textiles' }));
    expect(open).toHaveBeenCalledWith('a1');
  });

  it('calls a trial that has run out overdue', () => {
    expect(customerStatus('trialing', '2020-01-01')).toBe('overdue');
    expect(customerStatus('trialing', '2099-01-01')).toBe('trialing');
  });
});

describe('a customer’s page', () => {
  it('shows owner, companies and branches on Overview', async () => {
    api.opsAccount.mockResolvedValue(detail());
    render(<CustomerPage id="a1" tab="overview" role="READ_ONLY" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Rao Textiles' })).toBeInTheDocument();
    expect(screen.getByText('asha@rao.in')).toBeInTheDocument();
    expect(screen.getByText(/Branches: Head office \(Karnataka\)/)).toBeInTheDocument();
    expect(screen.getByText('Nobody has signed in yet')).toBeInTheDocument();
  });

  it('lets Finance change apps with a reason, and offers read-only nothing', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsChangeApps.mockResolvedValue({ apps: ['accounting', 'payroll'] });
    const { unmount } = render(<CustomerPage id="a1" tab="subscription" role="BILLING" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change apps' }));
    fireEvent.click(screen.getByLabelText('Payroll'));
    const submit = () => screen.getAllByRole('button', { name: 'Change apps' }).at(-1);
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: 'Bought Payroll' } });
    fireEvent.click(submit());
    await waitFor(() => expect(api.opsChangeApps).toHaveBeenCalledWith('a1', ['accounting', 'payroll'], 'Bought Payroll'));
    expect(notify.success).toHaveBeenCalledWith('Apps changed.');
    unmount();

    render(<CustomerPage id="a1" tab="subscription" role="READ_ONLY" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByText('Your role can look at this subscription but not change it.')).toBeInTheDocument();
  });

  it('suspends with a reason, and a suspended customer shows why and offers Resume', async () => {
    api.opsAccount.mockResolvedValueOnce(detail()).mockResolvedValue(detail({ account: { ...detail().account, suspendedAt: '2026-11-10T00:00:00Z', suspendedReason: 'Unpaid' } }));
    api.opsSuspend.mockResolvedValue({ suspended: true });
    render(<CustomerPage id="a1" tab="subscription" role="SUPPORT" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(screen.getByText(/Nobody in this account can open any of its companies until you resume it/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: 'Unpaid' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' }).at(-1));
    await waitFor(() => expect(api.opsSuspend).toHaveBeenCalledWith('a1', 'Unpaid'));
    expect(await screen.findByText(/Suspended on .*: Unpaid/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('shows an empty Invoices and payments tab in plain words', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerPayments.mockResolvedValue({ invoices: [], payments: [] });
    render(<CustomerPage id="a1" tab="money" role="BILLING" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByText(/No invoices or payments yet/)).toBeInTheDocument();
  });

  it('lists the demo request on Requests and opens it', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerRequests.mockResolvedValue({ demoRequests: [{ id: 'd1', name: 'Asha Rao', company: 'Rao Textiles', email: 'asha@rao.in', status: 'ACCOUNT_CREATED', apps: ['people'], message: 'Pay 18 people', createdAt: '2026-11-01T00:00:00Z' }], support: [] });
    const openDemo = vi.fn();
    render(<CustomerPage id="a1" tab="requests" role="SALES" back={() => {}} setTab={() => {}} openDemo={openDemo} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Asha Rao, Rao Textiles' }));
    expect(openDemo).toHaveBeenCalledWith('d1');
    expect(screen.getByText(/does not take support messages in the app yet/)).toBeInTheDocument();
  });

  it('lets Support send a reset link, sign out everywhere and resend an invitation', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerUsers.mockResolvedValue({
      users: [{ userId: 'u1', name: 'Asha Rao', email: 'asha@rao.in', role: 'OWNER', status: 'active', lastLoginAt: null, authenticator: false, emailConfirmed: true, signedInOn: 2 }],
      invitations: [{ id: 'i1', email: 'ravi@rao.in', accountRole: 'MEMBER', status: 'PENDING', expiresAt: '2099-01-01', lastSentAt: '2026-11-01', sendCount: 1, expired: false }],
    });
    api.opsSendResetLink.mockResolvedValue({ sent: true, email: 'asha@rao.in' });
    api.opsSignOutEverywhere.mockResolvedValue({ sessionsEnded: 2 });
    api.opsResendInvitation.mockResolvedValue({});
    render(<CustomerPage id="a1" tab="users" role="SUPPORT" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    const reason = (text) => fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: text } });

    fireEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    reason('Locked out');
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(api.opsSendResetLink).toHaveBeenCalledWith('a1', 'u1', 'Locked out'));
    expect(notify.success).toHaveBeenCalledWith('Reset link sent to asha@rao.in. It works for 30 minutes.');

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    reason('Lost phone');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1));
    await waitFor(() => expect(api.opsSignOutEverywhere).toHaveBeenCalledWith('a1', 'u1', 'Lost phone'));
    expect(notify.success).toHaveBeenCalledWith('Signed out on 2 devices.');

    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite' }));
    reason('Never got it');
    fireEvent.click(screen.getAllByRole('button', { name: 'Resend invite' }).at(-1));
    await waitFor(() => expect(api.opsResendInvitation).toHaveBeenCalledWith('a1', 'i1', 'Never got it'));
  });

  it('shows Activity and narrows it to what CLOR did', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerActivity.mockResolvedValue({
      lines: [
        { id: 'op-1', kind: 'clor', at: '2026-11-10T05:00:00Z', who: 'Ravi', what: 'Extended a trial', detail: 'Needs a week' },
        { id: 'se-1', kind: 'sign-in', at: '2026-11-09T05:00:00Z', who: 'asha@rao.in', what: 'Signed in', detail: '' },
      ],
    });
    render(<CustomerPage id="a1" tab="activity" role="READ_ONLY" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'clor' } });
    expect(screen.queryByText('Signed in')).toBeNull();
    expect(screen.getByText(/Ravi, CLOR .* Needs a week/)).toBeInTheDocument();
  });

  it('moves between tabs', async () => {
    api.opsAccount.mockResolvedValue(detail());
    const setTab = vi.fn();
    render(<CustomerPage id="a1" tab="overview" role="READ_ONLY" back={() => {}} setTab={setTab} openDemo={() => {}} />);
    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Subscription', 'Invoices and payments', 'Requests', 'Users', 'Activity']);
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Users' }));
    expect(setTab).toHaveBeenCalledWith('users');
  });
});
