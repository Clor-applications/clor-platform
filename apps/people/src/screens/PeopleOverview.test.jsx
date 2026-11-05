import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PeopleOverview from './PeopleOverview';

/*
 * Time depth review: Home's headline counts everything waiting in the one
 * Approvals inbox (leave, field punches, overtime…), not leave alone; leave
 * stays the detail line, and the count opens Approvals.
 */
vi.mock('@ui/personnel/api', () => ({
  getOverview: vi.fn().mockResolvedValue({ headcount: 10, byDepartment: [], byStatus: {}, joinedThisMonth: [], leftThisMonth: 0 }),
  getPeopleHome: vi.fn().mockResolvedValue([
    { key: 'leave', title: 'Leave waiting', count: 1, screen: 'approvals', params: { kind: 'LEAVE' } },
    { key: 'fieldPunches', title: 'Field punches waiting', count: 2, screen: 'approvals', params: { kind: 'PUNCH' } },
    { key: 'overtime', title: 'Overtime waiting', count: 1, screen: 'approvals', params: { kind: 'OVERTIME' } },
    { key: 'documents', title: 'Documents expiring', count: 4, screen: 'documents' },
  ]),
  listEmployees: vi.fn().mockResolvedValue({ employees: [] }),
  listMyTasks: vi.fn().mockResolvedValue([]),
  summaryOpened: vi.fn().mockResolvedValue({}),
  updateChecklistTask: vi.fn(),
}));
vi.mock('@ui/timeOff/api', () => ({
  approveLeave: vi.fn(),
  listLeaveRequests: vi.fn().mockResolvedValue([{ id: 'l1', status: 'PENDING', fromDate: '2026-11-18', toDate: '2026-11-18', employeeName: 'Asha', days: 1 }]),
}));
vi.mock('../api/workspace', () => ({ listRecords: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/engagement', () => ({ finalPayList: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/timeOff/MyDays', () => ({ HomeCheckIn: () => null }));
vi.mock('./HomeSetup', () => ({ default: () => null }));

it('counts the whole inbox in the headline and the To approve figure, with leave as the detail', async () => {
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  expect(await screen.findByText('4 requests')).toBeTruthy();
  expect(await screen.findByText(/1 leave request, next starts/)).toBeTruthy();
  fireEvent.click(screen.getByText('To approve').closest('button'));
  expect(openScreen).toHaveBeenCalledWith('approvals', undefined);
});

/* Company choices, "leavings: no" (SPEC 3.5): a reader the leavings are kept from gets no On notice figure. */
it('shows On notice by default, and leaves it out when the company keeps leavings from this reader', async () => {
  const api = await import('@ui/personnel/api');
  const { unmount } = render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('On notice')).toBeTruthy();
  unmount();
  api.getOverview.mockResolvedValueOnce({ headcount: 10, byDepartment: [], byStatus: { ACTIVE: 10 }, joinedThisMonth: [], leftThisMonth: null, leavingsHidden: true });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('To approve')).toBeTruthy();
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
  expect(await screen.findByText('To approve')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Leave requests/ })).toBeTruthy();
  for (const name of [/Announce/, /Post one/, /HR cases/, /Add an employee/, /All events/]) expect(screen.queryByRole('button', { name })).toBeNull();
  unmount();
  render(as([], true));
  expect(await screen.findByRole('button', { name: /Announce/ })).toBeTruthy();
  for (const name of [/Post one/, /HR cases/, /Add an employee/, /All events/]) expect(screen.getByRole('button', { name })).toBeTruthy();
});

