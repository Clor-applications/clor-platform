import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/api/permissions', () => ({ getPermissionCatalog: vi.fn() }));

/* Redesign W-R6: the Users list filters by search (name, email, user ID, role) and status. */
describe('the users list filter', async () => {
  const { filterUsers } = await import('./SettingsUsers.jsx');
  const users = [
    { id: 1, fullName: 'Rohit Rao', email: 'rohit@x.in', code: 'U01', roleId: 'r1' },
    { id: 2, fullName: 'Kavya', email: 'kavya@x.in', code: 'U02', roleId: 'r2', isActive: false },
  ];
  const role = (id) => ({ r1: 'Accountant', r2: 'Viewer' })[id] || '';

  it('matches name, email, user ID and role name', () => {
    expect(filterUsers(users, { q: 'rohit' }, role).map((u) => u.id)).toEqual([1]);
    expect(filterUsers(users, { q: 'u02' }, role).map((u) => u.id)).toEqual([2]);
    expect(filterUsers(users, { q: 'account' }, role).map((u) => u.id)).toEqual([1]);
  });
  it('filters by whether they may sign in', () => {
    expect(filterUsers(users, { status: 'inactive' }, role).map((u) => u.id)).toEqual([2]);
    expect(filterUsers(users, { status: 'active' }, role).map((u) => u.id)).toEqual([1]);
  });
});
