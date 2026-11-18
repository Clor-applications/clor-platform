import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { listInvitations: vi.fn(), createInvitation: vi.fn(), resendInvitation: vi.fn(), revokeInvitation: vi.fn() };
vi.mock('@platform/admin/account', () => ({
  listInvitations: (...a) => api.listInvitations(...a),
  createInvitation: (...a) => api.createInvitation(...a),
  resendInvitation: (...a) => api.resendInvitation(...a),
  revokeInvitation: (...a) => api.revokeInvitation(...a),
}));

const roles = { listRoles: vi.fn() };
vi.mock('@platform/admin/admin', () => ({ listRoles: (...a) => roles.listRoles(...a) }));

import Invitations, { accessPreview } from './Invitations';

const tenant = { id: 'c1', name: 'Anand Traders', accountId: 'A' };
const companies = [tenant, { id: 'c2', name: 'Anand Exports', accountId: 'A' }];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listInvitations.mockResolvedValue({ invitations: [] });
  api.createInvitation.mockResolvedValue({ invitation: { id: 'i1' }, seatWarning: null });
  roles.listRoles.mockReset();
  roles.listRoles.mockResolvedValue({ roles: [{ id: 'r1', name: 'Accountant' }, { id: 'r2', name: 'Store keeper' }] });
});

/* W-3: the inviter reads what the person will get before sending (the spec's access preview). */
describe('Workspace → Invitations', () => {
  it('says in plain words what the person will get', () => {
    expect(accessPreview({ role: 'MEMBER', companyNames: ['Anand Traders'] })).toBe('Joins as member in Anand Traders. App access comes from roles.');
  });

  it('sends the email, role and chosen companies, and lists what was sent', async () => {
    render(<Invitations tenant={tenant} companies={companies} accountName="Anand Group" />);
    expect(await screen.findByText(/No invitations yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Invite people/ }));
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'priya@x.in' } });
    fireEvent.change(screen.getByLabelText('Account role'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByLabelText('Anand Exports'));
    expect(screen.getByText(/Joins as administrator in Anand Traders, Anand Exports/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }));
    await waitFor(() =>
      expect(api.createInvitation).toHaveBeenCalledWith({ email: 'priya@x.in', accountRole: 'ADMIN', grants: [{ orgId: 'c1' }, { orgId: 'c2' }] })
    );
    expect(await screen.findByText('Invitation sent to priya@x.in.')).toBeInTheDocument();
  });

  /* The person can work from the first sign-in: the role in the open company goes with the invitation. */
  it('sends a starting role for the open company, and says so before sending', async () => {
    render(<Invitations tenant={tenant} companies={companies} />);
    fireEvent.click(await screen.findByRole('button', { name: /Invite people/ }));
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ravi@x.in' } });
    const role = await screen.findByLabelText('Role in Anand Traders');
    expect(screen.getByText(/open no app until somebody gives one/)).toBeInTheDocument();
    fireEvent.change(role, { target: { value: 'r1' } });
    expect(screen.getByText(/Works as Accountant in Anand Traders from the first sign-in/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalledWith({ email: 'ravi@x.in', accountRole: 'MEMBER', grants: [{ orgId: 'c1', roleIds: ['r1'] }] }));
    expect(roles.listRoles).toHaveBeenCalledWith('c1');
  });

  it('offers resend and withdraw only while an invitation is open', async () => {
    api.listInvitations.mockResolvedValue({
      invitations: [
        { id: 'a', email: 'open@x.in', accountRole: 'MEMBER', status: 'PENDING', expiresAt: '2026-11-01', lastSentAt: '2026-10-25' },
        { id: 'b', email: 'done@x.in', accountRole: 'MEMBER', status: 'ACCEPTED', acceptedAt: '2026-10-25', lastSentAt: '2026-10-24' },
      ],
    });
    render(<Invitations tenant={tenant} companies={companies} />);
    await screen.findByText('open@x.in');
    expect(screen.getAllByRole('button', { name: /Resend/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Withdraw/ }));
    await waitFor(() => expect(api.revokeInvitation).toHaveBeenCalledWith('a'));
  });

  /* Round 60 pendinginvites A: one list of who has not joined, sent again one by one or all at once. */
  it('lists who has not joined yet and sends again to all of them', async () => {
    api.listInvitations.mockResolvedValue({
      invitations: [
        { id: 'a', email: 'open@x.in', accountRole: 'MEMBER', status: 'PENDING', expiresAt: '2026-11-01', lastSentAt: '2026-10-25' },
        { id: 'b', email: 'late@x.in', accountRole: 'MEMBER', status: 'EXPIRED', lastSentAt: '2026-10-01' },
        { id: 'c', email: 'done@x.in', accountRole: 'MEMBER', status: 'ACCEPTED', acceptedAt: '2026-10-25', lastSentAt: '2026-10-24' },
      ],
    });
    api.resendInvitation.mockResolvedValue({});
    render(<Invitations tenant={tenant} companies={companies} />);
    await screen.findByText('open@x.in');
    expect(screen.getByText(/Invited 25 Oct 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Not joined yet/ }));
    expect(screen.queryByText('done@x.in')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send again to all 2' }));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Sent again to 2 people.')).toBeInTheDocument();
  });
});
