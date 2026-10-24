import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookOpen, Briefcase, Users, Wallet } from 'lucide-react';

const getAccountMe = vi.fn();
const listAccountMembers = vi.fn();
vi.mock('@platform/admin/account', () => ({ getAccountMe: (...a) => getAccountMe(...a), listAccountMembers: (...a) => listAccountMembers(...a) }));

import AdminHome, { appState } from './AdminHome';

beforeEach(() => {
  getAccountMe.mockReset().mockResolvedValue({ role: 'MEMBER' });
  listAccountMembers.mockReset().mockResolvedValue({ members: [] });
});

const CATALOG = [
  { id: 'admin', name: 'Workspace', icon: Users, blurb: '', available: true, platform: true },
  { id: 'accounting', name: 'Accounting', icon: BookOpen, blurb: 'Books.', available: true },
  { id: 'payroll', name: 'Payroll', icon: Wallet, blurb: 'Pay.', available: true },
  { id: 'people', name: 'People', icon: Users, blurb: 'HR.', available: true },
  { id: 'projects', name: 'Projects', icon: Briefcase, blurb: 'Later.', available: false },
];

/*
 * The Workspace home tells a company where it stands with each app. "Open" is
 * only offered for an app the company has switched on; the rest say why not,
 * from the subscription and the plan the server reported.
 */
describe('the Workspace home', () => {
  const tenant = { name: 'Neev Steels', subscriptions: ['accounting'], billing: { restricted: true, ownedApps: ['accounting', 'payroll'] } };

  it('names each app’s state from the subscription and the plan', () => {
    expect(appState(CATALOG[1], tenant).key).toBe('open');
    expect(appState(CATALOG[2], tenant).key).toBe('off');
    expect(appState(CATALOG[3], tenant).key).toBe('plan');
    expect(appState(CATALOG[4], tenant).key).toBe('soon');
    /* No plan reported restricts nothing: a product not switched on can still be added. */
    expect(appState(CATALOG[3], { subscriptions: [], billing: null }).key).toBe('off');
  });

  it('offers Open only for a switched-on app, and never lists the Workspace itself', () => {
    const openApp = vi.fn();
    render(<AdminHome user={{ firstName: 'Kavya' }} tenant={tenant} catalog={CATALOG} openApp={openApp} openMoreApps={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: /, Kavya$/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1);
    /* A member sees no setup checklist: that is the account's administrators' job. */
    expect(screen.queryByText('Finish setting up')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open Accounting/ }));
    expect(openApp).toHaveBeenCalledWith('accounting');
    expect(screen.getByText('Not on your plan')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).toBeNull();
  });

  it('groups administration as the sidebar does, showing only pages this person may open', () => {
    const openScreen = vi.fn();
    const navItems = [
      { key: 'home', label: 'Overview' },
      { key: 'users', label: 'Users', icon: Users },
      { key: 'audit', label: 'Audit trail' },
    ];
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={navItems} openScreen={openScreen} />);
    expect(screen.getByRole('navigation', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Security' })).toBeInTheDocument();
    /* Nothing from Plan & billing was permitted, so the group is not shown at all. */
    expect(screen.queryByRole('navigation', { name: 'Plan & billing' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Audit trail' }));
    expect(openScreen).toHaveBeenCalledWith('audit');
  });

  it('shows owners the setup still to do, from the account’s real members', async () => {
    getAccountMe.mockResolvedValue({ role: 'OWNER' });
    listAccountMembers.mockResolvedValue({ members: [{ userId: 'u1' }] });
    render(<AdminHome tenant={tenant} catalog={CATALOG} navItems={[{ key: 'users', label: 'Users' }]} openScreen={() => {}} openMoreApps={() => {}} />);
    expect(await screen.findByText('Finish setting up')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Only you so far')).toBeInTheDocument());
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument();
  });
});
