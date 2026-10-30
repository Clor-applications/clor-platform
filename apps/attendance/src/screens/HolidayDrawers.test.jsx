import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { CalendarImport, RestrictedPicks } from './HolidayDrawers';
import { getRestrictedPicks, importHolidayCalendar } from '../api/attendance';

/*
 * Time depth, gaps 17 and 22: a state's own days go to the branch in that
 * state, previewed before anything is written; HR sees who picked which
 * restricted holiday.
 */
vi.mock('../api/attendance', () => ({
  dayLabel: (d) => d,
  getHolidayCalendars: vi.fn().mockResolvedValue({
    year: 2027,
    calendars: [
      { key: 'IN-2027', name: 'National (central government) 2027', state: null, source: 'DoPT OM', complete: true, note: null, days: 17 },
      { key: 'MAHARASHTRA-2027', name: "Maharashtra 2027 (state's own day)", state: 'Maharashtra', source: 'State list', complete: false, note: 'Not published yet.', days: 1 },
    ],
    branches: [{ id: 'b1', name: 'Head office', state: 'Karnataka' }, { id: 'b2', name: 'Pune', state: 'Maharashtra' }],
  }),
  importHolidayCalendar: vi.fn(),
  getRestrictedPicks: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it("previews a state's day for that state's branch, then adds it", async () => {
  importHolidayCalendar.mockImplementation((b) => Promise.resolve(b.dryRun ? { added: [{ date: '2027-05-01', name: 'Maharashtra Din' }], skipped: [], dryRun: true } : { added: [{ date: '2027-05-01', name: 'Maharashtra Din' }], skipped: [] }));
  const onDone = vi.fn();
  render(<CalendarImport year={2027} onClose={() => {}} onDone={onDone} />);
  fireEvent.click(await screen.findByText('Choose…'));
  fireEvent.click(await screen.findByRole('option', { name: /Maharashtra 2027/ }));
  await waitFor(() => expect(importHolidayCalendar).toHaveBeenCalledWith({ key: 'MAHARASHTRA-2027', branchId: 'b2', dryRun: true }));
  expect(await screen.findByText('Adds 1 for Pune')).toBeTruthy();
  expect(screen.getByText(/From: State list/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 holiday' }));
  await waitFor(() => expect(importHolidayCalendar).toHaveBeenLastCalledWith({ key: 'MAHARASHTRA-2027', branchId: 'b2' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(2027));
});

it('offers nothing to add when everything is already there', async () => {
  importHolidayCalendar.mockResolvedValue({ added: [], skipped: [{ date: '2027-01-26', name: 'Republic Day', why: 'already a holiday for everyone' }], dryRun: true });
  render(<CalendarImport year={2027} onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByText('Choose…'));
  fireEvent.click(await screen.findByRole('option', { name: /National/ }));
  expect(await screen.findByText('Nothing new to add')).toBeTruthy();
  /* A list for everyone reads "Everyone", not an empty picker. */
  expect(screen.getByText('Everyone')).toBeTruthy();
  expect(screen.getByText(/already a holiday for everyone/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true);
});

it('lists who picked each restricted holiday and who has picks left', async () => {
  getRestrictedPicks.mockResolvedValue({ year: 2026, quota: 2, holidays: [{ id: 'h1', date: '2026-12-24', name: 'Christmas Eve', people: [{ employeeId: 'e1', name: 'Asha' }] }], people: [{ employeeId: 'e1', name: 'Asha', picked: 1, left: 1 }, { employeeId: 'e2', name: 'Ravi', picked: 2, left: 0 }] });
  render(<RestrictedPicks year={2026} onClose={() => {}} />);
  expect(await screen.findByText('Christmas Eve')).toBeTruthy();
  expect(screen.getByText(/1 picked/)).toBeTruthy();
  expect(screen.getByText('1 person has picks left')).toBeTruthy();
  expect(screen.getByText('Asha (1)')).toBeTruthy();
});
