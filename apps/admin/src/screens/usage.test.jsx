import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getAccountMe: vi.fn(), memberDirectory: vi.fn(), getAccountOverview: vi.fn() }));
vi.mock('@platform/admin/account', () => ({ getAccountMe: (...a) => api.getAccountMe(...a), memberDirectory: (...a) => api.memberDirectory(...a) }));
vi.mock('@platform/admin/admin', () => ({ getAccountOverview: (...a) => api.getAccountOverview(...a) }));

import Usage from './Usage';
import { allowances, idleMembers, seatHolders, seatRows } from './usageModel';

const NOW = new Date('2026-11-20T06:00:00Z').getTime();
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const member = (over) => ({ userId: 'u', name: 'Somebody', email: 's@example.com', status: 'ACTIVE', canSignIn: true, lastSignInAt: ago(1), companies: [{ orgId: 'o1', apps: ['people'] }], ...over });

describe('usage figures', () => {
  it('counts seats in use against seats bought and says what is left', () => {
    const dir = [member({ userId: 'a' }), member({ userId: 'b', companies: [{ apps: ['people', 'payroll'] }] }), member({ userId: 'c', status: 'SUSPENDED' })];
    expect(seatRows(dir, [{ app: 'people', bought: 2 }, { app: 'payroll', bought: 5 }, { app: 'accounting', bought: null }], ['people', 'payroll', 'accounting'])).toEqual([
      { app: 'people', used: 2, bought: 2, left: 0, state: 'full' },
      { app: 'payroll', used: 1, bought: 5, left: 4, state: 'ok' },
      { app: 'accounting', used: 0, bought: null, left: null, state: 'open' },
    ]);
    expect(seatRows(dir, [{ app: 'people', bought: 1 }], ['people'])[0]).toMatchObject({ left: -1, state: 'over' });
  });

  it('lists people with a seat who have not signed in for 30 days, never-signed-in first', () => {
    const iso = (days) => new Date(NOW - days * 86_400_000).toISOString();
    const dir = [
      member({ userId: 'recent', name: 'Recent', lastSignInAt: iso(3) }),
      member({ userId: 'away', name: 'Away', lastSignInAt: iso(45) }),
      member({ userId: 'longer', name: 'Longer', lastSignInAt: iso(90) }),
      member({ userId: 'never', name: 'Never', lastSignInAt: null }),
      member({ userId: 'noapp', name: 'No app', lastSignInAt: null, companies: [{ apps: [] }] }),
      member({ userId: 'blocked', name: 'Blocked', lastSignInAt: null, canSignIn: false }),
      member({ userId: 'left', name: 'Left', lastSignInAt: null, status: 'SUSPENDED' }),
    ];
    expect(idleMembers(dir, NOW).map((m) => [m.userId, m.days])).toEqual([['never', null], ['longer', 90], ['away', 45]]);
    expect(seatHolders(dir)).toBe(4);
  });

  it('shows only the caps the plan sets', () => {
    expect(allowances({ plan: { limits: { maxUsers: 25 } }, usage: { users: 9, companies: 2 } })).toEqual([{ key: 'users', label: 'Users', used: 9, limit: 25 }]);
    expect(allowances({ plan: { limits: {} }, usage: {} })).toEqual([]);
  });
});

const overview = {
  plan: { name: 'Growth', limits: { maxCompanies: 2, maxUsers: 25 } },
  usage: { companies: 2, users: 3 },
  seats: [{ app: 'people', bought: 2 }, { app: 'accounting', bought: null }],
  companies: [
    { orgId: 'o1', name: 'Kaveri Traders', people: 3, apps: ['accounting', 'people'], archived: null },
    { orgId: 'o2', name: 'Kaveri Retail', people: 1, apps: ['accounting'], archived: null },
    { orgId: 'o3', name: 'Old Co', people: 9, apps: ['accounting', 'payroll'], archived: { at: '2026-01-01' } },
  ],
};
const directory = {
  members: [
    member({ userId: 'u1', name: 'Asha Rao', email: 'asha@example.com', companies: [{ orgId: 'o1', apps: ['accounting', 'people'] }] }),
    member({ userId: 'u2', name: 'Vikram Shah', email: 'vikram@example.com', lastSignInAt: ago(60), companies: [{ orgId: 'o1', apps: ['people'] }] }),
    member({ userId: 'u3', name: 'Meera Iyer', email: 'meera@example.com', lastSignInAt: null, companies: [{ orgId: 'o2', apps: ['accounting'] }] }),
  ],
};
const catalog = [{ id: 'accounting', name: 'Books', available: true }, { id: 'people', name: 'People', available: true }, { id: 'payroll', name: 'Payroll', available: true }, { id: 'admin', platform: true, available: true }];
const nav = [{ key: 'billing' }, { key: 'members' }];

