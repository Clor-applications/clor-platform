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

import AdminHome, { appState, renewalNotice, todayLines } from './AdminHome';
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
    seats: [{ app: 'accounting', bought: null }, { app: 'payroll', bought: 5 }, { app: 'people', bought: null }],
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
describe('Home', () => {
  it('names each app’s state from the subscription, the plan and the person’s own access', () => {
    const me = ['accounting'];
    expect(appState(CATALOG[1], tenant, me).label).toBe('Active');
    expect(appState(CATALOG[2], tenant, me).label).toBe('Access not assigned');
    expect(appState(CATALOG[3], tenant, me).label).toBe('Not in plan');
    expect(appState(CATALOG[4], tenant, me).label).toBe('Coming soon');
    expect(appState(CATALOG[3], { subscriptions: [], billing: null }).label).toBe('Not switched on');
  });

  it('shows an owner the account at a glance, then the top actions, most urgent first', async () => {
    const openScreen = vi.fn();
    render(<AdminHome user={{ firstName: 'Kavya' }} tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={openScreen} openApp={() => {}} accountName="Neev Group" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Home$/);
    expect(screen.getByText(/^Hello, Kavya/)).toBeInTheDocument();
    expect(await screen.findByText('Owner')).toBeInTheDocument();
    expect(await screen.findByText('Neev Group')).toBeInTheDocument();
    /* One primary action, top right. */
    fireEvent.click(screen.getByRole('button', { name: /Invite people/ }));
    expect(openScreen).toHaveBeenCalledWith('invitations');

    /* At a glance: one card per subject, each a figure, a breakdown and its buttons. */
    const members = within(await screen.findByRole('region', { name: 'Members' }));
    expect(await members.findByText('2')).toBeInTheDocument();
    expect(await members.findByText('1 invitation not accepted yet')).toBeInTheDocument();
    expect(members.getByText('2 / 5')).toBeInTheDocument();
    /* People is on the plan but switched on in no company: no seat bar that reads as people working in it. */
    expect(members.queryByText('People')).toBeNull();
    fireEvent.click(members.getByRole('button', { name: 'Manage members' }));
    expect(openScreen).toHaveBeenCalledWith('members');
    const apps = within(screen.getByRole('region', { name: 'Apps' }));
    expect(apps.getByText('Active apps')).toBeInTheDocument();
    /* No Apps screen in this person's menu: no button to it. */
    expect(apps.queryByRole('button', { name: 'Manage apps' })).toBeNull();
    const plan = within(screen.getByRole('region', { name: 'Plan' }));
    expect(plan.getByText('₹2,499.00')).toBeInTheDocument();
    expect(plan.getByText('Renews')).toBeInTheDocument();
    expect(plan.getByText('Nothing')).toBeInTheDocument();
    const security = within(screen.getByRole('region', { name: 'Security' }));
    expect(await security.findByText('1 administrator without one')).toBeInTheDocument();
    expect(security.getByText('Needs a look')).toBeInTheDocument();
    /* The glance folds away. */
    fireEvent.click(screen.getByRole('button', { name: 'At a glance' }));
    expect(screen.queryByRole('region', { name: 'Members' })).toBeNull();

    /* Top actions: one card each, the urgent ones tagged, each with the button that does it. */
    const top = within(screen.getByRole('region', { name: 'Top actions' }));
    expect(await top.findByText('1 pending invitation')).toBeInTheDocument();
    expect(await top.findByText('1 administrator without an authenticator')).toBeInTheDocument();
    fireEvent.click(top.getByRole('button', { name: /Review members: 1 administrator without an authenticator/ }));
    expect(openScreen).toHaveBeenCalledWith('members', { risk: 'no2fa' });
    expect(top.getByText('Neev Steels has no GSTIN')).toBeInTheDocument();
    expect(top.getByText('Gate is offline')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '2 urgent items' })).toBeInTheDocument();
    const titles = top.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.findIndex((t) => t.includes('sync problem'))).toBeLessThan(titles.findIndex((t) => t.includes('pending invitation')));
    /* The chips show one subject at a time. */
    fireEvent.click(top.getByRole('button', { name: /^Companies/ }));
    expect(top.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Neev Steels has no GSTIN']);
    fireEvent.click(top.getByRole('button', { name: /^All/ }));
    expect(top.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(1);

    /* One company: no Companies table repeating it. */
    expect(screen.queryByRole('region', { name: 'Companies' })).toBeNull();
    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Help and support' })).toBeInTheDocument();
  });

  it('lists the companies in a table only when the account has more than one', async () => {
    const one = await api.getAccountOverview();
    api.getAccountOverview.mockResolvedValue({ ...one, companies: [...one.companies, { orgId: 'c2', name: 'Neev Exports', gstin: '29ABCDE1234F1Z5' }] });
    render(<AdminHome user={{ firstName: 'Kavya' }} tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={() => {}} openApp={() => {}} />);
    const companies = within(await screen.findByRole('region', { name: 'Companies' }));
    expect(companies.getByText('Not added')).toBeInTheDocument();
    expect(companies.getByText('Neev Exports')).toBeInTheDocument();
  });

  it('puts a trial about to end and an overdue CLOR invoice at the top', async () => {
    api.getAccountOverview.mockResolvedValue({ plan: { name: 'Growth', inGoodStanding: true, limits: {} }, usage: {}, companies: [], dataHealth: { status: 'none', issues: 0, sources: [], alerts: [] },
      runRate: { monthly: null, unpriced: ['payroll'] },
      renewal: { status: 'trialing', warn: 'trial-ending', endsAt: '2026-11-16T00:00:00Z', daysLeft: 5, renewsAt: null, invoices: { unpaid: 1, overdue: 1, due: 118000 } } });
    const openScreen = vi.fn();
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={openScreen} openApp={() => {}} />);
    const attention = within(await screen.findByRole('region', { name: 'Top actions' }));
    const first = (await attention.findAllByRole('listitem'))[0];
    expect(first).toHaveTextContent('1 CLOR invoice overdue');
    expect(first).toHaveTextContent('₹1,180');
    expect(first).toHaveTextContent('Urgent');
    expect(attention.getByText('Your trial ends in 5 days')).toBeInTheDocument();
    fireEvent.click(attention.getByRole('button', { name: /CLOR invoice overdue/ }));
    expect(openScreen).toHaveBeenCalledWith('billing');
    const sub = within(screen.getByRole('region', { name: 'Plan' }));
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
    const waitingList = within(await screen.findByRole('region', { name: 'Top actions' }));
    const people = await waitingList.findByRole('button', { name: /3 requests to approve/ });
    expect(people.closest('li')).toHaveTextContent('In People.');
    expect(http.apiFetch.mock.calls[0][0]).toMatch(/\/workspace\/waiting$/);
    expect(waitingList.getByRole('button', { name: /2 documents to approve/ }).closest('li')).toHaveTextContent('In Books.');
    expect(screen.queryByText(/payrolls to approve/)).toBeNull();
    fireEvent.click(people);
    expect(openApp).toHaveBeenCalledWith('people', 'approvals', {});
  });

  it('shows a member their apps and help, and no account figures', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'MEMBER', apps: [] });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={[{ key: 'home' }]} openApp={() => {}} />);
    expect(await screen.findByText('No app access yet')).toBeInTheDocument();
    expect(screen.getByText('Member', { selector: '.ws-pill' })).toBeInTheDocument();
    expect(screen.queryByText('Owner')).toBeNull();
    expect(screen.queryByText('Companies')).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Plan' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Quick actions' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Company overview' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Team and access' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Invite people/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Help and support' })).toBeInTheDocument();
    expect(api.getAccountOverview).not.toHaveBeenCalled();
    expect(http.apiFetch).not.toHaveBeenCalled();
  });

  it('a billing administrator sees the subscription, not the team', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'BILLING_ADMIN', apps: [] });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={NAV} openApp={() => {}} />);
    expect(await screen.findByRole('region', { name: 'Plan' })).toBeInTheDocument();
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

  it('writes the run rate with two decimals, like every amount', () => {
    expect(rupees(249950)).toBe('₹2,499.50');
  });

  /* The hero's Today card: one line per app that reported a day, in the app's own figures. */
  it('writes today in each app from its own overview, and nothing for an app that did not answer', () => {
    expect(todayLines({})).toEqual([]);
    const lines = todayLines({
      attendance: { headcount: 50, present: 41, halfDay: 1, absent: 2, onLeave: 3, notMarked: 3, holiday: null },
      people: { headcount: 52, joinedThisMonth: [{ id: 'e1' }, { id: 'e2' }], upcomingBirthdays: [{ name: 'Asha', days: 1 }] },
      payroll: { overview: { currentPeriod: { name: 'November 2026' }, currentRun: { net: 1234567.4, stage: 'Approved', employeeCount: 48 } } },
    });
    expect(lines.map((x) => x.app)).toEqual(['attendance', 'people', 'payroll']);
    expect(lines[0]).toMatchObject({ value: '42', note: 'of 50', label: 'In today', sub: '3 on leave · 2 absent · 3 not marked' });
    expect(lines[1]).toMatchObject({ value: '52', label: 'People', sub: '2 joined this month · Asha’s birthday tomorrow' });
    expect(lines[2]).toMatchObject({ value: '₹12,34,567', label: 'November 2026 payroll', sub: 'Approved · 48 people' });
    /* A holiday is said as one, not as an empty office; a period with no run says so. */
    expect(todayLines({ attendance: { headcount: 50, holiday: 'Diwali' } })[0]).toMatchObject({ value: 'Holiday', label: 'Diwali', sub: null });
    expect(todayLines({ payroll: { overview: { currentPeriod: { name: 'November 2026' }, currentRun: null } } })[0]).toMatchObject({ value: '—', sub: 'Pay run not started' });
  });

  /* Audit 21 Nov 2026: an outage read as "Nothing needs your action". */
  it('says Top actions could not be loaded, with a retry, when who you are cannot be read', async () => {
    api.getAccountMe.mockRejectedValueOnce(new Error('down'));
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={NAV} openScreen={() => {}} />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText('What needs your action could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs your action right now.')).toBeNull();
    fireEvent.click(retry);
    expect((await screen.findAllByText('Members')).length).toBeGreaterThan(0);
    expect(screen.queryByText('What needs your action could not be loaded.')).toBeNull();
    expect(api.getAccountMe).toHaveBeenCalledTimes(2);
  });
});
