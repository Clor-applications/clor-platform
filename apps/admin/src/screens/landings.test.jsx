import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  memberDirectory: vi.fn(), listInvitations: vi.fn(), accountAudit: vi.fn(),
  getPolicy: vi.fn(), getProviders: vi.fn(), getMySessions: vi.fn(), listCredentials: vi.fn(), getAccountOverview: vi.fn(),
}));
vi.mock('@platform/admin/account', () => ({ memberDirectory: () => api.memberDirectory(), listInvitations: () => api.listInvitations(), accountAudit: (f) => api.accountAudit(f) }));
vi.mock('@platform/admin/security', () => ({ getPolicy: () => api.getPolicy(), getProviders: () => api.getProviders(), getMySessions: () => api.getMySessions() }));
vi.mock('@platform/admin/credentials', () => ({ listCredentials: () => api.listCredentials() }));
vi.mock('@platform/admin/admin', () => ({ getAccountOverview: () => api.getAccountOverview() }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null) }));

import { AccessHome, DataHome, SecurityHome } from './Landings';
import Companies, { companyRows } from './Companies';

const NAV = (keys) => keys.map((key) => ({ key }));
beforeEach(() => {
  api.memberDirectory.mockResolvedValue({ members: [
    { userId: 'u1', name: 'Rohit', accountRole: 'OWNER', status: 'ACTIVE', authenticator: false, companies: [{ isAdmin: true, apps: ['accounting'] }] },
    { userId: 'u2', name: 'Kavya', accountRole: 'MEMBER', status: 'ACTIVE', authenticator: true, companies: [{ isAdmin: false, apps: [] }] },
  ] });
  api.listInvitations.mockResolvedValue({ invitations: [{ status: 'PENDING' }] });
  api.accountAudit.mockResolvedValue({ events: [] });
  api.getPolicy.mockResolvedValue({ policy: { requireAdminTwoFactor: true, requirePayrollStepUp: false, passwordMinLength: 10, maxFailedLogins: 5, lockoutMinutes: 15, sessionDays: 30 }, passwordRules: 'At least 10 characters' });
  api.getProviders.mockResolvedValue({ providers: [] });
  api.getMySessions.mockResolvedValue({ sessions: [] });
  api.listCredentials.mockResolvedValue({ credentials: [{ id: 'k1' }] });
  api.getAccountOverview.mockResolvedValue({ plan: { limits: { maxCompanies: 3 } }, companies: [
    { orgId: 'c1', name: 'Anand Traders', state: 'Karnataka', gstin: '29ABCDE1234F1Z5', people: 4, invoices: 9, since: '2026-01-01' },
    { orgId: 'c2', name: 'Anand Exports', state: 'Maharashtra', gstin: '', people: 1, invoices: 0, since: '2026-02-01' },
  ] });
});

/* Redesign W-R3/R5/R6/R7/R9: each module lands on a page about itself, from real data. */
describe('module landing pages', () => {
  it('Access: who is in, waiting, holding power, without an app', async () => {
    const openScreen = vi.fn();
    render(<AccessHome navItems={NAV(['members', 'invitations'])} openScreen={openScreen} />);
    expect(await screen.findByText('Rohit')).toBeInTheDocument();
    expect(screen.getByText(/Account owner · no authenticator/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Invite people/ }));
    expect(openScreen).toHaveBeenCalledWith('invitations');
  });

  it('Security: the sign-in rules actually in force', async () => {
    render(<SecurityHome navItems={NAV(['security'])} openScreen={() => {}} />);
    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument();
    expect(screen.getByText('After 5 failed attempts, for 15 minutes')).toBeInTheDocument();
  });

  it('Data: export apart from closing, which sits in a danger zone', () => {
    const openScreen = vi.fn();
    render(<DataHome tenant={{ name: 'Anand Traders' }} navItems={NAV(['export', 'close'])} openScreen={openScreen} />);
    expect(screen.getByRole('region', { name: /Danger zone: close Anand Traders/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review closing this company' }));
    expect(openScreen).toHaveBeenCalledWith('close');
  });

  it('Companies: search, sort and the setup state from the server', async () => {
    expect(companyRows([{ name: 'B', people: 1 }, { name: 'A', people: 5 }], { sort: 'people', dir: -1 }).rows.map((r) => r.name)).toEqual(['A', 'B']);
    render(<Companies tenant={{ id: 'c1' }} addCompany={vi.fn()} switchCompany={vi.fn()} />);
    expect(await screen.findByText('Anand Exports')).toBeInTheDocument();
    expect(screen.getByText('You are here')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search by name, GSTIN or state'), { target: { value: 'maha' } });
    expect(screen.queryByText('Anand Traders')).toBeNull();
  });
});

describe('a company at a glance', () => {
  it('opens from its name with its figures, people and apps', async () => {
    const { peopleOf } = await import('./CompanyDetail');
    expect(peopleOf({ members: [
      { userId: 'a', name: 'Zed', companies: [{ orgId: 'c2', isAdmin: false, apps: ['payroll'] }] },
      { userId: 'b', name: 'Asha', companies: [{ orgId: 'c2', isAdmin: true, apps: [] }] },
      { userId: 'c', name: 'Out', companies: [{ orgId: 'c1', isAdmin: true, apps: [] }] },
    ] }, 'c2').map((p) => p.name)).toEqual(['Asha', 'Zed']);

    render(<Companies tenant={{ id: 'c1' }} addCompany={vi.fn()} switchCompany={vi.fn()} catalog={[{ id: 'payroll', name: 'Payroll' }]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Anand Exports' }));
    const panel = await screen.findByRole('dialog');
    expect(panel).toHaveTextContent('Maharashtra');
    expect(panel).toHaveTextContent('Switch to this company');
  });
});