describe('Workspace → Usage', () => {
  beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

  it('shows seats by app, who is not signing in, each open company and the plan allowance', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'OWNER' });
    api.getAccountOverview.mockResolvedValue(overview);
    api.memberDirectory.mockResolvedValue(directory);
    const openScreen = vi.fn();
    render(<Usage tenant={{ id: 'o1' }} catalog={catalog} navItems={nav} openScreen={openScreen} />);

    const seats = within(await screen.findByRole('table', { name: /Seats bought and in use/ })).getAllByRole('row');
    /* Payroll is on only in the archived company and has no seats bought: not listed. */
    expect(seats).toHaveLength(3);
    expect(seats[1]).toHaveTextContent('Books');
    expect(seats[1]).toHaveTextContent('No limit');
    expect(seats[2]).toHaveTextContent('People');
    expect(within(seats[2]).getByText('Full')).toBeInTheDocument();
    /* A tag only on the exception row. */
    expect(seats[1].querySelector('.ws-pill')).toBeNull();

    const idle = within(screen.getByRole('table', { name: /not signing in/ })).getAllByRole('row');
    expect(idle).toHaveLength(3);
    expect(idle[1]).toHaveTextContent('Meera Iyer');
    expect(idle[1]).toHaveTextContent('Never signed in');
    expect(idle[2]).toHaveTextContent('Vikram Shah');
    expect(idle[2]).toHaveTextContent('60 days ago');

    const cos = screen.getByRole('table', { name: /each company/ });
    expect(cos).toHaveTextContent('Kaveri Retail');
    expect(cos).not.toHaveTextContent('Old Co');

    const caps = within(screen.getByRole('table', { name: /plan allows/ })).getAllByRole('row');
    expect(within(caps[1]).getByText('At the limit')).toBeInTheDocument();
    expect(caps[2].querySelector('.ws-pill')).toBeNull();

    const figures = screen.getByLabelText('Usage figures');
    expect(figures).toHaveTextContent('3 people with a seat');
    expect(figures).toHaveTextContent('2 not signing in');
    expect(figures).toHaveTextContent('1 app out of seats');

    fireEvent.click(screen.getByRole('button', { name: 'Open Members' }));
    expect(openScreen).toHaveBeenCalledWith('members');
    fireEvent.click(screen.getByRole('button', { name: 'Change plan or seats' }));
    expect(openScreen).toHaveBeenCalledWith('billing');
  });

  it('a billing admin sees the plan side without the list of people', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'BILLING_ADMIN' });
    api.getAccountOverview.mockResolvedValue(overview);
    render(<Usage tenant={{ id: 'o1' }} catalog={catalog} navItems={nav} />);
    expect(await screen.findByRole('table', { name: /plan allows/ })).toBeInTheDocument();
    expect(api.memberDirectory).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Not signing in' })).toBeNull();
    expect(screen.getByText('Seats in use are shown to owners and administrators.')).toBeInTheDocument();
  });

  it('a member is told who sees usage, and nothing is read for them', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'MEMBER' });
    render(<Usage tenant={{ id: 'o1' }} catalog={catalog} navItems={[]} />);
    expect(await screen.findByText(/Only the account’s owners, administrators and billing admins see usage/)).toBeInTheDocument();
    expect(api.getAccountOverview).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Change plan or seats' })).toBeNull();
  });

  it('says so when everyone with a seat is signing in', async () => {
    api.getAccountMe.mockResolvedValue({ role: 'ADMIN' });
    api.getAccountOverview.mockResolvedValue(overview);
    api.memberDirectory.mockResolvedValue({ members: [directory.members[0]] });
    render(<Usage tenant={{ id: 'o1' }} catalog={catalog} navItems={nav} />);
    expect(await screen.findByText('Everyone with a seat has signed in during the last 30 days.')).toBeInTheDocument();
  });
});
