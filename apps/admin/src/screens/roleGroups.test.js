import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/permissions', () => ({ getPermissionCatalog: vi.fn() }));

/* W-5.1: roles grouped by what they open, from their own permissions. */
describe('the role catalogue’s groups', async () => {
  const { roleGroup } = await import('./SettingsRoles.jsx');
  const role = (roleType, modules) => ({ roleType, _normalizedPermissions: modules.map((module) => ({ module, allowed: true })) });

  it('puts administrators first, apart from any app', () => {
    expect(roleGroup(role('ADMIN', ['SALES', 'PAYROLL']))).toBe('Company administration');
  });
  it('groups a role by the one app it opens', () => {
    expect(roleGroup(role('CUSTOM', ['SALES', 'MASTERS']))).toBe('Accounting');
    expect(roleGroup(role('CUSTOM', ['PAYROLL']))).toBe('Payroll');
    expect(roleGroup(role('CUSTOM', ['PEOPLE', 'ATTENDANCE']))).toBe('People and Attendance');
  });
  it('says when a role reaches several apps, or none', () => {
    expect(roleGroup(role('CUSTOM', ['SALES', 'PAYROLL']))).toBe('Across apps');
    expect(roleGroup(role('CUSTOM', ['SETTINGS', 'REPORTS']))).toBe('Settings and reports only');
  });
});
