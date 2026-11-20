import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listUsers: vi.fn(), listRoles: vi.fn(), listBranches: vi.fn(), deleteUser: vi.fn(), reactivateUser: vi.fn(), changeUserPassword: vi.fn(),
}));
vi.mock('@platform/admin/admin', async (orig) => {
  const real = await orig();
  return Object.fromEntries(Object.keys(real).map((k) => [k, k in api ? (...a) => api[k](...a) : vi.fn(async () => ({}))]));
});
vi.mock('@ui/api/permissions', () => ({ getPermissionCatalog: vi.fn() }));
vi.mock('@ui/permissions/useFeatures', () => ({ useFeatures: () => ({ isEnabled: () => false }) }));
vi.mock('@ui/permissions/ActionGuard', () => ({ PermissionButton: ({ permission: _permission, ...p }) => <button {...p} /> }));
vi.mock('./UserAccessPanel', () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast, confirmDialog: vi.fn(async () => true) }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, title, children }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null) }));

import { SettingsUsers } from './SettingsUsers';

const USERS = [{ id: 'u1', fullName: 'Rohit Rao', email: 'rohit@x.in', roleId: '', isActive: false }];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset().mockResolvedValue({}));
  Object.values(toast).forEach((f) => f.mockReset());
  api.listRoles.mockResolvedValue({ roles: [] });
  api.listUsers.mockResolvedValue({ users: USERS });
});

/* Audit 21 Nov 2026: a failed read looked like an empty company; remove and reactivate had no busy state. */
describe('Company users', () => {
  it('a failed load offers a retry instead of an empty company', async () => {
    api.listUsers.mockRejectedValueOnce(new Error('down'));
    render(<SettingsUsers orgId="c1" />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText(/Everyone who signs in to this company will be listed here/)).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('Rohit Rao')).toBeInTheDocument();
  });

  it('holds the row while a reactivate is out, then says it worked', async () => {
    let finish;
    api.reactivateUser.mockImplementation(() => new Promise((r) => { finish = r; }));
    render(<SettingsUsers orgId="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Rohit Rao' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    const trigger = await screen.findByRole('button', { name: 'Reactivating Rohit Rao…' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    finish({});
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rohit Rao is reactivated.'));
    expect(api.reactivateUser).toHaveBeenCalledTimes(1);
  });

  it('says a new password was set', async () => {
    render(<SettingsUsers orgId="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Rohit Rao' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Set a password' }));
    fireEvent.change(screen.getByLabelText(/New password/, { selector: 'input' }), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('New password set for Rohit Rao. Tell them yourself.'));
  });
});
