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
  /* The month view (R&D PEOPLE-12) draws its weeks from Monday; By person keeps one column a day. */
  expect(within(screen.getByRole('table', { name: 'Leave in November 2026' })).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  fireEvent.click(screen.getByRole('button', { name: 'By person' }));
  expect(screen.getByRole('status').textContent).toContain('Nobody is away or working elsewhere in November 2026');
  const grid = screen.getByRole('group', { name: 'Days of November 2026' });
  expect(within(grid).getAllByRole('columnheader')).toHaveLength(31);
  expect(within(grid).getByRole('rowheader', { name: 'Away' })).toBeTruthy();
});
