import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { listInvitations: vi.fn(), createInvitation: vi.fn(), resendInvitation: vi.fn(), revokeInvitation: vi.fn() };
vi.mock('@platform/admin/account', () => ({
  listInvitations: (...a) => api.listInvitations(...a),
  createInvitation: (...a) => api.createInvitation(...a),
  resendInvitation: (...a) => api.resendInvitation(...a),
  revokeInvitation: (...a) => api.revokeInvitation(...a),
}));

import Invitations, { accessPreview } from './Invitations';

const tenant = { id: 'c1', name: 'Anand Traders', accountId: 'A' };
const companies = [tenant, { id: 'c2', name: 'Anand Exports', accountId: 'A' }];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listInvitations.mockResolvedValue({ invitations: [] });
  api.createInvitation.mockResolvedValue({ invitation: { id: 'i1' }, seatWarning: null });
});

/* W-3: the inviter reads what the person will get before sending (the spec's access preview). */
describe('Workspace → Invitations', () => {
  it('says in plain words what the person will get', () => {
    expect(accessPreview({ email: 'priya@x.in', role: 'MEMBER', companyNames: ['Anand Traders'], accountName: 'Anand Group' })).toBe(
      'priya@x.in will join Anand Group as member and get into Anand Traders. They get no app roles until someone gives them one under Roles.'
    );
  });

  it('sends the email, role and chosen companies, and lists what was sent', async () => {
    render(<Invitations tenant={tenant} companies={companies} accountName="Anand Group" />);
    expect(await screen.findByText(/No invitations yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'priya@x.in' } });
    fireEvent.change(screen.getByLabelText('Account role'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByLabelText('Anand Exports'));
    expect(screen.getByText(/priya@x.in will join Anand Group as administrator and get into Anand Traders, Anand Exports/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send invitation/ }));
    await waitFor(() =>
      expect(api.createInvitation).toHaveBeenCalledWith({ email: 'priya@x.in', accountRole: 'ADMIN', grants: [{ orgId: 'c1' }, { orgId: 'c2' }] })
    );
    expect(await screen.findByText('Invitation sent to priya@x.in.')).toBeInTheDocument();
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
});
