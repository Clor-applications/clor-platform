import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * HR's month in People (docs/people/design-v1/audit-views/HR-VIEW.md): one
 * Approvals inbox over leave, attendance requests, People approvals and Help
 * Desk, decided several at once with one note; registers to print and
 * export; loss of pay on the month view; work from home and on duty beside
 * leave with their own mark.
 */
const perms = { current: { isAdmin: true, permissions: new Set() } };
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);
vi.mock('../packages/ui/src/components/ui/notify', () => dialogs);
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));
vi.mock('../packages/ui/src/timeOff/suggestions', () => ({ useSuggestions: () => [] }));
const exporter = vi.hoisted(() => ({ runListExport: vi.fn() }));
vi.mock('@ui/components/list/exportMenu', async (orig) => ({ ...(await orig()), ...exporter }));
vi.mock('../packages/ui/src/components/list/exportMenu', async (orig) => ({ ...(await orig()), ...exporter }));

const timeApi = vi.hoisted(() => ({
  bulkReviewLeave: vi.fn(async (ids) => ({ done: ids.length, failed: 0, handedOn: 0, results: [] })),
  bulkReviewRequests: vi.fn(async (ids) => ({ done: ids.length, failed: 0, handedOn: 0, results: [] })),
  getLeaveRequest: vi.fn(async () => ({ request: { id: 'l1', employeeId: 'e1', employeeName: 'Asha Rao', leaveTypeName: 'Casual', fromDate: '2026-12-01', toDate: '2026-12-01', days: 1, status: 'PENDING', createdAt: '2026-10-20T05:00:00Z' }, history: [], dates: [], balance: null, parts: [], alsoAway: [], waitingForManager: null })),
  getWorkingAway: vi.fn(async () => []),
  getPayableDays: vi.fn(async () => ({ month: '2026-10', source: 'LEAVE', rows: [], payrollTaken: null })),
  listPeople: vi.fn(async () => []),
  listRecords: vi.fn(async () => []),
  attendanceIsOn: vi.fn(async () => false),
  listLeaveRequests: vi.fn(async () => []),
  listHolidays: vi.fn(async () => []),
  getWorkingWeek: vi.fn(async () => ({ weeklyOffDays: '0' })),
  getTimeOverview: vi.fn(),
}));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...timeApi }));

const approvalsApi = vi.hoisted(() => ({
  getInbox: vi.fn(),
  listRequests: vi.fn(async () => ({ waitingForMe: [], mine: [] })),
  decideRequest: vi.fn(async () => ({ request: { status: 'APPROVED' } })),
  bulkDecideRequests: vi.fn(async (ids) => ({ done: ids.length, failed: 0, results: [] })),
  replyRequest: vi.fn(),
  withdrawRequest: vi.fn(),
}));
vi.mock('../apps/people/src/api/approvals', () => approvalsApi);

const registersApi = vi.hoisted(() => ({
  employeeRegister: vi.fn(async () => ({ columns: ['Sl. no.', 'Employee ID', 'Name'], rows: [['1', 'A1', 'Asha Rao']], generatedOn: '2026-10-27', establishment: null })),
  leaveRegister: vi.fn(),
  leaveSummary: vi.fn(async () => ({ columns: ['Department', 'Leave type', 'Paid', 'People', 'Days'], rows: [['Design', 'Casual', 'Paid', '1', '2']], totals: ['All', '', '', '1', '2'], notes: ['2 days of leave taken, 0 of them unpaid.'], generatedOn: '2026-10-27', establishment: null })),
  musterRoll: vi.fn(async () => ({ columns: ['Employee ID', 'Name', 'Father’s / husband’s name', '1', '2', 'Present', 'Absent', 'Leave', 'Holidays & offs'], rows: [['A1', 'Asha Rao', 'Ramesh', 'L', '', '0', '0', '1', '0']], notes: ['Attendance is not switched on: a working day with nothing recorded is left blank, not marked absent.'], generatedOn: '2026-10-27', establishment: null })),
  listEstablishments: vi.fn(async () => []),
}));
vi.mock('../apps/people/src/api/registers', () => registersApi);

