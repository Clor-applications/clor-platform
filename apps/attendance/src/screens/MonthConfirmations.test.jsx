import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import MonthConfirmations from './MonthConfirmations';
import { getMonthReadiness, resolveMonthDispute } from '../api/attendance';

/*
 * HR answers an employee who says their month is wrong: an open dispute has a
 * Resolve action and a reply box; an answered one shows the reply and who
 * gave it. Someone without Attendance Records edit sees the list only.
 */
const perms = vi.hoisted(() => ({ value: { isAdmin: true, permissions: new Set() } }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.value }));
vi.mock('../api/attendance', () => ({
  getMonthReadiness: vi.fn(), resolveMonthDispute: vi.fn(),
  todayIst: () => '2026-11-02',
}));

const OPEN = { employeeId: 'e1', name: 'Ravi Kumar', code: 'E-1', note: 'I was on duty at the client on the 12th', at: '2026-11-01T09:30:00.000Z', resolved: null };
const DONE = { employeeId: 'e2', name: 'Meena Rao', code: 'E-2', note: 'My leave on the 20th is missing', at: '2026-11-01T08:00:00.000Z', resolved: { at: '2026-11-02T06:00:00.000Z', byUserId: 'u1', by: 'Asha Owner', reply: 'Added the leave on the 20th.' } };
const answer = (disputed) => ({ confirmations: { month: '2026-10', portalPeople: 12, confirmed: 8, disputed, openDisputes: disputed.filter((d) => !d.resolved).length, notYet: 2 } });

beforeEach(() => {
  vi.clearAllMocks();
  perms.value = { isAdmin: true, permissions: new Set() };
});

it('answers an open dispute with a reply, sending the note HR read, and reloads', async () => {
  getMonthReadiness.mockResolvedValueOnce(answer([OPEN, DONE])).mockResolvedValueOnce(answer([{ ...OPEN, resolved: { at: '2026-11-02T07:00:00.000Z', by: 'Asha Owner', reply: 'Corrected the 12th.' } }, DONE]));
  resolveMonthDispute.mockResolvedValue({});
  render(<MonthConfirmations />);
  const row = (await screen.findByText('Ravi Kumar')).closest('tr');
  expect(within(row).getByText('Not answered')).toBeTruthy();
  /* The answered one shows the reply and who gave it, with no Resolve. */
  const done = screen.getByText('Meena Rao').closest('tr');
  expect(within(done).getByText('Added the leave on the 20th.')).toBeTruthy();
  expect(within(done).queryByRole('button', { name: /Resolve/ })).toBeNull();

  fireEvent.click(within(row).getByRole('button', { name: 'Resolve Ravi Kumar’s dispute' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('I was on duty at the client on the 12th')).toBeTruthy();
  const send = within(dialog).getByRole('button', { name: 'Send reply' });
  expect(send.disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Corrected the 12th.' } });
  fireEvent.click(send);
  await waitFor(() => expect(resolveMonthDispute).toHaveBeenCalledWith('2026-10', 'e1', 'Corrected the 12th.', OPEN.at));
  expect(await screen.findByText('Reply sent to Ravi Kumar.')).toBeTruthy();
  await waitFor(() => expect(getMonthReadiness).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Corrected the 12th.')).toBeTruthy();
});

it('says why a reply was refused, and shows the dispute as it is now', async () => {
  getMonthReadiness.mockResolvedValue(answer([OPEN]));
  resolveMonthDispute.mockRejectedValue(Object.assign(new Error('This dispute has already been answered.'), { status: 409, code: 'DISPUTE_RESOLVED' }));
  render(<MonthConfirmations />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve Ravi Kumar’s dispute' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Looked at it.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send reply' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect(within(dialog).getByText('This dispute has already been answered.')).toBeTruthy();
  await waitFor(() => expect(getMonthReadiness).toHaveBeenCalledTimes(2));
});

it('offers no Resolve without Attendance Records edit', async () => {
  perms.value = { isAdmin: false, permissions: new Set(['ATTENDANCE::Attendance Records::VIEW']) };
  getMonthReadiness.mockResolvedValue(answer([OPEN]));
  render(<MonthConfirmations />);
  await screen.findByText('Ravi Kumar');
  expect(screen.queryByRole('button', { name: /Resolve/ })).toBeNull();
});
