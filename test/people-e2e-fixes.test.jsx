import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * What the People end-to-end suite found (e2e/, 30 Oct 2026), fixed on the
 * screens: clashes on Who's away and the Leave calendar (M4), Job changes'
 * phone card says from and to (H8), the bell's "stop showing" names a kind
 * in words, the owner's own leave in her Approvals with why (A7), and the
 * metric buttons named by what they show (axe label-content-name-mismatch).
 */
const leaveApi = vi.hoisted(() => ({
  getTimeOverview: vi.fn(),
  listLeaveRequests: vi.fn(),
  listHolidays: vi.fn(async () => []),
  getWorkingWeek: vi.fn(async () => ({ weeklyOffDays: '0', offSaturdays: '' })),
  getWorkingAway: vi.fn(async () => []),
  bulkReviewLeave: vi.fn(),
  bulkReviewRequests: vi.fn(),
  bulkReviewPunches: vi.fn(),
  bulkReviewOvertime: vi.fn(),
  todayIst: () => '2026-11-02',
}));
vi.mock('@ui/timeOff/api', async (orig) => ({ ...(await orig()), ...leaveApi }));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...leaveApi }));
const lifecycleApi = vi.hoisted(() => ({ pageChanges: vi.fn() }));
vi.mock('../packages/ui/src/lifecycle/api', async (orig) => ({ ...(await orig()), ...lifecycleApi }));
const approvalsApi = vi.hoisted(() => ({
  getInbox: vi.fn(),
  listRequests: vi.fn(async () => ({ mine: [], waitingForMe: [] })),
  bulkDecideRequests: vi.fn(), decideRequest: vi.fn(), replyRequest: vi.fn(), withdrawRequest: vi.fn(),
}));
vi.mock('../apps/people/src/api/approvals', () => approvalsApi);
vi.mock('@ui/timeOff/LeaveRequests', () => ({ RequestDrawer: () => null, EnterLeave: () => null, TypeDot: () => null }));
vi.mock('../packages/ui/src/timeOff/LeaveRequests', () => ({ RequestDrawer: () => null, EnterLeave: () => null, TypeDot: () => null }));
vi.mock('@ui/timeOff/AttendanceRequests', () => ({ RequestDrawer: () => null, KIND_NAME: {} }));
const bellApi = vi.hoisted(() => ({
  getInbox: vi.fn(async () => ({ unread: 1, notifications: [{ id: 'n1', kind: 'attendance.leave_asked', title: 'Priya Sharma (AT-004) asks for Casual leave, 8 Dec 2026', body: 'Half a day, first half', createdAt: new Date().toISOString() }] })),
  getMutes: vi.fn(async () => []), markAllRead: vi.fn(async () => ({})), markRead: vi.fn(async () => ({})), setMute: vi.fn(async () => []),
}));
vi.mock('@ui/api/notifications', () => bellApi);
vi.mock('@ui/personnel/Employees', () => ({ Avatar: () => null, SCHEDULED_LABELS: {} }));

import { clashDays } from '../packages/ui/src/timeOff/clashes';
import { KIND, kindLabel } from '../packages/shell/notificationKinds';
import TimeOverview from '../packages/ui/src/timeOff/TimeOverview';
import LeaveCalendar from '../packages/ui/src/timeOff/LeaveCalendar';
import NotificationBell from '../packages/shell/NotificationBell';
import Changes from '../packages/ui/src/lifecycle/Changes';
import Approvals from '../apps/people/src/screens/Approvals';
import { PermissionContext } from '../packages/ui/src/permissions/context';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const away = (over) => ({ id: over.employeeId, status: 'APPROVED', department: 'Production', leaveTypeName: 'Casual leave', ...over });
const perms = { loading: false, error: '', isAdmin: true, permissions: new Set() };
const withPerms = (ui) => <PermissionContext.Provider value={perms}>{ui}</PermissionContext.Provider>;

describe('clashes: two of a group away on one day (M4)', () => {
  it('flags two of a department on the same day, approved or waiting, and spans days in a row', () => {
    const rows = [
      away({ employeeId: 'i', employeeName: 'Imran Khan', fromDate: '2026-11-04', toDate: '2026-11-05' }),
      away({ employeeId: 'l', employeeName: 'Lakshmi Patil', fromDate: '2026-11-04', toDate: '2026-11-05', status: 'PENDING' }),
      away({ employeeId: 'a', employeeName: 'Arjun Das', department: 'Sales', fromDate: '2026-11-04', toDate: '2026-11-04' }),
      away({ employeeId: 'x', employeeName: 'Rejected One', fromDate: '2026-11-04', toDate: '2026-11-04', status: 'REJECTED' }),
    ];
    expect(clashDays(rows, '2026-11-02', '2026-11-09')).toEqual([
      { date: '2026-11-04', to: '2026-11-05', group: 'Production', count: 2, names: ['Imran Khan', 'Lakshmi Patil'], waiting: 1 },
    ]);
  });

  it('a team (oneGroup) clashes across departments; one person twice is one person', () => {
    const rows = [
      away({ employeeId: 'i', employeeName: 'Imran Khan', fromDate: '2026-11-04', toDate: '2026-11-04' }),
      away({ id: 'i2', employeeId: 'i', employeeName: 'Imran Khan', fromDate: '2026-11-04', toDate: '2026-11-04', halfDay: 'SECOND' }),
      away({ employeeId: 'a', employeeName: 'Arjun Das', department: 'Sales', fromDate: '2026-11-04', toDate: '2026-11-04' }),
    ];
    expect(clashDays(rows, '2026-11-04', '2026-11-04')).toEqual([]);
    expect(clashDays(rows, '2026-11-04', '2026-11-04', { oneGroup: true })).toMatchObject([{ group: null, count: 2, names: ['Arjun Das', 'Imran Khan'] }]);
  });
});

