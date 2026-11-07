import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import MonthClose from './MonthClose';

vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));
import { closeMonth, getMonthReadiness, setAttendanceStartDate } from '../api/attendance';

/*
 * Month close in a bigger company: every person with something open can be
 * reached (the list used to stop at 500), the total is said, and the list
 * narrows to one kind of open item.
 */
vi.mock('../api/attendance', () => ({
  closeMonth: vi.fn(), getMonthReadiness: vi.fn(), getMonthSnapshot: vi.fn(), reopenMonth: vi.fn(), setAttendanceStartDate: vi.fn(),
  dayLabel: (d) => d,
  todayIst: () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
}));

const PEOPLE = 1250;
const person = (i) => ({
  employeeId: `e${i}`, name: `Person ${String(i).padStart(4, '0')}`, code: `M-${i}`,
  missingOut: i < 3 ? 1 : 0, noRecord: 2, unapprovedOvertime: i % 100 === 0 ? 1 : 0, unvalidated: 0, ready: i >= 3,
});
const readiness = (people) => ({
  month: '2026-09', ended: true, closed: null, ready: false, blocking: 1, toCheck: 1, snapshots: [],
  checks: [{ key: 'missingOut', label: 'Days with a check-in and no check-out', severity: 'block', count: 3, screen: 'records', hint: 'Not paid until corrected.' }],
  people,
});

beforeEach(() => {
  getMonthReadiness.mockReset();
  closeMonth.mockReset();
  setAttendanceStartDate.mockReset();
});

const byPerson = () => screen.getByRole('region', { name: 'By person' });

