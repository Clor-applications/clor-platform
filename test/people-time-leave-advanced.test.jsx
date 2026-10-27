import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * Time & Leave, advanced build (TIME-LEAVE-DECISIONS.md): entitlement rules,
 * probation and the per-type chain save from the policy form; a waiting
 * request is changed in the same form, prefilled; came back early charges
 * only the days taken; the year end shows what carries, lapses and is paid
 * out and runs once confirmed; a stand-in is named between two dates.
 */
const perms = { current: { isAdmin: true, permissions: new Set() } };
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);
vi.mock('../packages/ui/src/components/ui/notify', () => dialogs);
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));
vi.mock('@ui/personnel/api', () => ({ listStructure: vi.fn(async () => [{ id: 'et1', name: 'Interns' }]) }));
vi.mock('../packages/ui/src/timeOff/suggestions', () => ({ useSuggestions: () => [] }));
const api = vi.hoisted(() => ({
  listLeaveTypes: vi.fn(async () => []),
  getLeaveSettings: vi.fn(async () => ({ startDay: 1, startMonth: 4, current: { year: 2026, label: 'Apr 2026 – Mar 2027' }, previous: { year: 2025, label: 'Apr 2025 – Mar 2026' }, next: { year: 2027, label: 'Apr 2027 – Mar 2028' } })),
  previewLeaveType: vi.fn(async () => ({ period: { label: 'Apr 2026 – Mar 2027' }, rows: [], carry: null })),
  createLeaveType: vi.fn(async (body) => ({ type: { id: 'new', ...body } })),
  updateLeaveType: vi.fn(),
  pageLeaveRequests: vi.fn(async () => ({ requests: [], total: 0, counts: {} })),
  listLeaveRequests: vi.fn(async () => []),
  getLeaveRequest: vi.fn(),
  previewLeave: vi.fn(async () => ({ ok: true, total: 3, split: false, parts: [{ balance: { after: 9 }, dates: [] }], problems: [] })),
  updateLeaveRequest: vi.fn(async () => ({ request: {} })),
  shortenLeave: vi.fn(async () => ({ request: {} })),
  getYearEnd: vi.fn(),
  runYearEnd: vi.fn(async () => ({ run: { id: 'y1' }, paidOut: 1, totals: { carry: 15, lapse: 5, payOut: 5 } })),
  undoYearEnd: vi.fn(async () => ({ ok: true })),
  listStandIns: vi.fn(async () => ({ standIns: [], today: '2026-10-27' })),
  addStandIn: vi.fn(async () => ({ standIn: { standInName: 'Ravi Kumar', managerName: 'Asha Rao' } })),
  removeStandIn: vi.fn(),
  listPeople: vi.fn(async () => [{ id: 'e1', name: 'Asha Rao', code: 'A1' }, { id: 'e2', name: 'Ravi Kumar', code: 'A2' }]),
}));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...api }));

import LeavePolicy from '../packages/ui/src/timeOff/LeavePolicy';
import LeaveRequests from '../packages/ui/src/timeOff/LeaveRequests';
import YearEnd from '../packages/ui/src/timeOff/YearEnd';
import StandIns from '../packages/ui/src/timeOff/StandIns';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

