import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Settings → Leave block dates (owner, 29 Oct 2026, from ERPNext's Leave
 * Block List): a list of blocks with who they hold for, and a drawer that
 * sends the name, the days, and the departments and types chosen.
 */
const api = vi.hoisted(() => ({
  listLeaveBlocks: vi.fn(),
  createLeaveBlock: vi.fn(() => Promise.resolve({ block: { id: 'b2' } })),
  updateLeaveBlock: vi.fn(() => Promise.resolve({ block: {} })),
  deleteLeaveBlock: vi.fn(() => Promise.resolve({ ok: true })),
  listLeaveTypes: vi.fn(() => Promise.resolve([{ id: 't1', name: 'Casual leave', isActive: true }, { id: 't2', name: 'Sick leave', isActive: true }])),
  listPeople: vi.fn(() => Promise.resolve([{ id: 'e1', name: 'Rekha Nair', code: 'MF-020' }])),
}));
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...api }));
vi.mock('@ui/personnel/api', async (orig) => ({ ...(await orig()), listStructure: vi.fn(() => Promise.resolve([{ id: 'd1', name: 'Accounts' }, { id: 'd2', name: 'Sales' }])) }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import LeaveBlocks from '../packages/ui/src/timeOff/LeaveBlocks';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

describe('Leave block dates', () => {
  it('lists each block with who it holds for', async () => {
    api.listLeaveBlocks.mockResolvedValue([{ id: 'b1', name: 'Year-end close', fromDate: '2027-03-29', toDate: '2027-03-31', departmentIds: ['d1'], leaveTypeIds: [], allowedEmployeeIds: ['e1'] }]);
    render(<LeaveBlocks />);
    expect(await screen.findAllByText('Year-end close')).not.toHaveLength(0);
    expect(await screen.findAllByText(/Accounts/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Every type/).length).toBeGreaterThan(0);
  });

  it('adds a block for one department and one leave type', async () => {
    api.listLeaveBlocks.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<LeaveBlocks />);
    await screen.findByText('No days blocked');
    await user.click(screen.getByRole('button', { name: /Add block/ }));
    await user.type(screen.getByLabelText('Name *'), 'Diwali rush');
    const first = screen.getByLabelText('First day');
    fireEvent.change(first, { target: { value: '02/11/2026' } });
    fireEvent.blur(first);
    await user.click(await screen.findByRole('button', { name: 'Sales' }));
    await user.click(screen.getByRole('button', { name: 'Casual leave' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createLeaveBlock).toHaveBeenCalledWith({ name: 'Diwali rush', fromDate: '2026-11-02', toDate: '2026-11-02', departmentIds: ['d2'], leaveTypeIds: ['t1'], allowedEmployeeIds: [] }));
  });

  it('is read only without the right to change leave types', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Leave Types::VIEW']) };
    api.listLeaveBlocks.mockResolvedValue([]);
    render(<LeaveBlocks />);
    await screen.findByText('No days blocked');
    expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull();
  });
});
