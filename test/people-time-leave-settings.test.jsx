import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const perms = { current: { isAdmin: true, permissions: new Set() } };
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));
vi.mock('@ui/personnel/api', () => ({ listStructure: vi.fn(async () => []) }));
vi.mock('../apps/people/src/timeOff/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getWorkingWeek: vi.fn(),
  saveWorkingWeek: vi.fn(async (body) => body),
  listLeaveTypes: vi.fn(),
  getLeaveSettings: vi.fn(async () => ({ startDay: 1, startMonth: 4, current: { label: 'Apr 2026 – Mar 2027' } })),
  previewLeaveType: vi.fn(),
  createLeaveType: vi.fn(async (body) => ({ type: { id: 'new', ...body } })),
  updateLeaveType: vi.fn(),
  deleteLeaveType: vi.fn(),
  saveLeaveSettings: vi.fn(),
}));

import * as api from '../apps/people/src/timeOff/api';
import WorkingWeek from '../apps/people/src/timeOff/WorkingWeek';
import LeavePolicy from '../apps/people/src/timeOff/LeavePolicy';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

/* TIME-LEAVE-DECISIONS M2: a People-only company says which days are off, so leave stops charging them. */
describe('Working week', () => {
  it('saves the days off once something changed', async () => {
    api.getWorkingWeek.mockResolvedValue({ weeklyOffDays: '0', offSaturdays: '', shiftsDecide: false });
    render(<WorkingWeek />);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Saturday' }));
    expect(screen.queryByText('Saturdays')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(api.saveWorkingWeek).toHaveBeenCalledWith({ weeklyOffDays: '0,6', offSaturdays: '', restrictedHolidayQuota: 0, compOffLeaveTypeId: null }));
  });

  /* Advanced build: how many restricted holidays a person may pick a year, saved with the week. */
  it('saves the restricted holiday quota with the week', async () => {
    api.getWorkingWeek.mockResolvedValue({ weeklyOffDays: '0', offSaturdays: '', shiftsDecide: false, restrictedHolidayQuota: 0 });
    render(<WorkingWeek />);
    const save = await screen.findByRole('button', { name: 'Save' });
    fireEvent.change(screen.getByLabelText('Restricted holidays a person may pick a year'), { target: { value: '2' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.saveWorkingWeek).toHaveBeenCalledWith({ weeklyOffDays: '0', offSaturdays: '', restrictedHolidayQuota: 2, compOffLeaveTypeId: null }));
  });

  it('refuses a week with no working day', async () => {
    api.getWorkingWeek.mockResolvedValue({ weeklyOffDays: '0,6', offSaturdays: '', shiftsDecide: false });
    render(<WorkingWeek />);
    await screen.findByRole('button', { name: 'Save' });
    for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) fireEvent.click(screen.getByRole('button', { name: d }));
    expect(screen.getByRole('alert')).toHaveTextContent('At least one day of the week is a working day.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says when shifts decide, and is read only without the right to change leave types', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Leave Requests::VIEW']) };
    api.getWorkingWeek.mockResolvedValue({ weeklyOffDays: '0', offSaturdays: '2,4', shiftsDecide: true });
    render(<WorkingWeek />);
    expect(await screen.findByText(/People on a shift follow its weekly offs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Monday' })).toBeDisabled();
  });
});

const CASUAL = { id: 't1', name: 'Casual Leave', code: 'CL', isPaid: true, isActive: true, isPrivate: false, annualDays: 12, accrual: 'MONTHLY', creditOn: 'START', requests: 3, employeeTypeIds: [] };
const PREVIEW = {
  period: { label: 'Apr 2026 – Mar 2027' },
  rows: [
    { employeeId: 'e1', name: 'Asha Rao', why: 'Newest joiner', dateOfJoining: '2026-09-01', open: true, note: null, fullPeriod: 7, soFar: 2, credits: [{ date: '2026-09-01', days: 1 }, { date: '2099-11-01', days: 1 }] },
    { employeeId: 'e2', name: 'Ravi Kumar', why: 'Longest serving', dateOfJoining: '2019-01-01', open: false, note: 'For women only.', fullPeriod: 12, soFar: 7, credits: [] },
  ],
  carry: null,
};

describe('Leave Policy', () => {
  it('tries the type on five people, and offers a new type when the one in use refuses the change', async () => {
    api.listLeaveTypes.mockResolvedValue([CASUAL]);
    api.previewLeaveType.mockResolvedValue(PREVIEW);
    api.updateLeaveType.mockRejectedValue(Object.assign(new Error('This policy already has balances or requests.'), { status: 409, code: 'LEAVE_POLICY_IN_USE' }));
    render(<LeavePolicy />);
    fireEvent.click((await screen.findAllByText('Casual Leave'))[0]);
    const drawer = await screen.findByRole('dialog');

    const tried = await within(drawer).findByText('Asha Rao', {}, { timeout: 2000 });
    const row = tried.closest('tr');
    expect(within(row).getByText(/^Newest joiner · joined 1 Sep/)).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText(/^1 on /)).toBeInTheDocument();
    expect(within(drawer).getByText('For women only.')).toBeInTheDocument();
    expect(api.previewLeaveType.mock.calls[0][0]).toMatchObject({ annualDays: 12, accrual: 'MONTHLY', isPrivate: false });

    fireEvent.change(within(drawer).getByLabelText('Days a year'), { target: { value: '15' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
    const fork = await within(drawer).findByRole('button', { name: /Make a new type from this/ });
    fireEvent.click(fork);

    expect(await screen.findByRole('heading', { name: 'New leave type' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Casual Leave (new)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createLeaveType).toHaveBeenCalled());
    expect(api.createLeaveType.mock.calls[0][0]).toMatchObject({ name: 'Casual Leave (new)', annualDays: 15, accrual: 'MONTHLY', isActive: true });
  });

  it('offers sick and maternity leave as private', async () => {
    api.listLeaveTypes.mockResolvedValue([]);
    api.previewLeaveType.mockResolvedValue({ period: { label: 'x' }, rows: [], carry: null });
    render(<LeavePolicy />);
    fireEvent.click(await screen.findByRole('button', { name: /Sick Leave/ }));
    expect(await screen.findByRole('checkbox', { name: /Private/ })).toBeChecked();
    cleanup();
    render(<LeavePolicy />);
    fireEvent.click(await screen.findByRole('button', { name: /Casual Leave/ }));
    expect(await screen.findByRole('checkbox', { name: /Private/ })).not.toBeChecked();
  });
});
