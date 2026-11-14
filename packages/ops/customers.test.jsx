import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => Object.fromEntries(
  ['opsAccounts', 'opsAccount', 'opsCancelSubscription', 'opsChangeApps', 'opsCustomerActivity', 'opsCustomerPayments', 'opsCustomerRequests', 'opsCustomerUsers', 'opsExtendTrial', 'opsGrantPlan', 'opsReinstate', 'opsReopenSubscription', 'opsResendInvitation', 'opsSendResetLink', 'opsSignOutEverywhere', 'opsSuspend', 'opsUnlockUser', 'opsResetAuthenticator', 'opsRetryEmails', 'opsCustomerConnections'].map((k) => [k, vi.fn()]),
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
    expect(screen.getByText('Books, People (with Attendance)')).toBeInTheDocument();
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

  it('titles the page with the business and names the owner under it', async () => {
    api.opsAccount.mockResolvedValue(detail({ account: { ...detail().account, name: 'Asha Rao', title: 'Rao Textiles', ownerName: 'Asha Rao' } }));
    render(<CustomerPage id="a1" tab="overview" role="READ_ONLY" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Rao Textiles' })).toBeInTheDocument();
    expect(screen.getByText('Owner: Asha Rao')).toBeInTheDocument();
  });

  it('ticks and holds Attendance when People is ticked, and sends both', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsChangeApps.mockResolvedValue({ apps: ['accounting', 'attendance', 'people'] });
    render(<CustomerPage id="a1" tab="subscription" role="BILLING" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change apps' }));
    fireEvent.click(screen.getByLabelText('People'));
    const attendance = screen.getByRole('checkbox', { name: /Attendance/ });
    expect(attendance).toBeChecked();
    expect(attendance).toBeDisabled();
    expect(screen.getByText('Included with People')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: 'Bought People' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Change apps' }).at(-1));
    await waitFor(() => expect(api.opsChangeApps).toHaveBeenCalledWith('a1', expect.arrayContaining(['accounting', 'people', 'attendance']), 'Bought People'));
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

  it('sends apps given free for approval, and says on the page that a change is waiting', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsChangeApps.mockResolvedValue({ needsApproval: true, approval: { id: 'r1', status: 'PENDING' }, limit: 20 });
    const { unmount } = render(<CustomerPage id="a1" tab="subscription" role="BILLING" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change apps' }));
    expect(screen.getByText(/waits in Approvals until a colleague approves it/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Payroll'));
    fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: 'Trying Payroll' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Change apps' }).at(-1));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Sent for approval. Nothing changes for Rao Textiles until a colleague approves it in Approvals.'));
    unmount();

    api.opsAccount.mockResolvedValue(detail({ waitingApproval: { id: 'r1', kind: 'GRANT', summary: 'Apps changed to Books, Payroll; Payroll free', askedBy: 'Priya Raman', mine: false, createdAt: '2026-11-12T05:00:00Z', expiresAt: '2026-11-15T05:00:00Z' } }));
    render(<CustomerPage id="a1" tab="subscription" role="BILLING" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    const note = await screen.findByText(/Waiting in Approvals: Apps changed to Books, Payroll; Payroll free/);
    expect(note.textContent).toMatch(/Asked by Priya Raman/);
    expect(note.textContent).toMatch(/Nothing changes for Rao Textiles until someone other than the person who asked approves it/);
  });

  it('suspends with a reason, and a suspended customer shows why and offers Resume', async () => {
    api.opsAccount.mockResolvedValueOnce(detail()).mockResolvedValue(detail({ account: { ...detail().account, suspendedAt: '2026-11-10T00:00:00Z', suspendedReason: 'Unpaid' } }));
    api.opsSuspend.mockResolvedValue({ suspended: true });
    render(<CustomerPage id="a1" tab="subscription" role="SUPPORT" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(screen.getByText(/Suspending Rao Textiles stops everyone in it from opening any of its companies, to read or to change anything, until you resume/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Suspend' })[0]).toHaveClass('ws-btn--danger-quiet');
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
    api.opsCustomerRequests.mockResolvedValue({ demoRequests: [{ id: 'd1', name: 'Asha Rao', company: 'Rao Textiles', email: 'asha@rao.in', status: 'ACCOUNT_CREATED', apps: ['people'], message: 'Pay 18 people', createdAt: '2026-11-01T00:00:00Z' }], support: [{ id: 't1', code: 'T-1004', subject: 'Payslip PDF blank', status: 'OPEN', priority: 'URGENT', createdAt: '2026-11-09T00:00:00Z' }] });
    const openDemo = vi.fn();
    const openLink = vi.fn();
    render(<CustomerPage id="a1" tab="requests" role="SALES" back={() => {}} setTab={() => {}} openDemo={openDemo} openLink={openLink} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Asha Rao, Rao Textiles' }));
    expect(openDemo).toHaveBeenCalledWith('d1');
    expect(screen.getByText(/Needs an answer · Urgent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'T-1004 Payslip PDF blank' }));
    expect(openLink).toHaveBeenCalledWith({ page: 'tickets', id: 't1' });
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

  it('lets Support unlock a locked-out user; only the owner may remove an authenticator', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerUsers.mockResolvedValue({
      users: [{ userId: 'u1', name: 'Asha Rao', email: 'asha@rao.in', role: 'OWNER', status: 'active', lastLoginAt: null, authenticator: true, emailConfirmed: true, signedInOn: 1, lockedUntil: '2099-01-01T00:00:00Z', wrongPasswords: 0 }],
      invitations: [],
    });
    api.opsUnlockUser.mockResolvedValue({ unlocked: true });
    api.opsResetAuthenticator.mockResolvedValue({ reset: true, sessionsEnded: 1, told: true });
    const reason = (text) => fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: text } });

    const { unmount } = render(<CustomerPage id="a1" tab="users" role="SUPPORT" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByText('Locked out', { selector: '.ws-pill' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove authenticator' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    reason('Owner rang');
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlock' }).at(-1));
    await waitFor(() => expect(api.opsUnlockUser).toHaveBeenCalledWith('a1', 'u1', 'Owner rang'));
    expect(notify.success).toHaveBeenCalledWith('Asha Rao can sign in again.');
    unmount();

    render(<CustomerPage id="a1" tab="users" role="SUPER_ADMIN" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove authenticator' }));
    expect(screen.getByText(/checking it is really them/)).toBeInTheDocument();
    reason('Lost phone, called the number on file');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove authenticator' }).at(-1));
    await waitFor(() => expect(api.opsResetAuthenticator).toHaveBeenCalledWith('a1', 'u1', 'Lost phone, called the number on file'));
    expect(notify.success).toHaveBeenCalledWith('Authenticator taken off. Signed out on 1 device; they were told by email.');
  });

  it('shows what the customer has connected, and lets Support send failed email again', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerConnections.mockResolvedValue({
      items: [
        { kind: 'Attendance reader', id: 'd1', name: 'Gate 1', state: 'offline', lastAt: '2026-11-01T00:00:00Z', error: null },
        { kind: 'Single sign-on', id: 's1', name: 'Google (OIDC)', state: 'error', lastAt: null, error: 'invalid_client' },
      ],
      credentials: [{ kind: 'API_KEY', status: 'ACTIVE', count: 2 }],
      emailsFailedThisWeek: 3,
      webhooksFailedThisWeek: 0,
      openReaderAlerts: 1,
    });
    api.opsRetryEmails.mockResolvedValue({ tried: 3, sent: 2, stillFailing: 1 });
    render(<CustomerPage id="a1" tab="connections" role="SUPPORT" back={() => {}} setTab={() => {}} openDemo={() => {}} />);
    expect(await screen.findByText('Gate 1')).toBeInTheDocument();
    expect(screen.getByText('2, 2 need a look')).toBeInTheDocument();
    expect(screen.getByText('Not heard from')).toBeInTheDocument();
    expect(screen.getByText(/invalid_client/)).toBeInTheDocument();
    expect(screen.getByText('API keys')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send failed emails again' }));
    fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: 'Their server was down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(api.opsRetryEmails).toHaveBeenCalledWith('a1', 'Their server was down'));
    expect(notify.success).toHaveBeenCalledWith('2 of 3 went. 1 still failing; see Email, Log.');
  });

  it('shows the Timeline by day, hides sign-ins until asked, opens links and loads older events', async () => {
    api.opsAccount.mockResolvedValue(detail());
    api.opsCustomerActivity
      .mockResolvedValueOnce({
        lines: [
          { id: 'inv-1', kind: 'money', at: '2026-11-10T05:00:00Z', what: 'Invoice CLOR/26-27/0042 paid', amount: 118000, tone: 'good', link: { page: 'invoices', id: 'i1' } },
          { id: 'op-1', kind: 'clor', at: '2026-11-10T04:00:00Z', who: 'Ravi, CLOR', what: 'Extended a trial', detail: 'Needs a week' },
          { id: 'se-1', kind: 'sign-in', at: '2026-11-09T05:00:00Z', who: 'asha@rao.in', what: 'Signed in' },
        ],
        older: '2026-11-09T05:00:00Z',
        upcoming: [{ id: 'trial-end', at: '2026-11-20T00:00:00Z', what: 'Trial ends' }],
      })
      .mockResolvedValueOnce({ lines: [{ id: 'start', kind: 'account', at: '2026-10-01T05:00:00Z', what: 'Account created' }], older: null });
    const openLink = vi.fn();
    render(<CustomerPage id="a1" tab="activity" role="READ_ONLY" back={() => {}} setTab={() => {}} openDemo={() => {}} openLink={openLink} />);
    expect(await screen.findByText('Trial ends')).toBeInTheDocument();
    expect(screen.getByText('₹1,180')).toBeInTheDocument();
    expect(screen.queryByText('Signed in')).toBeNull();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'clor' } });
    expect(screen.queryByText('Invoice CLOR/26-27/0042 paid')).toBeNull();
    expect(screen.getByText(/Ravi, CLOR · Needs a week/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invoice CLOR/26-27/0042 paid' }));
    expect(openLink).toHaveBeenCalledWith({ page: 'invoices', id: 'i1' });
    fireEvent.click(screen.getByRole('button', { name: 'Show older events' }));
    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(api.opsCustomerActivity).toHaveBeenLastCalledWith('a1', '2026-11-09T05:00:00Z');
    expect(screen.queryByRole('button', { name: 'Show older events' })).toBeNull();
  });

  it('moves between tabs', async () => {
    api.opsAccount.mockResolvedValue(detail());
    const setTab = vi.fn();
    render(<CustomerPage id="a1" tab="overview" role="READ_ONLY" back={() => {}} setTab={setTab} openDemo={() => {}} />);
    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Subscription', 'Limits', 'Invoices and payments', 'Requests', 'Users', 'Connections', 'Support access', 'Timeline']);
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Users' }));
    expect(setTab).toHaveBeenCalledWith('users');
  });
});