import Approvals from '../apps/people/src/screens/Approvals';
import Registers, { LeaveSummaryReport } from '../apps/people/src/screens/Registers';
import TeamAttendance from '../packages/ui/src/timeOff/TeamAttendance';
import LeaveCalendar from '../packages/ui/src/timeOff/LeaveCalendar';
import TimeOverview from '../packages/ui/src/timeOff/TimeOverview';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

const item = (over) => ({ employeeCode: null, photoUrl: null, fromDate: null, toDate: null, days: null, halfDay: null, dueAt: null, overdue: false, managerApproved: false, bulk: true, subKind: null, ...over });
const INBOX = {
  items: [
    item({ key: 'LEAVE:l1', kind: 'LEAVE', id: 'l1', what: 'Casual', employeeName: 'Asha Rao', fromDate: '2026-12-01', toDate: '2026-12-01', days: 1, since: '2026-10-20T05:00:00Z' }),
    item({ key: 'ATTENDANCE:a1', kind: 'ATTENDANCE', id: 'a1', what: 'Work from home', subKind: 'WFH', employeeName: 'Ravi Kumar', fromDate: '2026-12-02', toDate: '2026-12-02', since: '2026-10-21T05:00:00Z' }),
    item({ key: 'APPROVAL:p1', kind: 'APPROVAL', id: 'p1', what: 'Grade for Meera', subKind: 'JOB_CHANGE', employeeName: 'Meera Shah', since: '2026-10-22T05:00:00Z', overdue: true }),
    item({ key: 'HELPDESK:h1', kind: 'HELPDESK', id: 'h1', what: 'Salary not credited', subKind: 'PAYROLL', employeeName: 'Asha Rao', since: '2026-10-23T05:00:00Z', bulk: false }),
  ],
  counts: { LEAVE: 1, ATTENDANCE: 1, APPROVAL: 1, HELPDESK: 1, all: 4 },
  rights: { LEAVE: { see: true, decide: true }, ATTENDANCE: { see: true, decide: true }, APPROVAL: { see: true, decide: true }, HELPDESK: { see: true, decide: false } },
};

