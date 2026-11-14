import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PeopleOverview from './PeopleOverview';

/*
 * Time depth review: Home's headline counts everything waiting in the one
 * Approvals inbox (leave, field punches, overtime…), not leave alone; leave
 * stays the detail line, and the count opens Approvals.
 */
vi.mock('@ui/personnel/api', () => ({
  getOverview: vi.fn().mockResolvedValue({ headcount: 10, byDepartment: [], byStatus: {}, joinedThisMonth: [], leftThisMonth: 0 }),
  getPeopleHome: vi.fn().mockResolvedValue({
    todos: [
      { key: 'leave', title: 'Leave waiting', count: 1, screen: 'approvals', params: { kind: 'LEAVE' } },
      { key: 'fieldPunches', title: 'Field punches waiting', count: 2, screen: 'approvals', params: { kind: 'PUNCH' } },
      { key: 'overtime', title: 'Overtime waiting', count: 1, screen: 'approvals', params: { kind: 'OVERTIME' } },
      { key: 'documents', title: 'Documents expiring', count: 4, screen: 'documents' },
    ],
    /* The inbox's own count, as the rail badge and the Inbox show it. */
    waiting: 4,
    probation: null,
    week: null,
    monthClose: null,
  }),
  listEmployees: vi.fn().mockResolvedValue({ employees: [] }),
  summaryOpened: vi.fn().mockResolvedValue({}),
}));
vi.mock('@ui/timeOff/api', () => ({
  approveLeave: vi.fn(),
  swatchOf: () => 'rgb(var(--leave-0))',
  listLeaveRequests: vi.fn().mockResolvedValue([{ id: 'l1', status: 'PENDING', fromDate: '2026-11-18', toDate: '2026-11-18', employeeName: 'Asha', days: 1 }]),
}));
vi.mock('../api/workspace', () => ({ listRecords: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/timeOff/MyDays', () => ({ HomeCheckIn: () => null }));
vi.mock('./HomeSetup', () => ({ default: () => null }));

it('counts the whole inbox in the greeting, with leave as the detail on the Inbox line', async () => {
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('4 things')).toBeTruthy();
  expect(await screen.findByText(/1 leave request among them, next starts/)).toBeTruthy();
});

/* People plan 8 Nov 2026, step 2: the subtitle's number is the card's. Requests to approve plus the tasks on my name, each line opening the Inbox tab that holds it. */
it('the card adds up to the subtitle: requests on one line, my tasks on another, each opening its Inbox tab', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({
    todos: [
      { key: 'leave', title: 'Leave waiting', count: 2, screen: 'approvals', params: { kind: 'LEAVE' } },
      { key: 'myTasks', title: 'Tasks on your name', count: 3, screen: 'approvals', params: { tab: 'tasks' } },
      { key: 'checklists', title: 'Joining and leaving tasks', count: 320, tone: 'urgent', screen: 'checklists' },
    ],
    waiting: 5,
    probation: null, week: null, monthClose: null,
  });
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  expect(await screen.findByText('5 things')).toBeTruthy();
  const requests = (await screen.findByText('2 requests wait for you')).closest('button');
  const tasks = screen.getByText('3 tasks are on your name').closest('button');
  /* The two lines are the whole card: 2 + 3 = 5. HR's all-tasks figure sits under "Needs attention", outside the number. */
  const card = requests.closest('section');
  expect(within(card).getAllByRole('button')).toHaveLength(2);
  expect(screen.getByText('Joining and leaving tasks').closest('section')).not.toBe(card);
  expect(screen.getByText('Needs attention')).toBeTruthy();
  fireEvent.click(requests);
  expect(openScreen).toHaveBeenCalledWith('approvals', undefined);
  fireEvent.click(tasks);
  expect(openScreen).toHaveBeenCalledWith('approvals', { tab: 'tasks' });
});

it('says "Nothing waits for your answer" only when the server counts nought, and then shows no card rows', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({ todos: [{ key: 'checklists', title: 'Joining and leaving tasks', count: 320, tone: 'urgent', screen: 'checklists' }], waiting: 0, probation: null, week: null, monthClose: null });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText(/Nothing waits for your answer/)).toBeTruthy();
  expect(screen.getByText('All caught up')).toBeTruthy();
  expect(screen.queryByText(/wait for you$/)).toBeNull();
  expect(screen.getByText('Joining and leaving tasks')).toBeTruthy();
});

