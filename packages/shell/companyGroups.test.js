import { describe, expect, it, vi } from 'vitest';

vi.mock('./registry', () => ({ APPS: [], appById: () => null, availableApps: () => [], landingApp: () => null, subscribedApps: () => [] }));

/*
 * W-2.1: the company picker doubles as the account switcher. One account is a
 * plain list; several are grouped under each account's name, the person's own
 * account first, with their role there or "outside access".
 */
describe('the company picker as an account switcher', async () => {
  const { companyGroups } = await import('./Shell.jsx');
  const tenants = [
    { id: 'c1', name: 'Anand Traders', accountId: 'A' },
    { id: 'c2', name: 'Client Co', accountId: 'B' },
    { id: 'c3', name: 'Anand Exports', accountId: 'A' },
  ];
  const accounts = [
    { id: 'B', name: 'Mehta Group', home: false, role: null },
    { id: 'A', name: 'Anand Group', home: true, role: 'OWNER' },
  ];

  it('is a plain list for one account', () => {
    const g = companyGroups(tenants.filter((t) => t.accountId === 'A'), accounts);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe('');
  });

  it('groups by account, home first, saying how the person is there', () => {
    const g = companyGroups(tenants, accounts);
    expect(g.map((x) => x.label)).toEqual(['Anand Group (owner)', 'Mehta Group (outside access)']);
    expect(g[0].items.map((t) => t.id)).toEqual(['c1', 'c3']);
  });
});

/* W-2.2: an access-denied page names the permission in words a person reads. */
describe('permission words', async () => {
  const { permissionWords } = await import('./Shell.jsx');
  it('reads MODULE::Sub::ACTION as an action on a thing', () => {
    expect(permissionWords('SETTINGS::Users::VIEW')).toBe('view Users (Settings)');
    expect(permissionWords('PAYROLL::Pay runs::APPROVE')).toBe('approve Pay runs (Payroll)');
  });

  it('lists archived companies last, under their own heading', async () => {
    const { companyGroups } = await import('./Shell.jsx');
    const g = companyGroups([{ id: 'x', name: 'Old', accountId: 'A', archivedAt: '2026-10-01' }, { id: 'y', name: 'Live', accountId: 'A' }], [{ id: 'A', name: 'Acc', home: true }]);
    expect(g.map((x) => x.id)).toEqual(['all', 'archived']);
    expect(g[0].items.map((t) => t.id)).toEqual(['y']);
    expect(g[1].items.map((t) => t.id)).toEqual(['x']);
  });
});

describe("a phone's company menu keeps each account's name (#80 re-review)", () => {
  it('lists same-named companies under their own account, the one in use ticked', async () => {
    const React = (await import('react')).default;
    const { render, screen, within, cleanup } = await import('@testing-library/react');
    const { CompanyMenuItems, companyGroups } = await import('./Shell.jsx');
    const tenants = [
      { id: 'c1', name: 'Asha Textiles', accountId: 'a1' },
      { id: 'c2', name: 'Asha Textiles', accountId: 'a2' },
    ];
    const accounts = [{ id: 'a1', name: 'Suresh', home: true, role: 'OWNER' }, { id: 'a2', name: 'Kumar & Co', home: false }];
    const picked = [];
    render(React.createElement(CompanyMenuItems, { groups: companyGroups(tenants, accounts), currentId: 'c1', onPick: (t) => picked.push(t.id) }));
    const other = screen.getByRole('group', { name: 'Kumar & Co (outside access)' });
    within(other).getByRole('menuitemradio', { name: 'Asha Textiles' }).click();
    expect(picked).toEqual(['c2']);
    expect(screen.getAllByRole('menuitemradio', { checked: true })).toHaveLength(1);
    cleanup();
  });
});