/* Design audit, 4 Nov 2026 (blockers 1 and 9, Q3). */
describe('Home after the design audit', () => {
  const task = (i, title, name, extra = {}) => ({ id: `t${i}`, title, kind: 'JOINING', done: false, employee: { id: `e${i}`, name }, ...extra });

  it('shows every block as soon as it mounts, without waiting to be scrolled to', async () => {
    /* An observer that never reports: what a print, a fast fling or a slow phone gets. */
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    try {
      const { container } = render(<PeopleOverview openScreen={vi.fn()} />);
      expect(await screen.findByText('To approve')).toBeTruthy();
      const blocks = [...container.querySelectorAll('[data-reveal]')];
      expect(blocks.length).toBeGreaterThan(3);
      await waitFor(() => { for (const b of container.querySelectorAll('[data-reveal]')) expect(b.hasAttribute('data-shown')).toBe(true); });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Add an employee is the plain primary with its plus, no arrow orb', async () => {
    const { PermissionContext } = await import('@ui/permissions/context');
    const { container } = render(<PermissionContext.Provider value={{ loading: false, isAdmin: true, permissions: new Set() }}><PeopleOverview openScreen={vi.fn()} /></PermissionContext.Provider>);
    const add = await screen.findByRole('button', { name: /Add an employee/ });
    expect(add.className).toMatch(/\bui-btn ui-btn-primary\b/);
    expect(container.querySelector('.soft-pill-orb')).toBeNull();
  });

  it('groups the same task for many people into one line that opens, five lines at most', async () => {
    const api = await import('@ui/personnel/api');
    const tasks = [
      ...['Asha', 'Bala', 'Chitra', 'Dev', 'Esha', 'Farid'].map((n, i) => task(i, 'Collect ID and address proof', n)),
      ...['Sign the offer', 'Laptop', 'Bank details', 'Induction', 'PF form', 'Uniform'].map((t, i) => task(10 + i, t, 'Gita')),
    ];
    api.listMyTasks.mockResolvedValueOnce(tasks);
    render(<PeopleOverview openScreen={vi.fn()} />);
    const head = await screen.findByRole('heading', { name: 'Your tasks' });
    const section = head.closest('section');
    expect(within(section).getAllByText('Collect ID and address proof')).toHaveLength(1);
    expect(within(section).getByText(/· 6 people/)).toBeTruthy();
    expect(within(section).queryByText('Farid')).toBeNull();
    /* Seven different tasks: five shown, the rest behind Show all. */
    expect(within(section).queryByText('Uniform')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: /Collect ID and address proof · 6 people/ }));
    for (const n of ['Asha', 'Farid']) expect(within(section).getByRole('checkbox', { name: `Done: Collect ID and address proof for ${n}` })).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Show all 7' }));
    expect(within(section).getByText('Uniform')).toBeTruthy();
  });

  it('puts Out today and Your tasks in the right-hand column, under Celebrate', async () => {
    const api = await import('@ui/personnel/api');
    api.listMyTasks.mockResolvedValueOnce([task(1, 'Laptop', 'Gita')]);
    render(<PeopleOverview openScreen={vi.fn()} />);
    const aside = (await screen.findByRole('heading', { name: 'Your tasks' })).closest('aside');
    expect(aside).toBeTruthy();
    const heads = within(aside).getAllByRole('heading').map((h) => h.textContent);
    expect(heads.indexOf('Celebrate')).toBeLessThan(heads.indexOf('Out today'));
    expect(heads.indexOf('Out today')).toBeLessThan(heads.indexOf('Your tasks'));
  });
});

