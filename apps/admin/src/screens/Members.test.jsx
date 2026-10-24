import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ memberDirectory: vi.fn(), memberAccess: vi.fn(), suspendMember: vi.fn(), reinstateMember: vi.fn(), removeMemberFromCompany: vi.fn(), setAccountRole: vi.fn() }));
vi.mock('@platform/admin/account', () => Object.fromEntries(Object.keys(api).map((k) => [k, (...a) => api[k](...a)])));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, title, children }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null) }));

import Members, { filterMembers } from './Members';

const DIR = {
  companies: [{ orgId: 'c1', name: 'Anand Traders' }, { orgId: 'c2', name: 'Anand Exports' }],
  members: [
    { userId: 'u1', name: 'Rohit', email: 'rohit@x.in', accountRole: 'OWNER', status: 'ACTIVE', companies: [{ orgId: 'c1', name: 'Anand Traders', apps: ['accounting', 'payroll'], roles: ['Owner'] }] },
    { userId: 'u2', name: 'Kavya', email: 'kavya@x.in', accountRole: 'MEMBER', status: 'ACTIVE', companies: [{ orgId: 'c2', name: 'Anand Exports', apps: ['payroll'], roles: ['Payroll User'] }] },
    { userId: 'u3', name: 'Meera', email: 'meera@x.in', accountRole: 'MEMBER', status: 'SUSPENDED', companies: [] },
  ],
};
const ACCESS = {
  userId: 'u2', name: 'Kavya', email: 'kavya@x.in', accountRole: 'MEMBER', status: 'ACTIVE', memberSince: '2026-10-01', lastSignInAt: null, authenticator: false,
  companies: [{ orgId: 'c2', name: 'Anand Exports', isAdmin: false, apps: ['payroll'], branches: ['Head office'], roles: [{ name: 'Payroll User', via: 'direct', grantedBy: 'Rohit', grantedAt: '2026-10-02' }], sensitive: ['PAYROLL::Payslips::VIEW'] }],
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset().mockResolvedValue({}));
  api.memberDirectory.mockResolvedValue(DIR);
  api.memberAccess.mockResolvedValue(ACCESS);
});

/* W-4: the account's people, their effective access, and separate acts. */
describe('Workspace → Members', () => {
  it('filters by search, status, company, app and role', () => {
    const f = (x) => filterMembers(DIR.members, x).map((m) => m.userId);
    expect(f({ q: 'kav' })).toEqual(['u2']);
    expect(f({ status: 'SUSPENDED' })).toEqual(['u3']);
    expect(f({ companyId: 'c1' })).toEqual(['u1']);
    expect(f({ app: 'payroll' })).toEqual(['u1', 'u2']);
    expect(f({ companyId: 'c1', app: 'payroll' })).toEqual(['u1']);
    expect(f({ role: 'OWNER' })).toEqual(['u1']);
  });

  it('opens a person’s access: roles with who gave them, apps, sensitive reach', async () => {
    render(<Members />);
    fireEvent.click(await screen.findByRole('button', { name: /Kavya/ }));
    const d = await screen.findByRole('dialog', { name: 'Kavya' });
    expect(d).toHaveTextContent('given by Rohit');
    expect(d).toHaveTextContent('Apps: Payroll');
    expect(d).toHaveTextContent('Can reach sensitive data: 1 permission');
  });

  it('keeps suspend and remove-from-company as separate acts', async () => {
    render(<Members />);
    fireEvent.click(await screen.findByRole('button', { name: /Kavya/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Anand Exports' }));
    await waitFor(() => expect(api.removeMemberFromCompany).toHaveBeenCalledWith('u2', 'c2'));
    expect(api.suspendMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Suspend in the account/ }));
    await waitFor(() => expect(api.suspendMember).toHaveBeenCalledWith('u2'));
  });
});
