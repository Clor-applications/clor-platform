import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookOpen, Briefcase, Users, Wallet } from 'lucide-react';

const api = vi.hoisted(() => ({
  getAccountMe: vi.fn(),
  listAccountMembers: vi.fn(),
  listInvitations: vi.fn(),
  accountAudit: vi.fn(),
  memberDirectory: vi.fn(),
  getAccountOverview: vi.fn(),
}));
vi.mock('@platform/admin/account', () => ({
  getAccountMe: (...a) => api.getAccountMe(...a),
  listAccountMembers: (...a) => api.listAccountMembers(...a),
  listInvitations: (...a) => api.listInvitations(...a),
  accountAudit: (...a) => api.accountAudit(...a),
  memberDirectory: (...a) => api.memberDirectory(...a),
}));
vi.mock('@platform/admin/admin', () => ({ getAccountOverview: (...a) => api.getAccountOverview(...a) }));
vi.mock('@platform/operator', () => ({ operator: { contactEmail: 'info@clor.in' } }));

import AdminHome, { appState } from './AdminHome';

const CATALOG = [
  { id: 'admin', name: 'Workspace', icon: Users, blurb: '', available: true, platform: true },
  { id: 'accounting', name: 'Accounting', icon: BookOpen, blurb: 'Books.', available: true },
  { id: 'payroll', name: 'Payroll', icon: Wallet, blurb: 'Pay.', available: true },
  { id: 'people', name: 'People', icon: Users, blurb: 'HR.', available: true },
  { id: 'projects', name: 'Projects', icon: Briefcase, blurb: 'Later.', available: false },
];
const tenant = { id: 'c1', name: 'Neev Steels', subscriptions: ['accounting', 'payroll'], billing: { restricted: true, ownedApps: ['accounting', 'payroll'] } };
const NAV = ['home', 'companies', 'members', 'invitations', 'account', 'accountActivity'].map((key) => ({ key, label: key }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getAccountMe.mockResolvedValue({ role: 'OWNER', apps: ['accounting', 'payroll'] });
  api.getAccountOverview.mockResolvedValue({ account: { name: 'Neev Group' }, plan: { name: 'Growth', inGoodStanding: true, limits: { maxCompanies: 3, maxUsers: 10 } }, usage: { companies: 1, users: 4 }, companies: [{ orgId: 'c1', name: 'Neev Steels', gstin: '' }] });
  api.listAccountMembers.mockResolvedValue({ members: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'SUSPENDED' }] });
  api.listInvitations.mockResolvedValue({ invitations: [{ status: 'PENDING' }, { status: 'ACCEPTED' }] });
  api.accountAudit.mockResolvedValue({ events: [{ id: 'e1', at: new Date().toISOString(), action: 'INVITATION_SENT', result: 'OK', actor: { name: 'Rohit' } }] });
  api.memberDirectory.mockResolvedValue({ members: [{ status: 'ACTIVE', authenticator: false, accountRole: 'OWNER', companies: [] }] });
});

/*
 * Redesign W-R4: the Overview is information and a few actions, not a menu.
 * Every state and figure comes from the server; a member is not shown numbers
 * they may not read.
 */
describe('the Workspace overview', () => {
  it('names each app’s state from the subscription, the plan and the person’s own access', () => {
    const me = ['accounting'];
    expect(appState(CATALOG[1], tenant, me).label).toBe('Active');
    expect(appState(CATALOG[2], tenant, me).label).toBe('Access not assigned');
    expect(appState(CATALOG[3], tenant, me).label).toBe('Subscription required');
    expect(appState(CATALOG[4], tenant, me).label).toBe('Coming soon');
    expect(appState(CATALOG[3], { subscriptions: [], billing: null }).label).toBe('Not switched on');
  });

  it('shows an owner the account’s figures, what needs attention and recent activity', async () => {
    const openScreen = vi.fn();
    render(<AdminHome user={{ firstName: 'Kavya' }} tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={openScreen} openApp={() => {}} accountName="Neev Group" />);
    expect(await screen.findByText('Growth', { selector: '.ws-stat-value' })).toBeInTheDocument();
    /* The banner: the person's name (not the account's), the account-level role in words, the account's name. */
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, Kavya');
    expect(screen.getByText('Account Owner')).toBeInTheDocument();
    expect(screen.getByText('Neev Group')).toBeInTheDocument();
    expect(screen.getByText('Your workspace, applications and team, all in one place.')).toBeInTheDocument();
    expect(screen.getByText('of 3 on your plan')).toBeInTheDocument();
    expect(await screen.findByText('1 invitation pending')).toBeInTheDocument();
    const attention = within(screen.getByRole('region', { name: 'Needs your attention' }));
    expect(await attention.findByText('1 pending invitation')).toBeInTheDocument();
    expect(await attention.findByText('1 administrator without an authenticator')).toBeInTheDocument();
    expect(attention.getByText('Company details incomplete')).toBeInTheDocument();
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
    fireEvent.click(attention.getByRole('button', { name: /1 pending invitation/ }));
    expect(openScreen).toHaveBeenCalledWith('invitations');
    /* The administration link grid is gone from the Overview. */
    expect(screen.queryByRole('navigation', { name: 'Access' })).toBeNull();
  });

  it('shows a member their apps and help, and no account figures', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'MEMBER', apps: [] });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={[{ key: 'home' }]} openApp={() => {}} />);
    expect(await screen.findByText('No app access yet')).toBeInTheDocument();
    expect(screen.getByText('Member', { selector: '.ws-pill' })).toBeInTheDocument();
    expect(screen.getByText('Your applications and work, all in one place.')).toBeInTheDocument();
    expect(screen.queryByText('Account Owner')).toBeNull();
    expect(screen.queryByText('Members', { selector: '.ws-stat-label' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Quick actions' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Help and resources' })).toBeInTheDocument();
    expect(api.getAccountOverview).not.toHaveBeenCalled();
  });
});
