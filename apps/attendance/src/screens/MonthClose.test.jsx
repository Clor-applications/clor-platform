import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import MonthClose from './MonthClose';
import { getMonthReadiness } from '../api/attendance';

/*
 * Month close in a bigger company: every person with something open can be
 * reached (the list used to stop at 500), the total is said, and the list
 * narrows to one kind of open item.
 */
vi.mock('../api/attendance', () => ({
  closeMonth: vi.fn(), getMonthReadiness: vi.fn(), getMonthSnapshot: vi.fn(), reopenMonth: vi.fn(),
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
