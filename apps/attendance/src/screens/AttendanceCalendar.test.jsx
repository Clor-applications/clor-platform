import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import AttendanceCalendar from './AttendanceCalendar';
import { runReport } from '../api/attendance';

const day = vi.hoisted(() => (date, extra = {}) => ({ date, present: 3, halfDay: 0, absent: 1, leave: 0, off: false, future: false, holiday: null, ...extra }));

vi.mock('../api/attendance', () => ({
  todayIst: () => '2026-11-03',
  listReports: vi.fn().mockResolvedValue({ departments: [] }),
  getCalendar: vi.fn().mockResolvedValue({
    month: '2026-11',
    today: '2026-11-03',
    days: [day('2026-11-01'), day('2026-11-02'), day('2026-11-03')],
  }),
  runReport: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

/* Audit 21 Nov 2026: a day that failed to load said "Nobody employed that day", as if it had loaded empty. */
it('shows a failed day as a failure with a retry, and the retry loads it', async () => {
  runReport.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
  runReport.mockResolvedValueOnce({ rows: [] });
  render(<AttendanceCalendar />);
  const retry = await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText('Nobody employed that day.')).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(runReport).toHaveBeenCalledTimes(2));
  expect(runReport).toHaveBeenLastCalledWith('daily', { date: '2026-11-03' });
  expect(await screen.findByText('Nobody employed that day.')).toBeTruthy();
});

it('gives each day a spoken label and moves between days with the arrow keys', async () => {
  runReport.mockResolvedValue({ rows: [] });
  render(<AttendanceCalendar />);
  const today = await screen.findByRole('button', { name: /3 Nov/ });
  expect(today.getAttribute('tabindex')).toBe('0');
  today.focus();
  fireEvent.keyDown(today, { key: 'ArrowLeft' });
  const before = screen.getByRole('button', { name: /2 Nov/ });
  await waitFor(() => expect(document.activeElement).toBe(before));
  expect(before.getAttribute('tabindex')).toBe('0');
});
