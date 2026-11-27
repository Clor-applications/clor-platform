import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { PermissionContext } from '@ui/permissions/context';
import { todayIst } from '@ui/utils/dates';
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
vi.mock('./HomeMyLeave', () => ({ default: () => null }));

it('shows Team overview and recovers a missing announcements payload while events render', async () => {
  const { listRecords } = await import('../api/workspace');
  listRecords.mockResolvedValueOnce(undefined);
  listRecords.mockResolvedValueOnce([
    { id: 'future', title: 'Team town hall', status: 'SCHEDULED', details: { startDate: '2099-01-01', location: 'Main office' } },
    { id: 'old', title: 'Past meeting', status: 'SCHEDULED', details: { startDate: '2000-01-01' } },
  ]);
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  const team = within(await screen.findByRole('region', { name: 'Team overview' }));
  expect(team.getByText('Headcount')).toBeTruthy();
  expect(team.getByText('On leave today')).toBeTruthy();
  const events = within(screen.getByRole('region', { name: 'Upcoming events' }));
  expect(await events.findByText('Team town hall')).toBeTruthy();
  expect(events.getByText('🎤')).toHaveAttribute('aria-hidden', 'true');
  expect(events.queryByText('Past meeting')).toBeNull();
  const news = within(screen.getByRole('region', { name: 'Announcements' }));
  expect(await news.findByText(/Could not load announcements/)).toBeTruthy();
  listRecords.mockResolvedValueOnce([
    { id: 'published', title: 'Policy update', status: 'PUBLISHED', updatedAt: '2026-11-25' },
    { id: 'draft', title: 'Unpublished copy', status: 'DRAFT', updatedAt: '2026-11-25' },
  ]);
  fireEvent.click(news.getByRole('button', { name: 'Retry' }));
  fireEvent.click(await news.findByRole('button', { name: /Policy update/ }));
  expect(openScreen).toHaveBeenLastCalledWith('announcements', undefined);
  expect(news.queryByText('Unpublished copy')).toBeNull();
});

it('shows attendance coverage as a readout with its actual denominator', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({ todos: [], waiting: 0, today: { inCount: 8, expected: 10 } });
  render(<PeopleOverview openScreen={vi.fn()} />);
  const overview = within(await screen.findByRole('region', { name: 'Team overview' }));
  const coverage = await overview.findByRole('meter', { name: 'Checked in today out of expected' });
  expect(coverage).toHaveAttribute('value', '8');
  expect(coverage).toHaveAttribute('max', '10');
  expect(overview.getByText('of 10 expected')).toBeTruthy();
  expect(coverage.closest('button')).toBeNull();
});

it('opens the employee directory filtered to people who joined this month', async () => {
  const { getOverview } = await import('@ui/personnel/api');
  const today = todayIst();
  const openScreen = vi.fn();
  getOverview.mockResolvedValueOnce({ headcount: 10, byDepartment: [], byStatus: {}, joinedThisMonth: [{ id: 'e1', name: 'Nila Shah' }] });
  render(<PeopleOverview openScreen={openScreen} />);
  const joiners = within(await screen.findByRole('region', { name: 'New joiners' }));
  fireEvent.click(joiners.getByRole('button', { name: /Nila Shah/ }));
  expect(openScreen).toHaveBeenCalledWith('employees', { from: `${today.slice(0, 7)}-01`, to: today });
});