it(`reaches all ${PEOPLE} people with something open, and says how many there are`, async () => {
  getMonthReadiness.mockResolvedValue(readiness([...Array.from({ length: PEOPLE }, (_, i) => person(i)), { ...person(9999), noRecord: 0 }]));
  render(<MonthClose params={{ month: '2026-09' }} />);
  await screen.findByText('1,250 people have something open');
  expect(screen.getByText('Showing 1 to 50 of 1,250 people')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
  expect(screen.getByText('Showing 1,201 to 1,250 of 1,250 people')).toBeTruthy();
  expect(within(byPerson()).getByText('Person 1249')).toBeTruthy();
  /* The person with nothing open is not listed. */
  expect(within(byPerson()).queryByText('Person 9999')).toBeNull();
});

it('narrows the list to one kind, each kind counted', async () => {
  getMonthReadiness.mockResolvedValue(readiness(Array.from({ length: PEOPLE }, (_, i) => person(i))));
  render(<MonthClose params={{ month: '2026-09' }} />);
  await screen.findByText('1,250 people have something open');
  const tabs = screen.getByRole('tablist', { name: 'What is open' });
  const tab = (name) => within(tabs).getByRole('tab', { name: new RegExp(`^${name}`) });
  expect(tab('No check-out').textContent).toBe('No check-out3 people');
  expect(tab('Overtime to approve').textContent).toBe('Overtime to approve13 people');
  expect(tab('No attendance').textContent).toBe('No attendance1,250 people');

  fireEvent.click(tab('No check-out'));
  expect(tab('No check-out').getAttribute('aria-selected')).toBe('true');
  const rows = within(byPerson()).getAllByRole('row').slice(1);
  expect(rows.map((r) => r.cells[0].textContent)).toEqual(['Person 0000 · M-0', 'Person 0001 · M-1', 'Person 0002 · M-2']);

  fireEvent.click(tab('Not validated'));
  expect(within(byPerson()).getByText('Nobody has this open')).toBeTruthy();

  /* A tab list: the arrow keys move between kinds, and the list is the panel they control. */
  fireEvent.keyDown(tab('Not validated'), { key: 'ArrowLeft' });
  expect(tab('Overtime to approve').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tab('Overtime to approve'));
  fireEvent.keyDown(tab('Overtime to approve'), { key: 'Home' });
  expect(tab('All').getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel', { name: /^All/ }).id).toBe(tab('All').getAttribute('aria-controls'));
});

it('says everyone is complete when nobody has anything open', async () => {
  getMonthReadiness.mockResolvedValue(readiness([{ ...person(5), noRecord: 0, unapprovedOvertime: 0 }]));
  render(<MonthClose params={{ month: '2026-09' }} />);
  await waitFor(() => expect(screen.getByText('Everyone’s days are complete')).toBeTruthy());
  expect(screen.getByText('0 people have something open')).toBeTruthy();
  expect(screen.queryByRole('tablist', { name: 'What is open' })).toBeNull();
});

it('shows a team-scoped role its team’s days, without closing or reopening the month', async () => {
  getMonthReadiness.mockResolvedValue({ ...readiness(Array.from({ length: 3 }, (_, i) => person(i))), scope: 'team' });
  render(<MonthClose params={{ month: '2026-09' }} />);
  await screen.findByText('3 people have something open');
  expect(screen.getByText('These are your team’s days. Closing or reopening the month is done by someone who sees the whole company.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Close the month/ })).toBeNull();
});

it('does not offer a team-scoped role Reopen on a closed month', async () => {
  getMonthReadiness.mockResolvedValue({ ...readiness([]), scope: 'team', closed: { at: '2026-10-02T05:00:00Z', byUserId: 'u1' } });
  render(<MonthClose params={{ month: '2026-09' }} />);
  await screen.findByText(/is closed/);
  expect(screen.queryByRole('button', { name: /Reopen/ })).toBeNull();
});

/*
 * Audit 7 Nov 2026, #5: working days with no record are docked as unpaid
 * absence when the month closes. A month with them is never shown as ready,
 * the days are named, and closing needs its own tick, sent back as the count.
 */
const lopMonth = () => ({
  month: '2026-09', ended: true, closed: null, ready: true, blocking: 0, toCheck: 1, snapshots: [], attendanceStartDate: null,
  noRecordDays: 3, noRecordPeople: 1,
  checks: [{ key: 'noRecord', label: 'Working days with no attendance', severity: 'confirm', count: 3, screen: 'records', hint: 'Each is docked as an unpaid absence (loss of pay) when the month closes.' }],
  people: [{ employeeId: 'e1', name: 'Asha Rao', code: 'A-1', missingOut: 0, noRecord: 3, noRecordDates: ['2026-09-03', '2026-09-04', '2026-09-07'], unapprovedOvertime: 0, unvalidated: 0, ready: false }],
});

it('does not call a month with no-record days ready, and closes only once they are confirmed', async () => {
  getMonthReadiness.mockResolvedValue(lopMonth());
  closeMonth.mockResolvedValue({ closed: true, snapshot: { version: 1 } });
  render(<MonthClose params={{ month: '2026-09' }} />);
  expect((await screen.findAllByText('3 working days with no record would be docked as unpaid absence')).length).toBe(1);
  expect(screen.queryByText(/is ready to close/)).toBeNull();
  expect(document.querySelector('.ui-readiness').className).toContain('is-warn');
  const confirm = screen.getByRole('group', { name: '3 working days with no record will be docked as unpaid absence' });
  expect(within(confirm).getByText('Asha Rao')).toBeTruthy();
  expect(within(confirm).getByText(/3, 4, 7 Sept|3, 4, 7 Sep/)).toBeTruthy();

  const button = screen.getByRole('button', { name: /Close the month/ });
  fireEvent.click(screen.getByLabelText(/I have seen the 1 open item/));
  expect(button.disabled).toBe(true);
  fireEvent.click(within(confirm).getByLabelText('Dock these 3 working days from pay as unpaid absence.'));
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(closeMonth).toHaveBeenCalledWith('2026-09', true, 3));
});

it('sets when attendance started on CLOR, from the month close', async () => {
  getMonthReadiness.mockResolvedValue(lopMonth());
  setAttendanceStartDate.mockResolvedValue({ attendanceStartDate: '2026-09-08' });
  render(<MonthClose params={{ month: '2026-09' }} />);
  await screen.findByText('No start date: every working day since joining counts.');
  fireEvent.click(screen.getByRole('button', { name: 'Set start date' }));
  fireEvent.change(screen.getByLabelText('Attendance on CLOR from'), { target: { value: '2026-09-08' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(setAttendanceStartDate).toHaveBeenCalledWith('2026-09-08'));
  await waitFor(() => expect(getMonthReadiness).toHaveBeenCalledTimes(2));
});
