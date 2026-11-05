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
import { rupees, seatsByApp, securityOf } from './overviewFigures';

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
  api.getAccountOverview.mockResolvedValue({ account: { name: 'Neev Group' }, plan: { name: 'Growth', inGoodStanding: true, limits: { maxCompanies: 3, maxUsers: 10 } }, usage: { companies: 1, users: 4 }, companies: [{ orgId: 'c1', name: 'Neev Steels', gstin: '' }],
    entities: { companies: 1, branches: 3, taxProfiles: 2, companiesWithoutGstin: 0, costCentres: 0 },
    seats: [{ app: 'accounting', bought: null }, { app: 'payroll', bought: 5 }],
    runRate: { monthly: 249900, currency: 'INR', interval: 'month', status: 'active', unpriced: [] },
    dataHealth: { status: 'attention', issues: 1, sources: [{ key: 'readers', label: 'Attendance readers', total: 2, issues: 1 }], alerts: [{ title: 'Gate is offline', severity: 'high' }] },
  });
  api.listAccountMembers.mockResolvedValue({ members: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'SUSPENDED' }] });
  api.listInvitations.mockResolvedValue({ invitations: [{ status: 'PENDING' }, { status: 'ACCEPTED' }] });
  api.accountAudit.mockResolvedValue({ events: [{ id: 'e1', at: new Date().toISOString(), action: 'INVITATION_SENT', result: 'OK', actor: { name: 'Rohit' } }] });
  api.memberDirectory.mockResolvedValue({
    members: [
      { status: 'ACTIVE', authenticator: false, accountRole: 'OWNER', companies: [{ isAdmin: true, apps: ['accounting', 'payroll', 'people', 'attendance'] }] },
      { status: 'ACTIVE', authenticator: true, accountRole: 'MEMBER', companies: [{ isAdmin: false, apps: ['payroll'] }] },
      { status: 'SUSPENDED', authenticator: false, accountRole: 'MEMBER', companies: [{ isAdmin: false, apps: ['accounting'] }] },
    ],
  });
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
    expect(await screen.findByText('Monthly run rate')).toBeInTheDocument();
    /* The banner: the person's name (not the account's), the account-level role in words, the account's name. */
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, Kavya');
    expect(screen.getByText('Account Owner')).toBeInTheDocument();
    expect(screen.getByText('Neev Group')).toBeInTheDocument();
    expect(screen.getByText('Your workspace, applications and team, all in one place.')).toBeInTheDocument();
    /* The spec's five figures: entities, seats, data health, security, run rate. */
    const figures = within(screen.getByLabelText('Workspace figures'));
    expect(figures.getByText('Entities').closest('.ws-stat')).toHaveTextContent('3 branches · 2 GST registrations');
    expect(await figures.findByText('Active seats')).toBeInTheDocument();
    /* The owner opens both apps and the member one; a suspended member holds no seat. */
    expect(figures.getByText('Active seats').closest('.ws-stat')).toHaveTextContent('3across 2 apps · 2 members');
    expect(figures.getByText('Data health').closest('.ws-stat')).toHaveTextContent('1 problem');
    expect(figures.getByText('Security').closest('.ws-stat')).toHaveTextContent('50%1 of 2 members sign in with an authenticator');
    expect(figures.getByText('Monthly run rate').closest('.ws-stat')).toHaveTextContent('₹2,499');
    const seatPanel = within(screen.getByRole('region', { name: 'Seats by app' }));
    expect(seatPanel.getByText('2 / 5')).toBeInTheDocument();
    expect(seatPanel.getByText('1 · no limit')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Data health' })).getByText('Needs a look')).toBeInTheDocument();
    const attention = within(screen.getByRole('region', { name: 'Needs your attention' }));
    expect(await attention.findByText('1 pending invitation')).toBeInTheDocument();
    expect(await attention.findByText('1 administrator without an authenticator')).toBeInTheDocument();
    expect(attention.getByText('Company details incomplete')).toBeInTheDocument();
    expect(attention.getByText('1 sync problem')).toBeInTheDocument();
    expect(attention.getByText('Gate is offline')).toBeInTheDocument();
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
    expect(screen.queryByLabelText('Workspace figures')).toBeNull();
    expect(screen.queryByText('Monthly run rate')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Quick actions' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Help and resources' })).toBeInTheDocument();
    expect(api.getAccountOverview).not.toHaveBeenCalled();
  });

  /* A price nobody has set is not a zero: the run rate says which app is waiting for one. */
  it('says the run rate is not priced, and why, instead of drawing a zero', async () => {
    api.getAccountOverview.mockResolvedValue({ plan: { name: 'Growth', inGoodStanding: true, limits: {} }, usage: {}, companies: [], runRate: { monthly: null, currency: 'INR', interval: 'month', status: 'active', unpriced: ['payroll'] }, dataHealth: { status: 'none', issues: 0, sources: [], alerts: [] } });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={NAV} openApp={() => {}} />);
    const stat = (await screen.findByText('Monthly run rate')).closest('.ws-stat');
    expect(stat).toHaveTextContent('Not priced yet');
    expect(stat).toHaveTextContent('CLOR has not set a price for Payroll');
    expect(screen.getByText('Data health').closest('.ws-stat')).toHaveTextContent('Nothing to sync');
    expect(screen.queryByRole('region', { name: 'Data health' })).toBeNull();
  });
});

describe('the overview’s figures', () => {
  const dir = [
    { status: 'ACTIVE', authenticator: true, accountRole: 'OWNER', companies: [{ isAdmin: true, apps: ['accounting'] }, { isAdmin: false, apps: ['payroll'] }] },
    { status: 'ACTIVE', authenticator: false, accountRole: 'MEMBER', companies: [{ isAdmin: true, apps: ['accounting'] }] },
    { status: 'INVITED', authenticator: false, accountRole: 'MEMBER', companies: [{ isAdmin: false, apps: ['accounting'] }] },
  ];

  it('counts a seat once per person per app, however many companies open it', () => {
    expect(seatsByApp(dir, [{ app: 'payroll', bought: 2 }], ['accounting', 'payroll', 'people'])).toEqual([
      { app: 'accounting', used: 2, bought: null },
      { app: 'payroll', used: 1, bought: 2 },
      { app: 'people', used: 0, bought: null },
    ]);
  });

  it('counts a company administrator without an authenticator as privileged', () => {
    expect(securityOf(dir)).toEqual({ active: 2, withTotp: 1, pct: 50, privilegedNo2fa: 1 });
    expect(securityOf([]).pct).toBeNull();
  });

  it('writes the run rate in whole rupees', () => {
    expect(rupees(249950)).toBe('₹2,500');
  });
});