describe('one Approvals inbox', () => {
  it('lists every kind oldest first with its count, and filters by kind from the address', async () => {
    approvalsApi.getInbox.mockResolvedValue(INBOX);
    const { rerender } = render(<Approvals params={{}} updateParams={() => {}} />);
    await screen.findAllByText('Ravi Kumar');
    expect(screen.getByRole('tab', { name: /Waiting for me/ })).toHaveTextContent('4');
    const table = screen.getByRole('table');
    const names = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(names[0]).toMatch(/Asha Rao.*Leave.*Casual/);
    expect(names[1]).toMatch(/Ravi Kumar.*Attendance request.*Work from home/);
    expect(names[2]).toMatch(/Meera Shah.*Job change.*Overdue/);
    expect(names[3]).toMatch(/Help desk.*Salary not credited/);
    rerender(<Approvals params={{ kind: 'ATTENDANCE' }} updateParams={() => {}} />);
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2));
    expect(within(screen.getByRole('table')).getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('decides the chosen rows at once with one note, each through its own bulk route; rejecting needs the note', async () => {
    approvalsApi.getInbox.mockResolvedValue(INBOX);
    render(<Approvals params={{}} updateParams={() => {}} />);
    await screen.findAllByText('Ravi Kumar');
    /* A help desk case needs a written reply: it cannot be chosen. */
    const helpRow = within(screen.getByRole('table')).getByText('Salary not credited').closest('tr');
    expect(within(helpRow).queryByRole('checkbox')).toBeNull();
    for (const name of ['Choose Asha Rao', 'Choose Ravi Kumar', 'Choose Meera Shah']) fireEvent.click(screen.getAllByRole('checkbox', { name })[0]);
    const bar = screen.getByRole('region', { name: 'Decide the chosen requests' });
    expect(bar).toHaveTextContent('3 chosen');
    expect(within(bar).getByRole('button', { name: /Reject/ })).toBeDisabled();
    fireEvent.change(within(bar).getByLabelText('Note to them'), { target: { value: 'Year-end week' } });
    fireEvent.click(within(bar).getByRole('button', { name: /Reject/ }));
    await waitFor(() => expect(dialogs.notify.success).toHaveBeenCalledWith('3 rejected.'));
    expect(timeApi.bulkReviewLeave).toHaveBeenCalledWith(['l1'], false, 'Year-end week');
    expect(timeApi.bulkReviewRequests).toHaveBeenCalledWith(['a1'], false, 'Year-end week');
    /* People approvals go through their own bulk route now, not one call each. */
    expect(approvalsApi.bulkDecideRequests).toHaveBeenCalledWith(['p1'], false, 'Year-end week');
    expect(approvalsApi.decideRequest).not.toHaveBeenCalled();
  });

  it('a People approval the bulk route refuses is counted, and the rest still go through', async () => {
    approvalsApi.getInbox.mockResolvedValue({ ...INBOX, items: [...INBOX.items, item({ key: 'APPROVAL:p2', kind: 'APPROVAL', id: 'p2', what: 'Address for Ravi', subKind: 'PROFILE_CHANGE', employeeName: 'Ravi Kumar', since: '2026-10-24T05:00:00Z' })] });
    approvalsApi.bulkDecideRequests.mockResolvedValueOnce({ done: 1, failed: 1, results: [{ id: 'p1', error: 'Nobody decides their own request.' }] });
    render(<Approvals params={{ kind: 'APPROVAL' }} updateParams={() => {}} />);
    await screen.findAllByText('Meera Shah');
    for (const name of ['Choose Meera Shah', 'Choose Ravi Kumar']) fireEvent.click(screen.getAllByRole('checkbox', { name })[0]);
    fireEvent.click(within(screen.getByRole('region', { name: 'Decide the chosen requests' })).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(dialogs.notify.error).toHaveBeenCalledWith('1 approved; 1 not: Nobody decides their own request.'));
    expect(approvalsApi.bulkDecideRequests).toHaveBeenCalledWith(['p1', 'p2'], true, undefined);
    expect(timeApi.bulkReviewLeave).not.toHaveBeenCalled();
  });

  it('says what was not done, with the first reason', async () => {
    approvalsApi.getInbox.mockResolvedValue(INBOX);
    timeApi.bulkReviewLeave.mockResolvedValueOnce({ done: 0, failed: 1, handedOn: 0, results: [{ id: 'l1', error: 'Their manager has not approved this yet.', code: 'MANAGER_FIRST' }] });
    render(<Approvals params={{ kind: 'LEAVE' }} updateParams={() => {}} />);
    await screen.findAllByText('Asha Rao');
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Choose Asha Rao' })[0]);
    fireEvent.click(within(screen.getByRole('region', { name: 'Decide the chosen requests' })).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(dialogs.notify.error).toHaveBeenCalledWith('0 approved; 1 not: Their manager has not approved this yet.'));
  });

  it('a row opens its own drawer, and a help desk case opens the Help Desk on that case', async () => {
    approvalsApi.getInbox.mockResolvedValue(INBOX);
    const openScreen = vi.fn();
    render(<Approvals params={{}} updateParams={() => {}} openScreen={openScreen} />);
    await screen.findAllByText('Salary not credited');
    fireEvent.click(within(screen.getByRole('table')).getByText('Salary not credited'));
    expect(openScreen).toHaveBeenCalledWith('helpdesk', { id: 'h1' });
    fireEvent.click(within(screen.getByRole('table')).getByText('Casual'));
    await waitFor(() => expect(timeApi.getLeaveRequest).toHaveBeenCalledWith('l1'));
  });
});

describe('registers', () => {
  it('shows the muster roll for a month, prints it and exports it as CSV', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<Registers params={{ register: 'muster' }} updateParams={() => {}} />);
    expect(await screen.findByRole('table', { name: 'Muster roll' })).toBeInTheDocument();
    expect(registersApi.musterRoll).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), '');
    expect(screen.getByText(/left blank, not marked absent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Print/ }));
    expect(print).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(exporter.runListExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'csv', title: 'Muster roll', rows: [expect.objectContaining({ c1: 'Asha Rao', c3: 'L' })] }));
    print.mockRestore();
  });

  it('the register of employees by default; the leave summary as its own Insights page, with totals', async () => {
    render(<Registers params={{}} updateParams={() => {}} />);
    expect(await screen.findByRole('table', { name: 'Register of employees' })).toHaveTextContent('Asha Rao');
    cleanup();
    render(<LeaveSummaryReport params={{}} updateParams={() => {}} />);
    const table = await screen.findByRole('table', { name: 'Leave summary' });
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent(/All\s*1\s*2/);
    expect(screen.getByRole('heading', { name: 'Leave summary', level: 1 })).toBeInTheDocument();
  });
});