describe("Who's away", () => {
  it('lists two of the team away the same day, and names the metric buttons by what they show', async () => {
    leaveApi.getTimeOverview.mockResolvedValue({
      today: '2026-11-02', team: true, awayToday: [], workingAwayToday: [],
      waiting: { count: 0, olderThan3Days: 0, oldest: [] }, lapsing: { rows: [] },
      upcoming: [
        away({ employeeId: 'i', employeeName: 'Imran Khan', fromDate: '2026-11-04', toDate: '2026-11-04' }),
        away({ employeeId: 'l', employeeName: 'Lakshmi Patil', department: 'Dyeing', fromDate: '2026-11-04', toDate: '2026-11-04' }),
      ],
    });
    render(withPerms(<TimeOverview openScreen={() => {}} />));
    const together = await screen.findByRole('region', { name: 'Away the same day' });
    expect(within(together).getByText('2 people away the same day')).toBeTruthy();
    expect(together.textContent).toContain('Imran Khan, Lakshmi Patil');
    /* No aria-label over the visible words (axe label-content-name-mismatch): the name starts with what is shown. */
    const metric = screen.getByRole('button', { name: /^0\s*Away today/ });
    expect(metric.getAttribute('aria-label')).toBeNull();
  });

  it('says nothing about clashes when nobody overlaps', async () => {
    leaveApi.getTimeOverview.mockResolvedValue({
      today: '2026-11-02', team: false, awayToday: [], workingAwayToday: [], waiting: { count: 0, olderThan3Days: 0, oldest: [] }, lapsing: { rows: [] },
      upcoming: [away({ employeeId: 'i', employeeName: 'Imran Khan', fromDate: '2026-11-04', toDate: '2026-11-04' })],
    });
    render(withPerms(<TimeOverview openScreen={() => {}} />));
    await screen.findByRole('region', { name: 'Next 7 days' });
    expect(screen.queryByRole('region', { name: 'Away the same day' })).toBeNull();
  });
});

describe('Leave calendar', () => {
  it('flags the day two of a department are away, above the grid and in the Away row', async () => {
    const month = '2026-11'; /* todayIst() is 2 Nov 2026 here */
    /* A Wednesday-ish working day inside this month, never the seeded Sunday off. */
    const day = `${month}-${[...Array(28).keys()].map((i) => String(i + 1).padStart(2, '0')).find((d) => new Date(`${month}-${d}T00:00:00Z`).getUTCDay() === 3)}`;
    leaveApi.listLeaveRequests.mockResolvedValue([
      away({ employeeId: 'i', employeeName: 'Imran Khan', fromDate: day, toDate: day }),
      away({ employeeId: 'l', employeeName: 'Lakshmi Patil', fromDate: day, toDate: day, status: 'PENDING' }),
    ]);
    render(<LeaveCalendar />);
    const list = await screen.findByRole('list', { name: 'Away the same day' });
    expect(list.textContent).toContain('2 people away the same day');
    expect(list.textContent).toContain('Imran Khan, Lakshmi Patil');
    expect(list.textContent).toContain('1 waiting');
  });
});

describe('Job changes on a phone (H8)', () => {
  it('the card says what it was and what it becomes', async () => {
    lifecycleApi.pageChanges.mockResolvedValue({
      total: 1, counts: { scheduled: 1 },
      rows: [{ id: 'c1', kind: 'CHANGE', employee: { id: 'e1', name: 'Priya Sharma', code: 'AT-004' }, what: 'Department', from: 'Production', to: 'Sales', date: '2026-12-01', reason: null }],
    });
    render(<Changes params={{}} updateParams={() => {}} openScreen={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('.ui-datatable-card').length).toBe(1));
    expect(document.querySelector('.ui-datatable-card').textContent).toContain('Department: Production → Sales');
  });
});

