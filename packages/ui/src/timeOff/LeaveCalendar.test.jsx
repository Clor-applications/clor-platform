import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import LeaveCalendar from './LeaveCalendar';
import { listLeaveRequests } from './api';

vi.mock('./api', async (orig) => ({
  ...(await orig()),
  listLeaveRequests: vi.fn(),
  listHolidays: vi.fn().mockResolvedValue([]),
  getWorkingWeek: vi.fn().mockResolvedValue({ weeklyOffDays: '0' }),
  getWorkingAway: vi.fn().mockResolvedValue([]),
  todayIst: () => '2026-11-07',
}));

const leave = (id, name, fromDate) => ({ id, employeeId: id, employeeName: name, department: 'Sales', status: 'APPROVED', leaveTypeName: 'Casual leave', fromDate, toDate: fromDate, days: 1 });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => vi.clearAllMocks());

/* UI audit, 7 Nov 2026: paging months quickly let an older month's answer, arriving last, be drawn under the newer month. */
it('draws only the open month, whatever order the answers arrive in', async () => {
  const pending = {};
  listLeaveRequests.mockImplementation(({ month }) => { pending[month] = deferred(); return pending[month].promise; });
  render(<LeaveCalendar />);
  await waitFor(() => expect(pending['2026-11']).toBeTruthy());
  await act(async () => pending['2026-11'].resolve([leave('a', 'Asha November', '2026-11-10')]));
  expect(await screen.findByText('Asha November')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  /* The last month's people are not left on the new month's grid while it loads. */
  expect(screen.getByText('December 2026')).toBeTruthy();
  expect(screen.queryByText('Asha November')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByText('January 2027')).toBeTruthy();

  await waitFor(() => expect(pending['2027-01'] && pending['2026-12']).toBeTruthy());
  /* January answers first, December late: December must not replace it. */
  await act(async () => pending['2027-01'].resolve([leave('c', 'Chitra January', '2027-01-12')]));
  expect(await screen.findByText('Chitra January')).toBeTruthy();
  await act(async () => pending['2026-12'].resolve([leave('b', 'Bala December', '2026-12-15')]));
  expect(screen.getByText('Chitra January')).toBeTruthy();
  expect(screen.queryByText('Bala December')).toBeNull();
});

it('says a month failed to load instead of showing the month before under its name', async () => {
  listLeaveRequests.mockResolvedValueOnce([leave('a', 'Asha November', '2026-11-10')]);
  render(<LeaveCalendar />);
  expect(await screen.findByText('Asha November')).toBeTruthy();
  listLeaveRequests.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Asha November')).toBeNull();
});

/* People plan 8 Nov 2026, §3 rule 4: a calendar always draws its month, weekends shaded, even with nobody away. */
it('draws the month grid with nobody away, and says so in the grid rather than instead of it', async () => {
  listLeaveRequests.mockResolvedValueOnce([]);
  render(<LeaveCalendar />);
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Nobody is away or working elsewhere in November 2026');
  /* By person opens first (owner, 19 Nov 2026): the name column, then one column a day. */
  expect(screen.getByRole('button', { name: 'By person' }).getAttribute('aria-pressed')).toBe('true');
  const grid = screen.getByRole('group', { name: 'Days of November 2026' });
  expect(within(grid).getAllByRole('columnheader')).toHaveLength(31);
  expect(within(grid).getByRole('rowheader', { name: 'Away' })).toBeTruthy();
  /* The month view (R&D PEOPLE-12), one tap away, draws its weeks from Monday. */
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  expect(screen.getByRole('status').textContent).toContain('Nobody is away or working elsewhere in November 2026');
  expect(within(screen.getByRole('region', { name: 'Leave in November 2026' })).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

/* DESIGN.md "Pick conflicts resolved", 19 Nov 2026: the team leave calendar is a row per person across the days. */
it('draws a row a person with leave as one block across its days', async () => {
  listLeaveRequests.mockResolvedValueOnce([
    { ...leave('a', 'Asha Rao', '2026-11-10'), toDate: '2026-11-12', days: 3, leaveTypeColor: '#1b9e77' },
    { ...leave('b', 'Bala Menon', '2026-11-13'), id: 'b1', halfDay: 'SECOND', days: 0.5 },
    { ...leave('b', 'Bala Menon', '2026-11-20'), id: 'b2', status: 'PENDING' },
  ]);
  render(<LeaveCalendar />);
  const grid = await screen.findByRole('group', { name: 'Days of November 2026' });

  /* One row a person, named on the left with their initials. */
  const rows = within(grid).getAllByRole('row').slice(1);
  expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['ARAsha RaoSales', 'BMBala MenonSales', 'Away']);

  /* Day head: weekday letter and number; today marked; Sundays (the weekly off here) tinted. */
  const heads = within(grid).getAllByRole('columnheader').slice(1);
  expect(heads[0].textContent).toBe('S1');
  expect(heads[6].getAttribute('aria-current')).toBe('date');
  expect(heads[0].className).toContain('is-shaded');
  expect(heads[1].className).not.toContain('is-shaded');

  /* Asha's three days are one block: rounded at the 10th, running through the 11th, closed on the 12th. */
  const asha = within(rows[0]).getAllByRole('img');
  expect(asha.map((b) => b.getAttribute('aria-label'))).toEqual(['2026-11-10: Casual leave, approved', '2026-11-11: Casual leave, approved', '2026-11-12: Casual leave, approved']);
  expect(asha.map((b) => b.getAttribute('data-joins') || '')).toEqual(['after', 'before after', 'before']);
  expect(asha[0].className).toContain('is-start');
  expect(asha[2].className).toContain('is-end');
  expect(asha[1].className).not.toMatch(/is-(start|end)/);
  expect(asha[0].style.background).toBeTruthy();

  /* Bala: the afternoon of the 13th as half a block on the right, and a waiting day drawn lighter. */
  const [half, waiting] = within(rows[1]).getAllByRole('img');
  expect(half.getAttribute('data-half')).toBe('SECOND');
  expect(half.className).toMatch(/is-half.*is-second/);
  expect(half.getAttribute('aria-label')).toContain('second half');
  expect(waiting.className).toContain('is-waiting');

  /* The Away row counts approved leave only. */
  const away = within(rows[2]).getAllByRole('cell');
  expect(away[10].textContent).toBe('1');
  expect(away[19].textContent).toBe('');
});