async function pick(name, option) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function typeDate(input, text) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('Leave Policy: who gets how much, probation, who approves', () => {
  it('saves entitlement rules, the probation rule and the approval chain in the body', async () => {
    render(<LeavePolicy />);
    fireEvent.click(await screen.findByRole('button', { name: /Casual Leave/ }));
    const drawer = await screen.findByRole('dialog');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Add a rule' }));
    const rule = within(drawer).getByRole('group', { name: 'Rule 1' });
    const save = within(drawer).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    expect(within(drawer).getByRole('alert')).toHaveTextContent('Each rule names an employee type, years of service, or both.');
    expect(api.createLeaveType).not.toHaveBeenCalled();

    fireEvent.click(within(rule).getByRole('combobox', { name: 'Employee type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Interns' }));
    fireEvent.change(within(rule).getByLabelText('After, years'), { target: { value: '2' } });
    fireEvent.change(within(rule).getByLabelText('Days a year'), { target: { value: '6' } });
    await pick('During probation', 'Starts when confirmed');
    await pick('Decided by', 'Manager, then HR');
    fireEvent.change(within(drawer).getByLabelText('Approved on its own up to, days'), { target: { value: '2' } });
    fireEvent.change(within(drawer).getByLabelText('Handed on to HR after, days waiting'), { target: { value: '3' } });

    fireEvent.click(save);
    await waitFor(() => expect(api.createLeaveType).toHaveBeenCalled());
    expect(api.createLeaveType.mock.calls[0][0]).toMatchObject({
      name: 'Casual Leave',
      entitlements: [{ employeeTypeId: 'et1', minServiceMonths: 24, annualDays: 6 }],
      probationRule: 'HOLD',
      approval: 'MANAGER_THEN_HR',
      autoApproveUpToDays: 2,
      handOnAfterDays: 3,
    });
  });

  it('tries the type on people: what each is entitled to, and the lock until confirmed', async () => {
    api.previewLeaveType.mockResolvedValue({ period: { label: 'Apr 2026 – Mar 2027' }, carry: null, rows: [
      { employeeId: 'e1', name: 'Asha Rao', why: 'Newest joiner', dateOfJoining: '2026-09-01', open: true, note: 'Locked until confirmed (1 Dec 2026)', entitled: 6, fullPeriod: 4, soFar: 1, credits: [] },
    ] });
    render(<LeavePolicy />);
    fireEvent.click(await screen.findByRole('button', { name: /Casual Leave/ }));
    const drawer = await screen.findByRole('dialog');
    const row = (await within(drawer).findByText('Asha Rao', {}, { timeout: 2000 })).closest('tr');
    expect(within(row).getByText('Locked until confirmed (1 Dec 2026)')).toBeInTheDocument();
    expect(within(row).getByText('6')).toBeInTheDocument();
  });
});

const waiting = { id: 'r1', employeeId: 'e1', employeeName: 'Rekha Nair', employeeCode: 'MF-020', leaveTypeName: 'Casual leave', leaveTypeId: 't1', fromDate: '2026-12-24', toDate: '2026-12-28', days: 3, status: 'PENDING', createdAt: new Date().toISOString(), isPaid: true, reason: 'Family wedding' };
const detail = (request, over = {}) => ({ request, history: [], dates: [], balance: null, parts: [], alsoAway: [], waitingForManager: null, canEdit: false, canShorten: false, ...over });

describe('Leave requests: change, came back early', () => {
  it('Change opens the same form prefilled, the person fixed, and saves with PUT', async () => {
    api.listLeaveTypes.mockResolvedValue([{ id: 't1', name: 'Casual leave', isPaid: true, isActive: true, allowHalfDay: true }]);
    api.getLeaveRequest.mockResolvedValue(detail(waiting, { canEdit: true, history: [{ at: new Date().toISOString(), what: 'Changed', by: 'Asha Menon', from: '2026-12-24', to: '2026-12-28' }] }));
    render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    expect(await screen.findByText(/^Changed by Asha Menon/)).toHaveTextContent('24 Dec 2026 – 28 Dec 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const drawer = await screen.findByRole('dialog', { name: "Change Rekha Nair's leave" });
    expect(within(drawer).queryByRole('combobox', { name: 'Employee *' })).toBeNull();
    expect(within(drawer).getByText('Rekha Nair')).toBeInTheDocument();
    const reason = within(drawer).getByLabelText('Reason *');
    expect(reason).toHaveValue('Family wedding');
    fireEvent.change(reason, { target: { value: 'Family wedding, one more day' } });
    const save = within(drawer).getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled(), { timeout: 2000 });
    fireEvent.click(save);
    await waitFor(() => expect(api.updateLeaveRequest).toHaveBeenCalled());
    expect(api.updateLeaveRequest.mock.calls[0][0]).toBe('r1');
    expect(api.updateLeaveRequest.mock.calls[0][1]).toMatchObject({ employeeId: 'e1', leaveTypeId: 't1', fromDate: '2026-12-24', toDate: '2026-12-28', halfDay: null, reason: 'Family wedding, one more day' });
  });

  it('Came back early says what the shorter leave charges and posts the last day', async () => {
    const onLeave = { ...waiting, status: 'APPROVED', fromDate: '2026-10-20', toDate: '2026-10-30', days: 9 };
    api.getLeaveRequest.mockResolvedValue(detail(onLeave, { canShorten: true }));
    api.previewLeave.mockResolvedValue({ ok: true, total: 5, parts: [{ dates: [] }], problems: [] });
    render(<LeaveRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Came back early' }));
    typeDate(screen.getByLabelText('Last day of leave'), '26/10/2026');
    expect(await screen.findByText('Charges 5 days instead of 9 days.')).toBeInTheDocument();
    expect(api.previewLeave).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'e1', fromDate: '2026-10-20', toDate: '2026-10-26' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.shortenLeave).toHaveBeenCalledWith('r1', '2026-10-26'));
  });
});

