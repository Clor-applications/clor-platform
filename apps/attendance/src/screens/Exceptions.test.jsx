import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Exceptions from './Exceptions';
import { listExceptions, setExceptionStates } from '../api/attendance';
import { notify } from '@ui/components/ui/notify';

/*
 * A bulk Settle covers every item picked, in batches the server takes; it
 * used to send the first 500 and drop the rest. A batch that fails says how
 * far it got. A kind is asked of the server, so it reaches all of that kind.
 */
vi.mock('../api/attendance', () => ({
  listExceptions: vi.fn(), setExceptionState: vi.fn(), setExceptionStates: vi.fn(), explainDay: vi.fn(),
  dayLabel: (d) => d,
  todayIst: () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ITEMS = 1200;
const item = (i) => ({
  key: `NO_RECORD:e${i}:2026-10-01`, kind: 'NO_RECORD', severity: 'medium', title: 'No attendance on a working day', detail: 'No punch, mark or leave.',
  employeeId: `e${i}`, employeeName: `Person ${i}`, date: '2026-10-01', screen: 'records', status: 'OPEN', assigneeUserId: null, assignee: null, note: null,
});
const answer = (n) => ({
  counts: { NO_RECORD: n, MISSING_OUT: 2 }, figures: { high: 2, medium: n, low: 0, unowned: n + 2 },
  total: n, exceptions: Array.from({ length: n }, (_, i) => item(i)), truncated: false,
});

beforeEach(() => {
  listExceptions.mockReset();
  setExceptionStates.mockReset();
  notify.success.mockReset();
  notify.error.mockReset();
  listExceptions.mockResolvedValue(answer(ITEMS));
});

const pickAllAndSettle = async () => {
  render(<Exceptions />);
  fireEvent.click(await screen.findByRole('checkbox', { name: `Select all ${ITEMS} open items` }));
  expect(screen.getByText(`${ITEMS} selected`)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Settle selected/ }));
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText("Mark settled: 1,200 items")).toBeTruthy();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Mark settled' }));
};

it(`settles all ${ITEMS} picked, in batches of 500, none dropped`, async () => {
  setExceptionStates.mockImplementation(async ({ keys }) => ({ updated: keys.length }));
  await pickAllAndSettle();
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith('1,200 items marked settled.'));
  const sent = setExceptionStates.mock.calls.map(([b]) => b.keys);
  expect(sent.map((k) => k.length)).toEqual([500, 500, 200]);
  expect(new Set(sent.flat()).size).toBe(ITEMS);
  expect(setExceptionStates.mock.calls.every(([b]) => b.status === 'RESOLVED')).toBe(true);
});

it('says how far it got when a batch is refused, never claims the rest', async () => {
  setExceptionStates
    .mockResolvedValueOnce({ updated: 500 })
    .mockRejectedValueOnce(new Error('At most 500 items at a time. Send the rest in another batch.'));
  await pickAllAndSettle();
  await waitFor(() => expect(notify.error).toHaveBeenCalledWith('500 of 1,200 marked settled; the rest were not changed. At most 500 items at a time. Send the rest in another batch.'));
  expect(notify.success).not.toHaveBeenCalled();
  expect(setExceptionStates).toHaveBeenCalledTimes(2);
});

it('asks the server for one kind, and the figures count every item, not just those sent', async () => {
  render(<Exceptions />);
  await screen.findByRole('checkbox', { name: `Select all ${ITEMS} open items` });
  expect(screen.getAllByText(String(ITEMS + 2)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: /^No check-out/ }));
  await waitFor(() => expect(listExceptions).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'MISSING_OUT' })));
});

it('says how many there are when the server sends only the first of them', async () => {
  listExceptions.mockResolvedValue({ ...answer(50), total: 7200, truncated: true });
  render(<Exceptions />);
  expect(await screen.findByText('Showing the first 50 of 7,200. Pick one kind or narrow the dates to reach the rest.')).toBeTruthy();
});

it('asks only for narrower dates when there is just one kind to pick', async () => {
  listExceptions.mockResolvedValue({ ...answer(50), counts: { NO_RECORD: 7200 }, total: 7200, truncated: true });
  render(<Exceptions />);
  expect(await screen.findByText('Showing the first 50 of 7,200. Narrow the dates to reach the rest.')).toBeTruthy();
});
