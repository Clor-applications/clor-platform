import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Approvals from './Approvals';
import { PermissionContext } from '@ui/permissions/context';
import { bulkReviewOvertime, bulkReviewPunches } from '@ui/timeOff/api';

/*
 * Time depth, gap 18: field punches and overtime wait in the one Approvals
 * inbox, are approved from their row, and open to say where and why.
 */
vi.mock('../api/approvals', () => ({
  getInbox: vi.fn().mockResolvedValue({
    counts: { all: 2, PUNCH: 1, OVERTIME: 1, TASK: 1, waiting: 3 },
    tasks: [{ id: 't1', kind: 'JOINING', title: 'Collect the signed offer', owner: 'HR', dueDate: '2026-11-03', overdue: true, employee: { id: 'e3', name: 'Dev Kumar', code: 'MF-007' } }],
    rights: { LEAVE: { see: false }, ATTENDANCE: { see: false }, APPROVAL: { see: false }, HELPDESK: { see: false }, PUNCH: { see: true, decide: true }, OVERTIME: { see: true, decide: true } },
    items: [
      { key: 'PUNCH:p1', kind: 'PUNCH', id: 'p1', what: 'Field punch in', subKind: 'IN', employeeId: 'e1', employeeName: 'Ravi Das', employeeCode: 'MF-002', fromDate: '2026-10-29', toDate: '2026-10-29', fromTime: '09:12', place: 'Client site, Koramangala', accuracy: 18, since: new Date().toISOString(), bulk: true },
      { key: 'OVERTIME:o1', kind: 'OVERTIME', id: 'o1', what: 'Overtime', subKind: 'OVERTIME', employeeId: 'e2', employeeName: 'Priya Kumar', employeeCode: 'MF-004', fromDate: '2026-10-27', toDate: '2026-10-27', minutes: 110, reason: 'Month-end stock count', since: new Date().toISOString(), bulk: true },
    ],
  }),
  listRequests: vi.fn().mockResolvedValue({ mine: [], waitingForMe: [] }),
  bulkDecideRequests: vi.fn(), decideRequest: vi.fn(), replyRequest: vi.fn(), withdrawRequest: vi.fn(),
  getRequest: vi.fn().mockResolvedValue({ id: 'a9', requestType: 'JOB_CHANGE', title: 'Designation for Anu', status: 'WITHDRAWN', requesterName: 'Anu Asker', createdAt: '2026-10-31T06:00:00Z', payload: { fields: { designation: { before: null, after: 'Lead' } } }, steps: [] }),
}));
vi.mock('@ui/timeOff/api', () => ({ bulkReviewLeave: vi.fn(), bulkReviewRequests: vi.fn(), bulkReviewPunches: vi.fn(), bulkReviewOvertime: vi.fn() }));
vi.mock('@ui/personnel/api', () => ({ updateChecklistTask: vi.fn() }));
vi.mock('@ui/timeOff/LeaveRequests', () => ({ RequestDrawer: () => null }));
vi.mock('@ui/timeOff/AttendanceRequests', () => ({ RequestDrawer: () => null, KIND_NAME: {} }));
vi.mock('@ui/personnel/Employees', () => ({ Avatar: () => null, SCHEDULED_LABELS: {} }));

const mount = () => render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><Approvals params={{}} updateParams={() => {}} /></PermissionContext.Provider>);
beforeEach(() => vi.clearAllMocks());

it('lists a field punch and an overtime ask in words, and approves the punch from its row', async () => {
  bulkReviewPunches.mockResolvedValue({ done: 1, failed: 0, results: [] });
  mount();
  const punchRow = (await screen.findAllByText('In at 09:12'))[0].closest('tr');
  expect(within(punchRow).getByText('Field punch')).toBeTruthy();
  expect(screen.getAllByText('1h 50m').length).toBeGreaterThan(0);
  fireEvent.click(within(punchRow).getByRole('button', { name: /approve/i }));
  await waitFor(() => expect(bulkReviewPunches).toHaveBeenCalledWith(['p1'], true));
});