const yearEnd = (over = {}) => ({
  year: 2025,
  period: { from: '2025-04-01', to: '2026-03-31', label: 'Apr 2025 – Mar 2026' },
  ended: true,
  rows: [{ employeeId: 'e1', name: 'Asha Rao', code: 'A1', leaveTypeId: 't1', leaveType: 'Earned Leave', closing: 20, carry: 15, lapse: 5, payOut: 5 }],
  totals: { carry: 15, lapse: 5, payOut: 5 },
  runs: [],
  ...over,
});

describe('Year end', () => {
  it('opens on the previous period, shows the totals, and pays out after a confirmation', async () => {
    api.getYearEnd.mockResolvedValue(yearEnd());
    render(<YearEnd />);
    const strip = await screen.findByRole('list', { name: 'Year end totals' });
    await waitFor(() => expect(api.getYearEnd).toHaveBeenCalledWith(2025));
    expect(within(strip).getByText('Carries forward').previousSibling).toHaveTextContent('15');
    expect(within(strip).getByText('Paid out').previousSibling).toHaveTextContent('5');
    expect(within(strip).getByText('Lapses').previousSibling).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: /Pay out lapsing days/ }));
    await waitFor(() => expect(api.runYearEnd).toHaveBeenCalledWith(2025));
    expect(dialogs.confirmDialog).toHaveBeenCalled();
  });

  it('a period still running has no action; a run already made offers Undo instead', async () => {
    api.getYearEnd.mockResolvedValue(yearEnd({ ended: false }));
    render(<YearEnd />);
    expect(await screen.findByText(/has not ended; the year end can run from/)).toHaveTextContent('1 Apr 2026');
    expect(screen.queryByRole('button', { name: /Pay out lapsing days/ })).toBeNull();
    cleanup();
    api.getYearEnd.mockResolvedValue(yearEnd({ runs: [{ id: 'y1', ranAt: '2026-04-03T05:00:00.000Z', ranBy: 'Asha Rao', undoneAt: null, summary: { totals: { payOut: 5 }, paidOut: 1 } }] }));
    render(<YearEnd />);
    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(screen.queryByRole('button', { name: /Pay out lapsing days/ })).toBeNull();
    fireEvent.click(undo);
    await waitFor(() => expect(api.undoYearEnd).toHaveBeenCalledWith('y1'));
  });
});

describe('Stand-ins', () => {
  it('HR names a stand-in for a manager between two dates', async () => {
    render(<StandIns />);
    fireEvent.click(await screen.findByRole('button', { name: /Add stand-in/ }));
    await screen.findByRole('dialog', { name: 'Add stand-in' });
    await pick('Manager *', /Asha Rao/);
    await pick('Stands in *', /Ravi Kumar/);
    typeDate(screen.getByLabelText('From'), '01/11/2026');
    typeDate(screen.getByLabelText('To'), '05/11/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addStandIn).toHaveBeenCalledWith({ managerEmployeeId: 'e1', standInEmployeeId: 'e2', fromDate: '2026-11-01', toDate: '2026-11-05' }));
  });

  it('a team role names one for themselves only', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Leave Requests::VIEW']) };
    render(<StandIns />);
    fireEvent.click(await screen.findByRole('button', { name: /Add stand-in/ }));
    await screen.findByRole('dialog', { name: 'Add stand-in' });
    expect(screen.queryByRole('combobox', { name: 'Manager *' })).toBeNull();
    await pick('Stands in *', /Ravi Kumar/);
    typeDate(screen.getByLabelText('From'), '01/11/2026');
    typeDate(screen.getByLabelText('To'), '05/11/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.addStandIn).toHaveBeenCalledWith({ standInEmployeeId: 'e2', fromDate: '2026-11-01', toDate: '2026-11-05' }));
  });
});