/* Outside audit, 5 Nov 2026: a failed request read as "nothing to do". Each block says it did not load and offers Try again. */
describe('Home when a request fails', () => {
  it('says the tasks did not load, never "All caught up", and loads them again on Try again', async () => {
    const api = await import('@ui/personnel/api');
    const leaveApi = await import('@ui/timeOff/api');
    api.getPeopleHome.mockRejectedValueOnce(new Error('Server error'));
    api.listMyTasks.mockRejectedValueOnce(new Error('Server error')).mockResolvedValueOnce([{ id: 't1', title: 'Laptop', kind: 'JOINING', done: false, employee: { id: 'e1', name: 'Gita' } }]);
    leaveApi.listLeaveRequests.mockResolvedValueOnce([]);
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByText("Couldn't load your tasks.")).toBeTruthy();
    expect(screen.getByText("Couldn't load what waits for you.")).toBeTruthy();
    expect(screen.queryByText(/All caught up/)).toBeNull();
    /* The rest of the page still works. */
    expect(screen.getByText('Headcount')).toBeTruthy();
    const tasks = screen.getByRole('heading', { name: 'Your tasks' }).closest('section');
    fireEvent.click(within(tasks).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Laptop/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Couldn't load your tasks.")).toBeNull());
  });

  it('says leave, announcements and events did not load instead of "Everyone is in" or "Nothing posted"', async () => {
    const leaveApi = await import('@ui/timeOff/api');
    const ws = await import('../api/workspace');
    leaveApi.listLeaveRequests.mockRejectedValueOnce(new Error('down'));
    ws.listRecords.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByText("Couldn't load who is out today.")).toBeTruthy();
    expect(screen.getByText("Couldn't load announcements.")).toBeTruthy();
    expect(screen.getByText("Couldn't load events.")).toBeTruthy();
    expect(screen.queryByText('Everyone is in today.')).toBeNull();
    expect(screen.queryByText(/Nothing posted yet/)).toBeNull();
  });

  it('says so when the people list or final pay did not load', async () => {
    const api = await import('@ui/personnel/api');
    const eng = await import('../api/engagement');
    api.listEmployees.mockRejectedValueOnce(new Error('down'));
    eng.finalPayList.mockRejectedValueOnce(new Error('down'));
    render(<PeopleOverview openScreen={vi.fn()} />);
    expect(await screen.findByText("Couldn't load the company snapshot.")).toBeTruthy();
    expect(screen.getByText("Couldn't load final pay due.")).toBeTruthy();
  });
});

/* Review of #128, 5 Nov 2026: a count that did not load is never a nought. */
describe('Home never shows a false zero', () => {
  it('to-dos and leave both fail: the greeting and To approve say so, not "Nothing waits" or "Nothing to approve"', async () => {
    const api = await import('@ui/personnel/api');
    const leaveApi = await import('@ui/timeOff/api');
    api.getPeopleHome.mockRejectedValueOnce(new Error('down'));
    leaveApi.listLeaveRequests.mockRejectedValueOnce(new Error('down'));
    render(<PeopleOverview openScreen={vi.fn()} />);
    const figure = (await screen.findByText('To approve')).closest('button');
    await waitFor(() => expect(within(figure).getByText("Couldn't load what waits for you")).toBeTruthy());
    expect(within(figure).queryByText('Nothing to approve')).toBeNull();
    expect(within(figure).getByText('–')).toBeTruthy();
    expect(screen.queryByText(/Nothing waits for your answer/)).toBeNull();
    expect(screen.getByText(/Couldn't load what waits for you\./, { selector: '.soft-band-sub' })).toBeTruthy();
  });

  it('only leave fails: the note says leave did not load, not "No leave among them"', async () => {
    const leaveApi = await import('@ui/timeOff/api');
    leaveApi.listLeaveRequests.mockRejectedValueOnce(new Error('down'));
    render(<PeopleOverview openScreen={vi.fn()} />);
    const figure = (await screen.findByText('To approve')).closest('button');
    await waitFor(() => expect(within(figure).getByText("Couldn't load leave")).toBeTruthy());
    expect(within(figure).queryByText('No leave among them')).toBeNull();
  });

  it('leave fails and nothing else waits: Waiting for you carries the error line, not a bare heading', async () => {
    const api = await import('@ui/personnel/api');
    const leaveApi = await import('@ui/timeOff/api');
    api.getPeopleHome.mockResolvedValueOnce([]);
    leaveApi.listLeaveRequests.mockRejectedValueOnce(new Error('down'));
    render(<PeopleOverview openScreen={vi.fn()} />);
    const block = (await screen.findByRole('heading', { name: 'Waiting for you' })).closest('section');
    await waitFor(() => expect(within(block).getByText("Couldn't load leave requests.")).toBeTruthy());
    expect(within(block).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('the people list fails: Celebrate says it did not load, not "Nothing to celebrate"', async () => {
    const api = await import('@ui/personnel/api');
    api.listEmployees.mockRejectedValueOnce(new Error('down'));
    render(<PeopleOverview openScreen={vi.fn()} />);
    const block = (await screen.findByRole('heading', { name: 'Celebrate' })).closest('section');
    await waitFor(() => expect(within(block).getByText("Couldn't load anniversaries.")).toBeTruthy());
    expect(within(block).queryByText(/Nothing to celebrate/)).toBeNull();
  });
});