it('opens an overtime ask with its reason, and rejecting needs a note', async () => {
  bulkReviewOvertime.mockResolvedValue({ done: 1, failed: 0, results: [] });
  mount();
  fireEvent.click((await screen.findAllByText('1h 50m'))[0]);
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText('“Month-end stock count”')).toBeTruthy();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
  expect(bulkReviewOvertime).not.toHaveBeenCalled();
  fireEvent.change(within(drawer).getByPlaceholderText('Needed to reject'), { target: { value: 'Not agreed beforehand' } });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Reject' }));
  await waitFor(() => expect(bulkReviewOvertime).toHaveBeenCalledWith(['o1'], false, 'Not agreed beforehand'));
});

it('a field punch opened says where it was made', async () => {
  mount();
  fireEvent.click((await screen.findAllByText('In at 09:12'))[0]);
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText('Client site, Koramangala')).toBeTruthy();
  expect(within(drawer).getByRole('button', { name: 'Refuse' })).toBeTruthy();
});

it('a notice about a withdrawn request opens it, closed, with nothing to decide (Company choices, SPEC 3.6)', async () => {
  render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><Approvals params={{ open: 'APPROVAL', id: 'a9' }} updateParams={() => {}} /></PermissionContext.Provider>);
  const drawer = await screen.findByRole('dialog');
  expect(await within(drawer).findByText('Anu Asker', { exact: false })).toBeTruthy();
  expect(within(drawer).getByText(/Withdrawn/)).toBeTruthy();
  expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
});

/* People plan 8 Nov 2026, step 2: my open tasks beside To approve, each done from its row; the tab counts add up to the one waiting number. */
it('has a My tasks tab with the task count, lists my open tasks, and marks one done from its row', async () => {
  const { updateChecklistTask } = await import('@ui/personnel/api');
  updateChecklistTask.mockResolvedValue({});
  const updateParams = vi.fn();
  render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><Approvals params={{}} updateParams={updateParams} /></PermissionContext.Provider>);
  const approve = await screen.findByRole('tab', { name: /To approve/ });
  expect(within(approve).getByText('2')).toBeTruthy();
  const tasksTab = screen.getByRole('tab', { name: /My tasks/ });
  expect(within(tasksTab).getByText('1')).toBeTruthy();
  fireEvent.click(tasksTab);
  expect(updateParams).toHaveBeenCalledWith({ tab: 'tasks', page: null }, { push: true });
  cleanup();
  render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><Approvals params={{ tab: 'tasks' }} updateParams={updateParams} /></PermissionContext.Provider>);
  const row = (await screen.findAllByText('Collect the signed offer'))[0].closest('tr');
  expect(within(row).getByText(/Joining · Dev Kumar/)).toBeTruthy();
  expect(within(row).getByText(/\(late\)/)).toBeTruthy();
  fireEvent.click(within(row).getByRole('button', { name: /Done/ }));
  await waitFor(() => expect(updateChecklistTask).toHaveBeenCalledWith('t1', { done: true }));
});

/* People plan 8 Nov 2026, step 3: with nothing to approve and tasks on my name, the Inbox opens on My tasks; a tab in the address still wins. */
it('opens on My tasks when nothing waits to approve, unless the address names a tab', async () => {
  const { getInbox } = await import('../api/approvals');
  getInbox.mockResolvedValueOnce({ counts: { all: 0, TASK: 1, waiting: 1 }, tasks: [{ id: 't1', kind: 'JOINING', title: 'Collect the signed offer', owner: 'HR', dueDate: '2026-11-03', employee: { id: 'e3', name: 'Dev Kumar', code: 'MF-007' } }], rights: {}, items: [] });
  mount();
  expect((await screen.findAllByText('Collect the signed offer')).length).toBeGreaterThan(0);
  expect(screen.getByRole('tab', { name: /My tasks/ }).getAttribute('aria-selected')).toBe('true');
  cleanup();
  getInbox.mockResolvedValueOnce({ counts: { all: 0, TASK: 1, waiting: 1 }, tasks: [], rights: {}, items: [] });
  render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><Approvals params={{ tab: 'waiting' }} updateParams={() => {}} /></PermissionContext.Provider>);
  expect(await screen.findByText('Nothing waiting for you')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /To approve/ }).getAttribute('aria-selected')).toBe('true');
});