/* Owner, 8 Nov 2026: no approvals among Home's figures. The fourth figure is probation to decide, opening the list. */
it('has no To approve figure; Probation due counts probation to decide and opens it', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({
    todos: [{ key: 'probation', title: 'Probation to decide', count: 3, tone: 'urgent', screen: 'employees', params: { prob: 'on' } }],
    waiting: 0,
    probation: [{ id: 'p1', name: 'Bina', code: 'G2', endsOn: '2026-11-04', over: true }, { id: 'p2', name: 'Asha', code: 'G1', endsOn: '2026-11-20', over: false }],
    week: null,
    monthClose: null,
  });
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  const figure = (await screen.findByText('Probation due')).closest('button');
  expect(screen.queryByText('To approve')).toBeNull();
  // Probation is the figure and the list below, not also a Waiting-for-you row.
  expect(screen.queryByText('Probation to decide')).toBeNull();
  expect(figure.textContent).toMatch(/3/);
  expect(figure.textContent).toMatch(/1 person past their date/);
  fireEvent.click(figure);
  expect(openScreen).toHaveBeenCalledWith('employees', { prob: 'on' });
});

/* Company choices, "leavings: no" (SPEC 3.5): a reader the leavings are kept from gets no On notice figure. */
it('shows On notice by default, and leaves it out when the company keeps leavings from this reader', async () => {
  const api = await import('@ui/personnel/api');
  const { unmount } = render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('On notice')).toBeTruthy();
  unmount();
  api.getOverview.mockResolvedValueOnce({ headcount: 10, byDepartment: [], byStatus: { ACTIVE: 10 }, joinedThisMonth: [], leftThisMonth: null, leavingsHidden: true });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('Probation due')).toBeTruthy();
  expect(screen.queryByText('On notice')).toBeNull();
});

/* QA, Team Manager (1 Nov 2026): Home offered Announce, Post one, HR cases and Add an employee, which his role refuses. */
it('offers only the actions this reader may use', async () => {
  const { PermissionContext } = await import('@ui/permissions/context');
  const as = (permissions, isAdmin = false) => (
    <PermissionContext.Provider value={{ loading: false, isAdmin, permissions: new Set(permissions) }}>
      <PeopleOverview openScreen={vi.fn()} />
    </PermissionContext.Provider>
  );
  const { unmount } = render(as(['PEOPLE::Employees::VIEW', 'ATTENDANCE::Leave Requests::VIEW']));
  expect(await screen.findByText('Probation due')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Leave requests/ })).toBeTruthy();
  for (const name of [/Announce/, /Post one/, /HR cases/, /Add an employee/, /All events/]) expect(screen.queryByRole('button', { name })).toBeNull();
  unmount();
  render(as([], true));
  expect(await screen.findByRole('button', { name: /Announce/ })).toBeTruthy();
  for (const name of [/Post one/, /HR cases/, /Add an employee/, /All events/]) expect(screen.getByRole('button', { name })).toBeTruthy();
});

/* UI audit, 7 Nov 2026: a failed Home list said "All caught up" and "Everyone is in today". A failure is said as one, with Retry. */
it('never reads a failed list as nothing waiting, and Retry asks both lists again', async () => {
  const api = await import('@ui/personnel/api');
  const timeOff = await import('@ui/timeOff/api');
  const fail = Object.assign(new Error('Server down'), { status: 503 });
  api.getPeopleHome.mockClear();
  timeOff.listLeaveRequests.mockClear();
  api.getPeopleHome.mockRejectedValueOnce(fail);
  timeOff.listLeaveRequests.mockRejectedValueOnce(fail);
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText(/Could not load what waits for you/)).toBeTruthy();
  expect(screen.queryByText('All caught up')).toBeNull();
  expect(screen.getByText(/Could not check what waits for your answer/)).toBeTruthy();
  expect(api.getPeopleHome).toHaveBeenCalledTimes(1);
  expect(timeOff.listLeaveRequests).toHaveBeenCalledTimes(1);

  api.getPeopleHome.mockResolvedValueOnce([]);
  timeOff.listLeaveRequests.mockResolvedValueOnce([]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
  expect(await screen.findByText('All caught up')).toBeTruthy();
  expect(api.getPeopleHome).toHaveBeenCalledTimes(2);
  expect(timeOff.listLeaveRequests).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/Could not load what waits for you/)).toBeNull();
});

it('says a failed leave or news list failed instead of drawing it empty; a refusal (403) stays empty', async () => {
  const timeOff = await import('@ui/timeOff/api');
  const ws = await import('../api/workspace');
  const fail = Object.assign(new Error('offline'), { network: true });
  timeOff.listLeaveRequests.mockRejectedValueOnce(fail);
  ws.listRecords.mockImplementation((kind) => Promise.reject(kind === 'announcements' ? fail : Object.assign(new Error('Engage is switched off'), { status: 403 })));
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText(/Could not load who is out today/)).toBeTruthy();
  expect(screen.queryByText('Everyone is in today.')).toBeNull();
  expect(screen.getByText('Could not load leave')).toBeTruthy();
  /* Side cards are polite (status); only "Waiting for you" alerts. */
  expect(screen.getByText(/Could not load announcements/).closest('[role]').getAttribute('role')).toBe('status');
  expect(screen.getByText(/Could not load the leave waiting for you/).closest('[role]').getAttribute('role')).toBe('alert');
  expect(await screen.findByText(/Could not load announcements/)).toBeTruthy();
  expect(await screen.findByText(/No events planned/)).toBeTruthy();
  expect(screen.queryByText(/Could not load events/)).toBeNull();
  ws.listRecords.mockReset();
  ws.listRecords.mockResolvedValue([]);
});

