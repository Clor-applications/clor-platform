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
