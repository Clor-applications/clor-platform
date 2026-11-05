import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

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
  bulkReviewLeave: vi.fn().mockResolvedValue({ results: [{ id: 'l1' }] }),
  bulkReviewRequests: vi.fn().mockResolvedValue({ results: [{ id: 'r1' }] }),
  listLeaveRequests: vi.fn().mockResolvedValue([{ id: 'l1', status: 'PENDING', fromDate: '2026-11-18', toDate: '2026-11-18', employeeName: 'Asha', days: 1 }]),
}));
vi.mock('../api/workspace', () => ({ listRecords: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/timeOff/MyDays', () => ({ HomeCheckIn: () => null }));
vi.mock('./HomeSetup', () => ({ default: () => null }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
/* The Approvals inbox and the Home dashboard (owner's suite spec, 5–6 Nov 2026): real API shapes, nothing made up on screen. */
const inbox = vi.hoisted(() => ({ items: [] }));
vi.mock('../api/approvals', () => ({ getInbox: vi.fn(async () => inbox) }));
const DASH = vi.hoisted(() => ({
  today: { date: '2026-11-06', clock: { expected: 11, clockedIn: 6, inNow: 5, late: 3 }, away: { planned: [{ id: 'e1', name: 'Lakshmi N' }], sick: [{ id: 'e2', name: 'Ravi Kumar' }], wfh: [{ id: 'e3', name: 'Kiran Das' }], field: [] } },
  decisions: {
    probation: [{ employeeId: 'e4', name: 'Farhan Ali', mark: 60, on: '2026-11-04', late: true }],
    statutory: { people: 3, fields: [{ key: 'aadhaar', label: 'Aadhaar', count: 3 }, { key: 'uan', label: 'UAN / PF', count: 0 }] },
    clearance: [{ employeeId: 'e5', name: 'Suresh Babu', lastDay: '2026-11-18', lines: [{ dept: 'IT', label: 'Laptop, devices and accounts' }], late: false }],
  },
  workforce: { headcount: 11, byDepartment: [{ key: 'd1', name: 'Sales', count: 4 }], byEntity: null, byLocation: [], byKind: [{ key: 'FULL_TIME', name: 'Full time', count: 9 }, { key: 'CONTRACT', name: 'Contract', count: 2 }], months: [{ month: '2026-10', joiners: 2, leavers: 1 }, { month: '2026-11', joiners: 0, leavers: 0 }] },
  hiring: { open: 2, onHold: 0, requested: 0, places: 4, pipeline: [{ stage: 'APPLIED', count: 6 }, { stage: 'SCREENING', count: 0 }, { stage: 'INTERVIEW', count: 0 }, { stage: 'OFFER', count: 0 }] },
  links: [{ key: 'shiftExceptions', title: 'Shift exceptions', count: 7, detail: '7 not marked, last 14 days', app: 'attendance', screen: 'exceptions' }, { key: 'reimbursements', title: 'Reimbursements', count: 1, detail: '1 to pay', amount: 2500, screen: 'expenses', params: { tab: 'pay' } }],
}));
vi.mock('../api/home', () => ({
  getHomeDashboard: vi.fn(async () => DASH),
  listKudos: vi.fn(async () => [{ id: 'k1', to: { id: 'e2', name: 'Ravi Kumar' }, fromName: 'Priya', message: 'Closed the GST return early', at: new Date().toISOString(), canRemove: true }]),
  giveKudos: vi.fn(), removeKudos: vi.fn(),
  getPulse: vi.fn(async () => ({ question: { id: 'q1', text: 'How was your week at work?' }, mine: null, answered: 1, showsAt: 3, results: null, average: null, canAsk: true })),
  answerPulse: vi.fn(async () => ({ question: { id: 'q1', text: 'How was your week at work?' }, mine: 4, answered: 2, showsAt: 3, results: null, average: null, canAsk: true })),
  askPulse: vi.fn(), closePulse: vi.fn(),
}));
beforeEach(() => { inbox.items = []; });

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
  for (const name of [/Post broadcast/, /Issue offer or letter/, /Import CSV/, /Post one/, /Add an employee/, /All events/]) expect(screen.queryByRole('button', { name })).toBeNull();
  unmount();
  render(as([], true));
  expect(await screen.findByRole('button', { name: /Post broadcast/ })).toBeTruthy();
  for (const name of [/Issue offer or letter/, /Import CSV/, /Post one/, /Add an employee/, /All events/]) expect(screen.getByRole('button', { name })).toBeTruthy();
});

/* Owner's suite spec, 5–6 Nov 2026: today's attendance, the decisions waiting, workforce and the other apps, from the dashboard. */
it('shows who is in and out today, the decisions waiting, the workforce and the other apps', async () => {
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  const today = (await screen.findByRole('heading', { name: 'Today at work' })).closest('section');
  expect(today.textContent).toContain('6 of 11 clocked in · 3 late');
  for (const name of ['Lakshmi N', 'Ravi Kumar', 'Kiran Das']) expect(within(today).getByText(name)).toBeTruthy();

  const waiting = screen.getByRole('heading', { name: 'Waiting for your action' }).closest('section');
  expect(waiting.textContent).toContain('Farhan Ali · 60-day probation review');
  expect(waiting.textContent).toContain('Suresh Babu · exit clearance to sign');
  /* A statutory detail nobody lacks is not listed. */
  expect(within(waiting).getByText('Aadhaar')).toBeTruthy();
  expect(within(waiting).queryByText('UAN / PF')).toBeNull();

  const workforce = screen.getByRole('heading', { name: 'Workforce' }).closest('section');
  expect(within(workforce).getByRole('tab', { name: 'Department' }).getAttribute('aria-selected')).toBe('true');
  /* A breakdown with nothing in it (no entities) offers no tab. */
  expect(within(workforce).queryByRole('tab', { name: 'Entity' })).toBeNull();
  fireEvent.click(within(workforce).getByRole('tab', { name: 'Full time or contract' }));
  expect(within(workforce).getByText('Contract')).toBeTruthy();
  expect(within(workforce).getByLabelText(/Joiners and leavers by month/)).toBeTruthy();

  const apps = screen.getByRole('heading', { name: 'Across your apps' }).closest('section');
  expect(within(apps).getByRole('link', { name: /Shift exceptions/ }).getAttribute('href')).toBe('?app=attendance&open=exceptions');
  fireEvent.click(within(apps).getByRole('button', { name: /Reimbursements/ }));
  expect(openScreen).toHaveBeenCalledWith('expenses', { tab: 'pay' });
});

it('approves a request in one click, and asks for the reason before rejecting', async () => {
  const time = await import('@ui/timeOff/api');
  inbox.items = [
    { key: 'LEAVE:l1', kind: 'LEAVE', id: 'l1', what: 'Casual leave', employeeId: 'e6', employeeName: 'Meera Iyer', fromDate: '2026-11-10', toDate: '2026-11-11', days: 2, bulk: true },
    { key: 'ATTENDANCE:r1', kind: 'ATTENDANCE', subKind: 'WFH', id: 'r1', what: 'Work from home', employeeId: 'e7', employeeName: 'Divya Menon', fromDate: '2026-11-09', toDate: '2026-11-09', bulk: true },
  ];
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('asks for casual leave')).toBeTruthy();
  expect(screen.getByText('asks to work from home')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: "Approve Meera Iyer's request" }));
  await waitFor(() => expect(time.bulkReviewLeave).toHaveBeenCalledWith(['l1'], true, undefined));

  fireEvent.click(screen.getByRole('button', { name: "Reject Divya Menon's request" }));
  const reason = screen.getByLabelText("Why Divya Menon's request is rejected");
  const reject = within(reason.closest('form')).getByRole('button', { name: 'Reject' });
  expect(reject.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: 'Audit on Monday' } });
  fireEvent.click(reject);
  await waitFor(() => expect(time.bulkReviewRequests).toHaveBeenCalledWith(['r1'], false, 'Audit on Monday'));
});

it('answers the pulse, and keeps the counts hidden until enough people answered', async () => {
  const home = await import('../api/home');
  render(<PeopleOverview openScreen={vi.fn()} />);
  const pulse = (await screen.findByRole('heading', { name: 'Pulse' })).closest('section');
  expect(within(pulse).getByText(/results show at/)).toBeTruthy();
  fireEvent.click(within(pulse).getByRole('radio', { name: /^4/ }));
  await waitFor(() => expect(home.answerPulse).toHaveBeenCalledWith('q1', 4));
  expect(within(pulse).queryByRole('list', { name: /Answers/ })).toBeNull();
});
