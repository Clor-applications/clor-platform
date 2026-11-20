import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { memberDirectory: vi.fn(), listInvitations: vi.fn(), apiFetch: vi.fn() };
vi.mock('@platform/admin/account', () => ({ memberDirectory: (...a) => api.memberDirectory(...a), listInvitations: (...a) => api.listInvitations(...a) }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => api.apiFetch(...a) }));

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
  api.listInvitations.mockReset();
  api.listInvitations.mockResolvedValue({ invitations: [] });
  api.apiFetch.mockReset();
  api.apiFetch.mockResolvedValue({ invoices: [] });
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

  it('finds a CLOR invoice by its number, however it is typed, and opens it on Invoices', async () => {
    api.apiFetch.mockResolvedValue({
      invoices: [
        { id: 'i1', number: 'CLOR/INV-0042', status: 'PAID', overdue: false, total: 1179882, issueDate: '2026-11-01T00:00:00Z' },
        { id: 'i2', number: 'CLOR/INV-0057', status: 'ISSUED', overdue: true, total: 59000, issueDate: '2026-10-01T00:00:00Z' },
      ],
    });
    const found = await findInWorkspace('inv 0042');
    expect(found).toEqual([{ key: 'invoice:i1', label: 'CLOR/INV-0042', detail: '₹11,798.82 · Paid · 1 Nov 2026', group: 'Invoices', screen: 'invoices', params: { invoice: 'i1' } }]);
    expect((await findInWorkspace('INV-0057'))[0].detail).toBe('₹590.00 · Overdue · 1 Oct 2026');
    expect(api.apiFetch).toHaveBeenCalledWith('/billing/invoices');
    /* A name is not an invoice number. */
    expect((await findInWorkspace('ravi')).some((r) => r.group === 'Invoices')).toBe(false);
  });

  it('finds an invitation by the address it went to, and leaves out the ones who joined', async () => {
    api.listInvitations.mockResolvedValue({
      invitations: [
        { id: 'v1', email: 'meera@sundaram.test', status: 'PENDING' },
        { id: 'v2', email: 'meera.old@sundaram.test', status: 'EXPIRED' },
        { id: 'v3', email: 'meera.joined@sundaram.test', status: 'ACCEPTED' },
      ],
    });
    expect(await findInWorkspace('meera')).toEqual([
      { key: 'invitation:v1', label: 'meera@sundaram.test', detail: 'Waiting to join', group: 'Invitations', screen: 'invitations', params: { email: 'meera@sundaram.test' } },
      { key: 'invitation:v2', label: 'meera.old@sundaram.test', detail: 'Link expired', group: 'Invitations', screen: 'invitations', params: { email: 'meera.old@sundaram.test' } },
    ]);
  });

  it('a list the server refuses hides only itself', async () => {
    api.memberDirectory.mockRejectedValue(new Error('403'));
    api.listInvitations.mockRejectedValue(new Error('403'));
    api.apiFetch.mockResolvedValue({ invoices: [{ id: 'i1', number: 'CLOR/INV-0042', status: 'PAID', total: 100, issueDate: '2026-11-01T00:00:00Z' }] });
    expect((await findInWorkspace('0042')).map((r) => r.key)).toEqual(['invoice:i1']);
    await findInWorkspace('00421');
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
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