describe("the bell's stop-showing button", () => {
  /* Every kind the server sends a notice of: read from its source, as the e2e run met "attendance.leave_asked". */
  const kinds = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'generated') walk(p); continue; }
      if (!/\.ts$/.test(name)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/kind: '([a-z]+\.[a-z_]+)'/g)) kinds.add(m[1]);
    }
  };
  walk(join(dirname(fileURLToPath(import.meta.url)), '../server/src'));

  it('has words for every kind the server sends', () => {
    expect(kinds.size).toBeGreaterThan(20);
    const missing = [...kinds].filter((k) => !k.startsWith('test.') && !KIND[k]);
    expect(missing).toEqual([]);
  });

  it('never shows a raw key for one it does not know', () => {
    expect(kindLabel('attendance.leave_asked')).toBe('Leave requests');
    expect(kindLabel('something.new_kind')).toBe('Notices like this one');
  });
});

describe('Approvals: the only approver decides her own leave (A7)', () => {
  it('shows her own leave with why she may decide it, approvable from its row but not chosen in bulk', async () => {
    approvalsApi.getInbox.mockResolvedValue({
      counts: { all: 1, LEAVE: 1 },
      rights: { LEAVE: { see: true, decide: true }, ATTENDANCE: { see: false }, APPROVAL: { see: false }, HELPDESK: { see: false }, PUNCH: { see: false }, OVERTIME: { see: false } },
      items: [{ key: 'LEAVE:l1', kind: 'LEAVE', id: 'l1', what: 'Casual Leave', subKind: 'Casual Leave', employeeId: 'e1', employeeName: 'Lalitha Rao', employeeCode: 'S1', fromDate: '2026-11-10', toDate: '2026-11-10', days: 1, since: new Date().toISOString(), bulk: false, own: 'ONLY_APPROVER' }],
    });
    leaveApi.bulkReviewLeave.mockResolvedValue({ done: 1, failed: 0, results: [] });
    render(withPerms(<Approvals params={{}} updateParams={() => {}} />));
    const row = (await screen.findAllByText('Your own. You’re the only approver, so this is logged.'))[0].closest('tr');
    expect(within(row).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(leaveApi.bulkReviewLeave).toHaveBeenCalledWith(['l1'], true));
  });
});

describe('#80 manager QA: half days say which half; the bell stays on a phone screen', () => {
  const wednesday = (month) => `${month}-${[...Array(28).keys()].map((i) => String(i + 1).padStart(2, '0')).find((d) => new Date(`${month}-${d}T00:00:00Z`).getUTCDay() === 3)}`;

  it('Leave calendar: a half day fills half its cell, on the side of its half, and its label names the half', async () => {
    const day = wednesday('2026-11');
    leaveApi.listLeaveRequests.mockResolvedValue([
      away({ employeeId: 'i', employeeName: 'Imran Khan', fromDate: day, toDate: day, halfDay: 'FIRST' }),
      away({ employeeId: 'p', employeeName: 'Priya Sharma', fromDate: day, toDate: day, halfDay: 'SECOND' }),
      away({ employeeId: 'l', employeeName: 'Lakshmi Patil', fromDate: day, toDate: day }),
    ]);
    render(<LeaveCalendar />);
    const first = await screen.findByRole('img', { name: `${day}: Casual leave, approved, first half` });
    const second = screen.getByRole('img', { name: `${day}: Casual leave, approved, second half` });
    const whole = screen.getByRole('img', { name: `${day}: Casual leave, approved` });
    expect(first.className).toContain('w-1/2');
    expect(first.className).not.toContain('ml-auto');
    expect(second.className).toContain('w-1/2');
    expect(second.className).toContain('ml-auto');
    expect(whole.className).not.toContain('w-1/2');
    expect(screen.getByRole('list', { name: 'Key' }).textContent).toContain('Half day');
  });

  it('Approvals: the row and the phone card name the half', async () => {
    approvalsApi.getInbox.mockResolvedValue({
      counts: { all: 1, LEAVE: 1 },
      rights: { LEAVE: { see: true, decide: true }, ATTENDANCE: { see: false }, APPROVAL: { see: false }, HELPDESK: { see: false }, PUNCH: { see: false }, OVERTIME: { see: false } },
      items: [{ key: 'LEAVE:l2', kind: 'LEAVE', id: 'l2', what: 'Casual Leave', subKind: 'Casual Leave', employeeId: 'e2', employeeName: 'Priya Sharma', employeeCode: 'AT-004', fromDate: '2026-12-08', toDate: '2026-12-08', days: 0.5, halfDay: 'SECOND', since: new Date().toISOString(), bulk: true }],
    });
    render(withPerms(<Approvals params={{}} updateParams={() => {}} />));
    const row = (await screen.findAllByText('Priya Sharma')).map((n) => n.closest('tr')).find(Boolean);
    expect(row.textContent).toContain('Second half');
    expect(row.textContent).not.toContain('Half day');
    const card = document.querySelector('.ui-datatable-card');
    expect(card.textContent).toContain('8 Dec 2026, second half');
  });

  it('the bell panel is pinned inside the screen on a phone, not hung off the bell', async () => {
    render(<NotificationBell tenantKey="t1" onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(panel.className).toMatch(/max-sm:fixed/);
    expect(panel.className).toMatch(/max-sm:inset-x-2/);
    expect(panel.className).toMatch(/max-sm:w-auto/);
    expect(panel.textContent).toContain('Half a day, first half');
  });
});
