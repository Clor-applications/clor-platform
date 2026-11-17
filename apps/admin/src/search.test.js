import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { memberDirectory: vi.fn() };
vi.mock('@platform/admin/account', () => ({ memberDirectory: (...a) => api.memberDirectory(...a) }));

import { adminApp as manifest } from '../manifest';
import { findInWorkspace, forgetWorkspaceSearch } from './search';

const directory = {
  members: [
    { userId: 'u1', name: 'Ravi Kumar', email: 'ravi@sundaram.test', status: 'ACTIVE' },
    { userId: 'u2', name: 'Arjun Das', email: 'arjun@sundaram.test', status: 'SUSPENDED' },
  ],
  companies: [{ orgId: 'c1', name: 'Sundaram Traders', gstin: '29AABCU9603R1ZJ' }, { orgId: 'c2', name: 'Sundaram Exports' }],
};

beforeEach(() => {
  forgetWorkspaceSearch();
  api.memberDirectory.mockReset();
  api.memberDirectory.mockResolvedValue(directory);
});

/* Owner, 17 Nov 2026: the bar found page names only; a name or a GSTIN found nothing. */
describe('Workspace search', () => {
  it('finds a person by name or email and opens their access on Members', async () => {
    expect(await findInWorkspace('ravi')).toEqual([{ key: 'member:u1', label: 'Ravi Kumar', detail: 'ravi@sundaram.test', group: 'Members', screen: 'members', params: { member: 'u1' } }]);
    expect((await findInWorkspace('arjun@'))[0].detail).toBe('arjun@sundaram.test · Suspended');
  });

  it('finds a company by name or GSTIN and opens its page', async () => {
    const found = await findInWorkspace('29AABCU');
    expect(found).toEqual([{ key: 'company:c1', label: 'Sundaram Traders', detail: '29AABCU9603R1ZJ', group: 'Companies', screen: 'companies', params: { open: 'c1' } }]);
    expect((await findInWorkspace('exports')).map((r) => r.label)).toEqual(['Sundaram Exports']);
  });

  it('reads the directory once for a run of keystrokes, and lists nothing when the server refuses', async () => {
    await findInWorkspace('su');
    await findInWorkspace('sun');
    expect(api.memberDirectory).toHaveBeenCalledTimes(1);
    forgetWorkspaceSearch();
    api.memberDirectory.mockRejectedValue(new Error('403'));
    expect(await findInWorkspace('ravi')).toEqual([]);
  });

  it('names jobs by the words an administrator types, each on a screen the Workspace has', () => {
    const screens = new Set(manifest.nav.map((n) => n.key));
    expect(manifest.searchActions.length).toBeGreaterThan(8);
    for (const a of manifest.searchActions) expect(screens.has(a.screen), a.label).toBe(true);
    const words = manifest.searchActions.flatMap((a) => a.keywords);
    for (const w of ['two-factor', 'api key', 'invite', 'accountant', 'invoice']) expect(words).toContain(w);
  });

  it('opens Security on its overview and keeps Permissions out of the menu', () => {
    const security = manifest.modules.find((m) => m.key === 'security');
    expect(security.items[0]).toBe('securityHome');
    const listed = manifest.modules.flatMap((m) => m.items || m.groups.flatMap((g) => g.items));
    expect(listed).not.toContain('permissions');
    expect(manifest.nav.find((n) => n.key === 'security').label).toBe('Sign-in rules');
  });
});