it('opens briefing links and hides destinations outside the user’s permissions', async () => {
  const openScreen = vi.fn();
  const permissions = new Set(['PEOPLE::Requests::VIEW', 'ATTENDANCE::My Attendance::VIEW']);
  render(
    <PermissionContext.Provider value={{ permissions }}>
      <PeopleOverview openScreen={openScreen} />
    </PermissionContext.Provider>,
  );
  const links = within(await screen.findByRole('navigation', { name: 'People destinations' }));
  const inbox = await links.findByRole('link', { name: /4 items need your action/ });
  expect(inbox).toHaveAttribute('href', '?app=people&open=approvals');
  fireEvent.click(inbox);
  expect(openScreen).toHaveBeenLastCalledWith('approvals', undefined);
  fireEvent.click(links.getByRole('link', { name: 'My requests' }));
  expect(openScreen).toHaveBeenLastCalledWith('myRequests', undefined);
  expect(links.queryByRole('link', { name: /Employee directory|Leave calendar/ })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Quick launch' })).toBeNull();
});

it('keeps the header concise, with leave detail in the action panel', async () => {
  render(<PeopleOverview openScreen={vi.fn()} />);
  const header = (await screen.findByRole('heading', { level: 1 })).closest('header');
  expect(header.querySelector('h1 time')).toHaveAttribute('datetime', todayIst());
  expect(within(header).queryByText(/need your action|assigned task/)).toBeNull();
  expect(await screen.findByText(/1 leave request · next starts/)).toBeTruthy();
});

it('splits the Inbox total into requests and assigned tasks and opens each tab', async () => {
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
  render(<PermissionContext.Provider value={{ permissions: new Set(['PEOPLE::Requests::VIEW']) }}>
    <PeopleOverview openScreen={openScreen} />
  </PermissionContext.Provider>);
  expect(await screen.findByRole('link', { name: 'Inbox, 5 items need your action' })).toBeTruthy();
  const requests = await screen.findByRole('button', { name: 'Review requests' });
  const tasks = screen.getByRole('button', { name: 'View my tasks' });
  expect(within(requests.closest('li')).getByText('2')).toBeTruthy();
  expect(within(tasks.closest('li')).getByText('3')).toBeTruthy();
  expect(requests).toHaveClass('people-arrow-link');
  expect(tasks).toHaveClass('people-arrow-link');
  /* The two lines are the whole card: 2 + 3 = 5. HR's all-tasks figure sits under "Needs attention", outside the number. */
  const card = requests.closest('section');
  expect(within(card).getAllByRole('button')).toHaveLength(2);
  expect(screen.getByText('Joining and leaving tasks').closest('section')).not.toBe(card);
  expect(screen.getByText('Needs attention')).toBeTruthy();
  fireEvent.click(requests);
  expect(openScreen).toHaveBeenCalledWith('approvals', { tab: 'waiting' });
  fireEvent.click(tasks);
  expect(openScreen).toHaveBeenCalledWith('approvals', { tab: 'tasks' });
});

it('shows an empty action panel when the server counts no waiting work', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({ todos: [{ key: 'checklists', title: 'Joining and leaving tasks', count: 320, tone: 'urgent', screen: 'checklists' }], waiting: 0, probation: null, week: null, monthClose: null });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('All caught up')).toBeTruthy();
  expect(screen.queryByText('Requests to review')).toBeNull();
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
  const figure = (await screen.findByText('Probation due')).closest('li');
  expect(screen.queryByText('To approve')).toBeNull();
  // Probation is the figure and the list below, not also a Waiting-for-you row.
  expect(screen.queryByText('Probation to decide')).toBeNull();
  expect(figure.textContent).toMatch(/3/);
  expect(figure.textContent).toMatch(/1 person past their date/);
  fireEvent.click(within(figure).getByRole('button', { name: 'Review probation' }));
  expect(openScreen).toHaveBeenCalledWith('employees', { prob: 'on' });
});

/* Company choices, "leavings: no" (SPEC 3.5): a reader the leavings are kept from gets no On notice figure. */
it('shows On notice by default, and leaves it out when the company keeps leavings from this reader', async () => {
  const api = await import('@ui/personnel/api');
  api.getOverview.mockResolvedValueOnce({ headcount: 10, byDepartment: [], byStatus: { ACTIVE: 8, ON_NOTICE: 2 }, joinedThisMonth: [], leftThisMonth: 0 });
  const { unmount } = render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('On notice')).toBeTruthy();
  unmount();
  api.getOverview.mockResolvedValueOnce({ headcount: 10, byDepartment: [], byStatus: { ACTIVE: 8, ON_NOTICE: 2 }, joinedThisMonth: [], leftThisMonth: null, leavingsHidden: true });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('Headcount')).toBeTruthy();
  expect(screen.queryByText('On notice')).toBeNull();
});

/* DESIGN.md "Overview pages": a figure never shows at zero; the count line under the title says it. */
it('leaves out the figures that stand at zero, but never Headcount', async () => {
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('Headcount')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('On notice')).toBeNull());
});

