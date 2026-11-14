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
  listTickets: vi.fn(),
}));
vi.mock('@platform/admin/account', () => ({
  getAccountMe: (...a) => api.getAccountMe(...a),
  listAccountMembers: (...a) => api.listAccountMembers(...a),
  listInvitations: (...a) => api.listInvitations(...a),
  accountAudit: (...a) => api.accountAudit(...a),
  memberDirectory: (...a) => api.memberDirectory(...a),
  listTickets: (...a) => api.listTickets(...a),
}));
vi.mock('@platform/admin/admin', () => ({ getAccountOverview: (...a) => api.getAccountOverview(...a) }));
vi.mock('@platform/operator', () => ({ operator: { contactEmail: 'info@clor.in' } }));
const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => http.apiFetch(...a) }));

import AdminHome, { appState, renewalNotice } from './AdminHome';
import { rupees, seatsByApp, securityOf } from './overviewFigures';

const CATALOG = [
  { id: 'admin', name: 'Workspace', icon: Users, blurb: '', available: true, platform: true },
  { id: 'accounting', name: 'Accounting', icon: BookOpen, blurb: 'Books.', available: true },
  { id: 'payroll', name: 'Payroll', icon: Wallet, blurb: 'Pay.', available: true },
  { id: 'people', name: 'People', icon: Users, blurb: 'HR.', available: true },
  { id: 'projects', name: 'Projects', icon: Briefcase, blurb: 'Later.', available: false },
];
const tenant = { id: 'c1', name: 'Neev Steels', subscriptions: ['accounting', 'payroll'], billing: { restricted: true, ownedApps: ['accounting', 'payroll'] } };
const NAV = ['home', 'companies', 'members', 'invitations', 'account', 'billing', 'accountActivity', 'securityHome', 'roles'].map((key) => ({ key, label: key }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  http.apiFetch.mockReset();
  api.getAccountMe.mockResolvedValue({ role: 'OWNER', apps: ['accounting', 'payroll'] });
  api.listTickets.mockResolvedValue({ tickets: [] });
  api.getAccountOverview.mockResolvedValue({ account: { name: 'Neev Group' }, plan: { name: 'Growth', inGoodStanding: true, limits: { maxCompanies: 3, maxUsers: 10 } }, usage: { companies: 1, users: 4 }, companies: [{ orgId: 'c1', name: 'Neev Steels', gstin: '' }],
    entities: { companies: 1, branches: 3, taxProfiles: 2, companiesWithoutGstin: 0, costCentres: 0 },
    seats: [{ app: 'accounting', bought: null }, { app: 'payroll', bought: 5 }],
    runRate: { monthly: 249900, currency: 'INR', interval: 'month', status: 'active', unpriced: [] },
    renewal: { status: 'active', warn: null, endsAt: null, daysLeft: null, renewsAt: '2026-12-01T00:00:00Z', invoices: { unpaid: 0, overdue: 0, due: 0 } },
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

  it('shows an owner the business at a glance, what needs attention first, and the subscription', async () => {
    const openScreen = vi.fn();
    render(<AdminHome user={{ firstName: 'Kavya' }} tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={openScreen} openApp={() => {}} accountName="Neev Group" />);
    /* R&D hand-off (CLOR-01): the page is the Workspace, with the account's facts on one line under it. */
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workspace');
    expect(await screen.findByText('Account Owner')).toBeInTheDocument();
    expect(await screen.findByText(/Neev Group · 1 company · 2 of 3 apps · 2 members/)).toBeInTheDocument();
    /* One primary action, top right. */
    fireEvent.click(screen.getByRole('button', { name: /Invite people/ }));
    expect(openScreen).toHaveBeenCalledWith('invitations');
    /* Payroll's seats are bought, Accounting's are not metered: no "of" total that would be wrong. */
    expect(screen.getByRole('list', { name: '2 urgent items' })).toBeInTheDocument();
    const companies = within(screen.getByRole('region', { name: 'Companies' }));
    expect(companies.getByText('Not added')).toBeInTheDocument();
    expect(companies.getByText('Needs GSTIN')).toBeInTheDocument();
    const attention = within(screen.getByRole('region', { name: 'Needs your attention' }));
    expect(await attention.findByText('1 pending invitation')).toBeInTheDocument();
    expect(await attention.findByText('1 administrator without an authenticator')).toBeInTheDocument();
    expect(attention.getByText('Neev Steels has no GSTIN')).toBeInTheDocument();
    expect(attention.getByText('Gate is offline')).toBeInTheDocument();
    /* Urgent first: the sync problem sits above the invitation. */
    const titles = attention.getAllByRole('listitem').map((li) => li.textContent);
    expect(titles.findIndex((t) => t.includes('sync problem'))).toBeLessThan(titles.findIndex((t) => t.includes('pending invitation')));
    const sub = within(screen.getByRole('region', { name: 'Subscription' }));
    expect(sub.getByText('₹2,499')).toBeInTheDocument();
    expect(sub.getByText('Renews')).toBeInTheDocument();
    expect(sub.getByText('Nothing')).toBeInTheDocument();
    expect(sub.getByText('2 / 5')).toBeInTheDocument();
    expect(sub.queryByText('Books seats')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Security' })).getByText('1 / 2')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Connections' })).getByText('Needs a look')).toBeInTheDocument();
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
    /* README §2: each app is marked in its own colour, and opens on its own address. */
    expect(document.querySelectorAll('.ws-apps .ws-appmark').length).toBe(4);
    expect(screen.getByRole('button', { name: 'Open books.clor.in' })).toBeInTheDocument();
  });

  it('puts a trial about to end and an overdue CLOR invoice at the top', async () => {
    api.getAccountOverview.mockResolvedValue({ plan: { name: 'Growth', inGoodStanding: true, limits: {} }, usage: {}, companies: [], dataHealth: { status: 'none', issues: 0, sources: [], alerts: [] },
      runRate: { monthly: null, unpriced: ['payroll'] },
      renewal: { status: 'trialing', warn: 'trial-ending', endsAt: '2026-11-16T00:00:00Z', daysLeft: 5, renewsAt: null, invoices: { unpaid: 1, overdue: 1, due: 118000 } } });
    const openScreen = vi.fn();
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={openScreen} openApp={() => {}} />);
    const attention = within(await screen.findByRole('region', { name: 'Needs your attention' }));
    const first = (await attention.findAllByRole('listitem'))[0];
    expect(first).toHaveTextContent('1 CLOR invoice overdue');
    expect(first).toHaveTextContent('₹1,180');
    expect(attention.getByText('Your trial ends in 5 days')).toBeInTheDocument();
    fireEvent.click(attention.getByRole('button', { name: /CLOR invoice overdue/ }));
    expect(openScreen).toHaveBeenCalledWith('billing');
    const sub = within(screen.getByRole('region', { name: 'Subscription' }));
    expect(sub.getByText('Trial')).toBeInTheDocument();
    expect(sub.getByText('Trial ends')).toBeInTheDocument();
    expect(sub.getByText('Not priced yet (Payroll)')).toBeInTheDocument();
  });

  it('shows what waits for this person in each app they can open, and opens the screen where it is decided', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'MEMBER', apps: ['people', 'accounting'] });
    http.apiFetch.mockResolvedValue({
      total: 7,
      sources: [
        { app: 'people', key: 'people.approvals', label: 'requests to approve', count: 3, open: { app: 'people', screen: 'approvals' } },
        { app: 'accounting', key: 'books.approvals', label: 'documents to approve', count: 2, open: { app: 'accounting', screen: 'approvals' } },
        /* Payroll is not open to this member: not shown. */
        { app: 'payroll', key: 'payroll.runs', label: 'payrolls to approve', count: 2, open: { app: 'payroll', screen: 'runs' } },
      ],
      unanswered: [],
    });
    const openApp = vi.fn();
    render(<AdminHome tenant={{ ...tenant, subscriptions: ['people', 'accounting', 'payroll'] }} catalog={CATALOG} navItems={[{ key: 'home' }]} openApp={openApp} />);
    const people = await screen.findByRole('button', { name: /3 requests to approve/ });
    expect(people).toHaveTextContent('In People.');
    expect(http.apiFetch.mock.calls[0][0]).toMatch(/\/workspace\/waiting$/);
    expect(screen.getByRole('button', { name: /2 documents to approve/ })).toHaveTextContent('In Books.');
    expect(screen.queryByText(/payrolls to approve/)).toBeNull();
    fireEvent.click(people);
    expect(openApp).toHaveBeenCalledWith('people', 'approvals', {});
  });

  it('shows a member their apps and help, and no account figures', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'MEMBER', apps: [] });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={[{ key: 'home' }]} openApp={() => {}} />);
    expect(await screen.findByText('No app access yet')).toBeInTheDocument();
    expect(screen.getByText('Member', { selector: '.ws-pill' })).toBeInTheDocument();
    expect(screen.queryByText('Account Owner')).toBeNull();
    expect(screen.queryByText('Companies')).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Subscription' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shortcuts' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Invite people/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Help and support' })).toBeInTheDocument();
    expect(api.getAccountOverview).not.toHaveBeenCalled();
    expect(http.apiFetch).not.toHaveBeenCalled();
  });

  it('a billing administrator sees the subscription, not the team', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'BILLING_ADMIN', apps: [] });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={NAV} openApp={() => {}} />);
    expect(await screen.findByRole('region', { name: 'Subscription' })).toBeInTheDocument();
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByRole('button', { name: /Invite people/ })).toBeNull();
    expect(api.memberDirectory).not.toHaveBeenCalled();
  });

  it('says plainly when the subscription is about to end', () => {
    expect(renewalNotice({ warn: 'trial-ending', daysLeft: 1, endsAt: '2026-11-12' }).title).toBe('Your trial ends tomorrow');
    expect(renewalNotice({ warn: 'ending', daysLeft: 0, endsAt: '2026-11-11' }).title).toBe('Your plan stops today');
    expect(renewalNotice({ warn: 'lapsed' }, true)).toBeNull();
    expect(renewalNotice({ warn: null })).toBeNull();
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