/* UI audit, 7 Nov 2026: "Out today" is India's day, not the browser's or UTC's. At 00:30 IST it is already the 7th. */
it('counts who is out today by India’s date at 00:30 IST, even when the browser runs on UTC', async () => {
  /*
   * A browser on UTC, whatever zone this machine is in: the local-date getters read UTC's. A worker thread cannot
   * change its own TZ once started, so the getters are what is pinned. The old local-date code fails here on an
   * Indian machine too.
   */
  const local = ['FullYear', 'Month', 'Date', 'Day', 'Hours'].map((k) => vi.spyOn(Date.prototype, `get${k}`).mockImplementation(function utc() { return this[`getUTC${k}`](); }));
  expect(new Date('2026-11-06T19:00:00.000Z').getDate()).toBe(6);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T19:00:00.000Z')); // 00:30 IST, 7 Nov
  try {
    const timeOff = await import('@ui/timeOff/api');
    timeOff.listLeaveRequests.mockResolvedValueOnce([{ id: 'l2', employeeId: 'e2', status: 'APPROVED', fromDate: '2026-11-07', toDate: '2026-11-07', employeeName: 'Bala', leaveTypeName: 'Casual leave', days: 1 }]);
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByText('9 of 10 at work')).toBeTruthy();
  } finally {
    vi.useRealTimers();
    local.forEach((spy) => spy.mockRestore());
  }
});

/* Review of #147: Retry asks again only for what failed, and a second Retry while one is in flight asks nothing. */
it('retries only the failed list, once, however often Retry is pressed', async () => {
  const api = await import('@ui/personnel/api');
  const timeOff = await import('@ui/timeOff/api');
  api.getPeopleHome.mockClear();
  timeOff.listLeaveRequests.mockClear();
  timeOff.listLeaveRequests.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText(/Could not load the leave waiting for you/)).toBeTruthy();
  let answer;
  timeOff.listLeaveRequests.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
  /* The waiting card's Retry (the alert), not the Out today card's. */
  const retry = within(screen.getByText(/Could not load the leave waiting for you/).closest('[role="alert"]')).getByRole('button', { name: 'Retry' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(timeOff.listLeaveRequests).toHaveBeenCalledTimes(2);
  expect(api.getPeopleHome).toHaveBeenCalledTimes(1);
  answer([]);
  expect(await screen.findByText(/Documents expiring/)).toBeTruthy();
  expect(screen.queryByText(/Could not load the leave waiting for you/)).toBeNull();
});

/* Review of #147: before the inbox and leave answer, the greeting does not claim nothing waits. */
it('says it is checking, not "Nothing waits", while the inbox and leave are loading', async () => {
  const api = await import('@ui/personnel/api');
  const timeOff = await import('@ui/timeOff/api');
  api.getPeopleHome.mockImplementationOnce(() => new Promise(() => {}));
  timeOff.listLeaveRequests.mockImplementationOnce(() => new Promise(() => {}));
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText(/Checking what waits for your answer/)).toBeTruthy();
  expect(screen.queryByText(/Nothing waits for your answer/)).toBeNull();
});

/* People plan, 8 Nov 2026: Home's waiting number is the inbox's own (help desk included), not a sum of to-do lines. */
it('shows the waiting number the server counts for the inbox, the one the rail badge shows', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({ todos: [{ key: 'leave', title: 'Leave waiting', count: 1, screen: 'approvals' }], waiting: 3, probation: null, week: null, monthClose: null });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('3 things')).toBeTruthy();
});

/* Owner, 8 Nov 2026: approvals live in the Inbox. Home says how many wait and opens it; it lists and approves none. */
it('shows one line for the Inbox, no request list and no Approve button', async () => {
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  const line = (await screen.findByText('4 requests wait for you')).closest('button');
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  expect(screen.queryByText('Leave waiting')).toBeNull();
  expect(screen.queryByText('Field punches waiting')).toBeNull();
  /* Tasks that are not approvals stay listed. */
  expect(screen.getByText('Documents expiring')).toBeTruthy();
  fireEvent.click(line);
  expect(openScreen).toHaveBeenCalledWith('approvals', undefined);
});

