import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import AttendanceToday from './AttendanceToday';
import { getCalendar, getOverview, getReaderHealth } from '../api/attendance';

vi.mock('../api/attendance', () => ({
  getCalendar: vi.fn(),
  getOverview: vi.fn(),
  getReaderHealth: vi.fn(),
  todayIst: () => '2026-11-25',
}));
vi.mock('../components/GetStarted', () => ({ default: () => null }));
vi.mock('../components/MoveToPeople', () => ({ default: () => null }));
vi.mock('../components/round24', () => ({ TodayScreen: () => null }));

it('never shows the previous day under a new date and distinguishes a failed calendar from an empty one', async () => {
  const day = { present: 9, headcount: 10, halfDay: 0, late: [], onLeave: 0, absent: 1, notIn: [] };
  let finish;
  vi.mocked(getOverview)
    .mockResolvedValueOnce(day)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(getCalendar).mockResolvedValueOnce({ days: [] }).mockRejectedValueOnce(new Error('Calendar unavailable'));
  vi.mocked(getReaderHealth).mockResolvedValue(null);

  render(<AttendanceToday />);
  expect(await screen.findByText('9 of 10 in so far, 1 absent.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-11-24' } });
  expect(screen.queryByText(/9 of 10/)).toBeNull();
  await act(async () => finish({ ...day, present: 3, absent: 7 }));
  expect(await screen.findByText('3 of 10 were in, 7 absent.')).toBeInTheDocument();
  expect(screen.getByText(/calendar unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText(/no days recorded/i)).toBeNull();
});
