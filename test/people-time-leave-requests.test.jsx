import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Time & Leave → Leave requests (TIME-LEAVE-DECISIONS.md): the list asks the
 * server for one page with its tab counts; a rejection needs a reason the
 * person will read; private leave shows no reason; the skipped dates say why.
 */
const api = vi.hoisted(() => ({
  pageLeaveRequests: vi.fn(),
  getLeaveRequest: vi.fn(),
  rejectLeave: vi.fn(() => Promise.resolve({})),
  approveLeave: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({
  ...(await orig()),
  ...api,
  getLeaveSettings: vi.fn(() => Promise.resolve({ current: { year: 2026, label: '2026' }, previous: { year: 2025, label: '2025' }, next: { year: 2027, label: '2027' } })),
  listLeaveTypes: vi.fn(() => Promise.resolve([])),
  listLeaveRequests: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));

const row = { id: 'r1', employeeId: 'e1', employeeName: 'Rekha Nair', employeeCode: 'MF-020', department: 'Design', leaveTypeName: 'Casual leave', leaveTypeId: 't1', fromDate: '2026-12-24', toDate: '2026-12-28', days: 3, status: 'PENDING', createdAt: new Date().toISOString(), isPaid: true, reason: 'Family wedding' };

describe('Leave requests', () => {
  beforeEach(() => {
    api.pageLeaveRequests.mockResolvedValue({ requests: [row], total: 1, counts: { PENDING: 1, APPROVED: 4, all: 5 } });
    api.getLeaveRequest.mockResolvedValue({
      request: row,
      history: [{ at: new Date().toISOString(), what: 'Entered for Rekha Nair', by: 'Asha Menon' }],
      dates: [{ date: '2026-12-24', counted: true, why: null }, { date: '2026-12-25', counted: false, why: 'Holiday: Christmas' }],
      balance: { label: '2026', without: 12, with: 9, available: 9 },
      parts: [], alsoAway: [], waitingForManager: null,
    });
    api.rejectLeave.mockClear();
  });

  it('asks the server for one page of the Waiting tab with the period, and shows the tab counts', async () => {
    const { default: LeaveRequests } = await import('../packages/ui/src/timeOff/LeaveRequests');
    render(<LeaveRequests params={{}} updateParams={() => {}} />);
    await screen.findAllByText('Rekha Nair');
    expect(api.pageLeaveRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', year: 2026, limit: 25, offset: 0 }));
    expect(screen.getByRole('tab', { name: /Approved/ })).toHaveTextContent('4');
  });

  it('a rejection needs a reason; the skipped dates say why; the balance shows with and without', async () => {
    const { default: LeaveRequests } = await import('../packages/ui/src/timeOff/LeaveRequests');
    const user = userEvent.setup();
    render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    await screen.findByText('Holiday: Christmas');
    expect(screen.getByText(/12 days without this request/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reject/ }));
    expect(await screen.findByText('Say why. They see this with the decision.')).toBeInTheDocument();
    expect(api.rejectLeave).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Note to them'), 'Year-end audit week');
    await user.click(screen.getByRole('button', { name: /Reject/ }));
    await waitFor(() => expect(api.rejectLeave).toHaveBeenCalledWith('r1', 'Year-end audit week'));
  });

  it('private leave shows no reason', async () => {
    api.getLeaveRequest.mockResolvedValueOnce({ request: { ...row, leaveTypeName: 'Private leave', reason: null, reasonHidden: true }, history: [], dates: [], balance: null, parts: [], alsoAway: [], waitingForManager: null });
    const { default: LeaveRequests } = await import('../packages/ui/src/timeOff/LeaveRequests');
    render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    const note = await screen.findByText('Private: HR reads the reason.');
    /* The list behind may show its own (non-private) row's reason; the open request must not. */
    const drawer = note.closest('[role="dialog"]') || note.closest('aside') || note.parentElement.parentElement;
    expect(within(drawer).queryByText('Family wedding')).not.toBeInTheDocument();
  });

  it('with no leave types yet, Enter leave says so and opens Leave Policy', async () => {
    const { EnterLeave } = await import('../packages/ui/src/timeOff/LeaveRequests');
    const user = userEvent.setup();
    const openScreen = vi.fn();
    const onClose = vi.fn();
    render(<EnterLeave openScreen={openScreen} onClose={onClose} onDone={() => {}} />);
    expect(await screen.findByText(/No leave types yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up leave types' }));
    expect(onClose).toHaveBeenCalled();
    expect(openScreen).toHaveBeenCalledWith('leaveTypes');
  });

  it('on the approval engine: the steps as a short timeline, who decides now, and the leave right still decides', async () => {
    api.getLeaveRequest.mockResolvedValueOnce({
      request: row, history: [], dates: [], balance: null, parts: [], alsoAway: [], waitingForManager: null,
      step: { engine: true, rule: 'Standard: the manager, then HR', of: 2, current: 2, waitingFor: ['Asha', 'Kavya'], dueAt: null, yours: false,
        timeline: [{ order: 1, status: 'APPROVED', text: 'Ravi (manager) approved', on: '2026-10-31' }, { order: 2, status: 'WAITING', text: 'Waiting for Asha, Kavya (HR)', on: '2026-11-03' }] },
    });
    const { default: LeaveRequests } = await import('../packages/ui/src/timeOff/LeaveRequests');
    render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    expect(await screen.findByText('Ravi (manager) approved')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Steps' })).toHaveTextContent('Waiting for Asha, Kavya (HR)');
    expect(screen.getByText('Standard: the manager, then HR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/ })).toBeNull();
  });

  it('on the approval engine: buttons only when the step is the reader’s; while the manager decides, HR may only reject', async () => {
    const base = { request: row, history: [], dates: [], balance: null, parts: [], alsoAway: [], waitingForManager: null };
    const step = { engine: true, rule: 'Leave (v1)', of: 2, current: 1, waitingFor: ['Ravi'], dueAt: null, timeline: [{ order: 1, status: 'WAITING', text: 'Waiting for Ravi (manager)', on: null }] };
    const { default: LeaveRequests } = await import('../packages/ui/src/timeOff/LeaveRequests');
    api.getLeaveRequest.mockResolvedValueOnce({ ...base, step: { ...step, yours: true, mayReject: false } });
    const { unmount } = render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    expect(await screen.findByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument();
    unmount();
    api.getLeaveRequest.mockResolvedValueOnce({ ...base, step: { ...step, yours: false, mayReject: true } });
    render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    expect(await screen.findByRole('button', { name: /Reject/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });
});
