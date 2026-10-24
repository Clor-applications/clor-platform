import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listBranches: vi.fn(), createBranch: vi.fn(), updateBranch: vi.fn(), deleteBranch: vi.fn(), apiFetch: vi.fn() }));
vi.mock('@platform/admin/admin', () => ({
  listBranches: (...a) => api.listBranches(...a),
  createBranch: (...a) => api.createBranch(...a),
  updateBranch: (...a) => api.updateBranch(...a),
  deleteBranch: (...a) => api.deleteBranch(...a),
}));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => api.apiFetch(...a) }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1' }));
vi.mock('@ui/permissions/ActionGuard', () => ({ PermissionButton: ({ permission: _p, ...props }) => <button type="button" {...props} /> }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, title, actions, children }) => (open ? <div role="dialog" aria-label={title}>{actions}{children}</div> : null) }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn(async () => true) }));

import { SettingsBranches, branchRows } from './SettingsBranches';
import CloseCompanyPage from './CloseCompanyPage';

const HO = { id: 'b1', branchCode: 'HO', branchName: 'Head Office', city: 'Bengaluru', state: 'Karnataka', addressLine1: 'MG Road', gstin: '29ABCDE1234F1Z5', isActive: true };
const B2 = { id: 'b2', branchCode: 'BRB42', branchName: 'Branch B', state: 'Karnataka', addressLine1: 'X', gstin: '', isActive: false };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listBranches.mockResolvedValue({ branches: [HO, B2] });
});

/* Redesign W-R5: Branches is a Workspace directory on the server's records. */
describe('Branches', () => {
  it('searches and sorts', () => {
    expect(branchRows([HO, B2], { q: 'bengal' }).map((b) => b.id)).toEqual(['b1']);
    expect(branchRows([HO, B2], { sort: 'branchCode', dir: -1 }).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('counts from the records and opens a branch in the drawer', async () => {
    render(<SettingsBranches orgId="org1" company={{ name: 'A' }} />);
    expect(await screen.findByText('Head Office')).toBeInTheDocument();
    expect(screen.getByText('1 marked inactive')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Head Office' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Head Office' }));
    expect(drawer.getByText('MG Road')).toBeInTheDocument();
  });

  it('refuses a branch without its state before calling the server', async () => {
    render(<SettingsBranches orgId="org1" company={{}} />);
    await screen.findByText('Head Office');
    fireEvent.click(screen.getByRole('button', { name: /Add branch/ }));
    const drawer = within(screen.getByRole('dialog', { name: 'Add a branch' }));
    fireEvent.change(drawer.getByLabelText(/Branch code/), { target: { value: 'NEW' } });
    fireEvent.submit(drawer.getByRole('button', { name: 'Add branch' }).closest('form'));
    expect(await drawer.findByRole('alert')).toHaveTextContent('State is required');
    expect(api.createBranch).not.toHaveBeenCalled();
  });
});

/* Redesign W-R9: closing waits for a fresh export and the typed name. */
describe('Close company', () => {
  it('needs a fresh export and the name typed before asking', async () => {
    api.apiFetch.mockResolvedValue({ canClose: true, noticeDays: 30, orgName: 'Anand Traders', lastFullExportAt: new Date().toISOString() });
    render(<CloseCompanyPage companyName="Anand Traders" />);
    const go = await screen.findByRole('button', { name: 'Close company after 30 days' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type Anand Traders to confirm'), { target: { value: 'anand traders' } });
    expect(go).toBeEnabled();
    api.apiFetch.mockResolvedValueOnce({ ok: true });
    fireEvent.click(go);
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/orgs/org1/closure', { method: 'POST', body: { confirmName: 'anand traders', reason: null } }));
  });

  it('a scheduled closure can be cancelled', async () => {
    api.apiFetch.mockResolvedValue({ canClose: true, noticeDays: 30, closure: { status: 'SCHEDULED', orgName: 'Anand Traders', requestedAt: '2026-10-01', deleteAfter: '2026-10-31' } });
    render(<CloseCompanyPage companyName="Anand Traders" />);
    fireEvent.click(await screen.findByRole('button', { name: /Cancel the closure/ }));
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/orgs/org1/closure', { method: 'DELETE' }));
  });
});