/* QA, Team Manager (1 Nov 2026): Home offered Announce, Post one, HR cases and Add an employee, which his role refuses. */
it('offers only the actions this reader may use', async () => {
  const as = (permissions, isAdmin = false) => (
    <PermissionContext.Provider value={{ loading: false, isAdmin, permissions: new Set(permissions) }}>
      <PeopleOverview openScreen={vi.fn()} />
    </PermissionContext.Provider>
  );
  const { unmount } = render(as(['PEOPLE::Employees::VIEW', 'ATTENDANCE::Leave Requests::VIEW']));
  expect(await screen.findByText('Headcount')).toBeTruthy();
  expect(await screen.findByRole('link', { name: 'Leave calendar' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'My requests' })).toBeNull();
  for (const name of [/Announce/, /Post one/, /Help desk/, /Add employee/, /All events/]) expect(screen.queryByRole('button', { name })).toBeNull();
  unmount();
  render(as([], true));
  expect(await screen.findByRole('link', { name: 'My requests' })).toBeTruthy();
  for (const name of [/Post one/, /Add employee/, /All events/]) expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add employee', exact: true })).toHaveClass('ui-btn-primary');
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
  expect(screen.queryByText('No approved leave today.')).toBeNull();
  const team = within(screen.getByRole('region', { name: 'Team overview' }));
  expect(team.getByText('On leave today').closest('li')).toHaveTextContent('Could not load');
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
    const approved = { employeeId: 'e2', status: 'APPROVED', fromDate: '2026-11-07', toDate: '2026-11-07', employeeName: 'Bala', leaveTypeName: 'Casual leave', days: 1 };
    timeOff.listLeaveRequests.mockResolvedValueOnce([{ ...approved, id: 'l2' }, { ...approved, id: 'l3' }]);
    render(<PeopleOverview openScreen={vi.fn()} />);
    const away = within(await screen.findByRole('region', { name: 'Team overview' }));
    const row = away.getByText('On leave today').closest('li');
    expect(within(row).getByText('1')).toBeTruthy();
    expect(screen.getAllByText('Bala')).toHaveLength(1);
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

it('keeps the action panel in its loading state while the inbox and leave load', async () => {
  const api = await import('@ui/personnel/api');
  const timeOff = await import('@ui/timeOff/api');
  api.getPeopleHome.mockImplementationOnce(() => new Promise(() => {}));
  timeOff.listLeaveRequests.mockImplementationOnce(() => new Promise(() => {}));
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByRole('status', { name: 'Loading requests and tasks' })).toBeTruthy();
  expect(screen.queryByText('All caught up')).toBeNull();
});

/* People plan, 8 Nov 2026: Home's waiting number is the inbox's own (help desk included), not a sum of to-do lines. */
it('shows the waiting number the server counts for the inbox, the one the rail badge shows', async () => {
  const api = await import('@ui/personnel/api');
  api.getPeopleHome.mockResolvedValueOnce({ todos: [{ key: 'leave', title: 'Leave waiting', count: 1, screen: 'approvals' }], waiting: 3, probation: null, week: null, monthClose: null });
  render(<PermissionContext.Provider value={{ permissions: new Set(['PEOPLE::Requests::VIEW']) }}>
    <PeopleOverview openScreen={vi.fn()} />
  </PermissionContext.Provider>);
  expect(await screen.findByRole('link', { name: 'Inbox, 3 items need your action' })).toBeTruthy();
});

/* Owner, 8 Nov 2026: approvals live in the Inbox. Home says how many wait and opens it; it lists and approves none. */
it('shows one line for the Inbox, no request list and no Approve button', async () => {
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  const line = await screen.findByRole('button', { name: 'Review requests' });
  expect(within(line.closest('li')).getByText('4')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  expect(screen.queryByText('Leave waiting')).toBeNull();
  expect(screen.queryByText('Field punches waiting')).toBeNull();
  /* Tasks that are not approvals stay listed. */
  expect(screen.getByText('Documents expiring')).toBeTruthy();
  fireEvent.click(line);
  expect(openScreen).toHaveBeenCalledWith('approvals', { tab: 'waiting' });
});