describe('Time & Leave', () => {
  it('the month view shows unpaid leave, loss of pay and payable days from Payroll’s calculation, and exports them', async () => {
    timeApi.listPeople.mockResolvedValue([{ id: 'e1', name: 'Ravi Kumar', code: 'A2' }]);
    timeApi.getPayableDays.mockResolvedValue({ month: '2026-10', source: 'LEAVE', rows: [{ employeeId: 'e1', name: 'Ravi Kumar', unpaidLeaveDays: 2, lossOfPayDays: 2, payableDays: 29, totalDays: 31, why: 'Unpaid' }], payrollTaken: { period: 'October 2026', state: 'LOCKED', on: '2026-10-31' } });
    render(<TeamAttendance />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Month' }));
    const table = await screen.findByRole('table', { name: /Attendance in/ });
    await waitFor(() => expect(within(table).getByRole('row', { name: /Ravi Kumar/ })).toHaveTextContent(/2\s*2\s*29/));
    expect(within(table).getByRole('columnheader', { name: 'Loss of pay' })).toBeInTheDocument();
    expect(screen.getByText(/Payroll took these on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(exporter.runListExport).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ name: 'Ravi Kumar', lop: 2, payable: 29 })] }));
  });

  it('the calendar marks work from home apart from leave, and does not count it as away', async () => {
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    /* The 15th, or the 16th when the 15th is a Sunday: a weekly off is shaded and holds no work-from-home mark (1 Nov 2026 red main). */
    const day = new Date(`${month}-15T00:00:00Z`).getUTCDay() === 0 ? `${month}-16` : `${month}-15`;
    timeApi.getWorkingAway.mockResolvedValue([{ id: 'w1', employeeId: 'e2', employeeName: 'Ravi Kumar', department: 'Sales', kind: 'WFH', fromDate: day, toDate: day, halfDay: null, place: null }]);
    render(<LeaveCalendar />);
    const mark = await screen.findByLabelText(`${day}: Work from home`);
    expect(mark).toHaveTextContent('H');
    expect(screen.getByText('Work from home, working')).toBeInTheDocument();
    const away = screen.getByRole('row', { name: /^Away/ });
    expect(away.textContent.replace(/Away/, '').trim()).toBe('');
  });

  it('away today lists work from home and on duty as their own mark', async () => {
    timeApi.getTimeOverview.mockResolvedValue({ today: '2026-10-27', awayToday: [], workingAwayToday: [{ id: 'w2', employeeId: 'e3', employeeName: 'Divya', kind: 'ON_DUTY', place: 'Client office', fromDate: '2026-10-27', toDate: '2026-10-27' }], waiting: { count: 0, olderThan3Days: 0, oldest: [] }, upcoming: [], lapsing: { rows: [] } });
    render(<TimeOverview openScreen={() => {}} />);
    const group = await screen.findByRole('region', { name: 'Away today' });
    expect(group).toHaveTextContent('Divya');
    expect(within(group).getByText('On duty')).toHaveClass('ui-pill');
    expect(group).toHaveTextContent('Client office');
  });
});
