import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import HeldPunches from './HeldPunches';
import WebClockSettings from './WebClockSettings';
import { decideHeldPunch, decideHeldPunches, getHeldPunches, getWebClock, saveWebClock } from '../api/attendance';
import { confirmDialog, notify } from '@ui/components/ui/notify';

/*
 * Attendance audit, 7 Nov 2026: reader punches held for a look (#11) and
 * clock-in from a browser (#6).
 */
vi.mock('../api/attendance', () => ({
  getHeldPunches: vi.fn(), decideHeldPunch: vi.fn(), decideHeldPunches: vi.fn(), getWebClock: vi.fn(), saveWebClock: vi.fn(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it('draws nothing when no punch is held', async () => {
  getHeldPunches.mockResolvedValue({ held: [], impossible: [] });
  const { container } = render(<HeldPunches />);
  await waitFor(() => expect(getHeldPunches).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

it('lists held punches; Count waits until the time has come, Discard does not', async () => {
  getHeldPunches.mockResolvedValue({
    held: [
      { id: 'p1', reader: 'Gate', pin: '701', time: '2026-11-09 09:00:00', employeeName: 'Asha Rao', due: false },
      { id: 'p2', reader: 'Gate', pin: '702', time: '2026-11-07 09:10:00', employeeName: null, due: true },
    ],
    impossible: [{ id: 'x1', reader: 'Gate', pin: '703', time: '2026-02-31 09:00:00' }],
  });
  decideHeldPunch.mockResolvedValue({ status: 200 });
  render(<HeldPunches />);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getByRole('button', { name: /Count/ }).disabled).toBe(true);
  expect(within(rows[1]).getByText('Not matched')).toBeTruthy();
  expect(within(rows[2]).getByText('No such date')).toBeTruthy();
  fireEvent.click(within(rows[1]).getByRole('button', { name: /Count/ }));
  await waitFor(() => expect(decideHeldPunch).toHaveBeenCalledWith('p2', 'release'));
  fireEvent.click(within(rows[0]).getByRole('button', { name: /Discard/ }));
  await waitFor(() => expect(decideHeldPunch).toHaveBeenCalledWith('p1', 'discard'));
});

/* Review of #144: a reader whose clock ran ahead for weeks leaves more than anyone can click through. */
it('counts every held punch from one reader, moved back by its clock offset, calling until none are left', async () => {
  getHeldPunches.mockResolvedValue({
    month: '2026-10',
    total: 1600,
    readers: [{ deviceId: 'd1', reader: 'Front gate', count: 1600, countable: 1550, aheadMinutes: 20 }],
    held: [{ id: 'p1', deviceId: 'd1', reader: 'Front gate', pin: '701', time: '2026-10-09 09:20:00', employeeName: 'Asha Rao', due: true }],
    impossible: [],
  });
  let release;
  decideHeldPunches
    .mockImplementationOnce(() => new Promise((done) => { release = () => done({ counted: 400, discarded: 0, notYet: 50, notMatched: 0, closedDays: 0, left: 1150, shiftMinutes: 20 }); }))
    .mockResolvedValueOnce({ counted: 1150, discarded: 0, notYet: 50, notMatched: 0, closedDays: 0, left: 0, shiftMinutes: 20 });
  render(<HeldPunches month="2026-10" />);
  await waitFor(() => expect(getHeldPunches).toHaveBeenCalledWith('2026-10'));
  expect(await screen.findByText(/Showing the latest/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Count all from this reader/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/1,550 punches from Front gate/)).toBeTruthy();
  expect(within(dialog).getByText(/clock looks/)).toBeTruthy();
  expect(within(dialog).getByRole('radio', { name: /moved back 20 min/ }).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: /^Count all$/ }));
  await waitFor(() => expect(decideHeldPunches).toHaveBeenCalledWith({ action: 'release', deviceId: 'd1', month: '2026-10', shiftMinutes: 20 }));
  release();
  /* The progress line, then the second call without asking again. */
  expect(await within(dialog).findByText(/Counted/)).toBeTruthy();
  await waitFor(() => expect(decideHeldPunches).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith('1,550 punches counted, moved back 20 min. 50 are still ahead of today.'));
});

it('can count as recorded; Discard all asks first', async () => {
  getHeldPunches.mockResolvedValue({
    readers: [{ deviceId: 'd1', reader: 'Front gate', count: 3, countable: 3, aheadMinutes: 12 }],
    held: [{ id: 'p1', deviceId: 'd1', reader: 'Front gate', pin: '701', time: '2026-10-09 09:12:00', employeeName: 'Asha Rao', due: true }],
    impossible: [],
  });
  decideHeldPunches.mockResolvedValue({ counted: 3, discarded: 0, notYet: 0, notMatched: 0, closedDays: 0, left: 0, shiftMinutes: null });
  render(<HeldPunches />);
  fireEvent.click(await screen.findByRole('button', { name: /Count all from this reader/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('radio', { name: /Count as recorded/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: /^Count all$/ }));
  await waitFor(() => expect(decideHeldPunches).toHaveBeenCalledWith({ action: 'release', deviceId: 'd1', month: null }));

  confirmDialog.mockResolvedValue(false);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Discard all/ }));
  await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
  expect(decideHeldPunches).toHaveBeenCalledTimes(1);
});

it('says when a counted punch’s day is in a closed month', async () => {
  getHeldPunches.mockResolvedValue({ held: [{ id: 'p1', reader: 'Gate', pin: '701', time: '2026-09-09 09:00:00', employeeName: 'Asha Rao', due: true }], impossible: [] });
  decideHeldPunch.mockResolvedValue({ status: 200, closedMonth: true, message: 'Counted. The day is in a closed month, so it was not changed — adjust in payroll.' });
  render(<HeldPunches />);
  fireEvent.click(await screen.findByRole('button', { name: /^Count$/ }));
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Counted. The day is in a closed month, so it was not changed — adjust in payroll.'));
});

it('offers no decisions to someone who may only look', async () => {
  getHeldPunches.mockResolvedValue({ held: [{ id: 'p1', reader: 'Gate', pin: '701', time: '2026-11-09 09:00:00', employeeName: 'Asha Rao', due: true }], impossible: [] });
  render(<HeldPunches canDecide={false} />);
  await screen.findByRole('table');
  expect(screen.queryByRole('button')).toBeNull();
});

it('browser clock-in: suggests this network, and saves the switch and the addresses', async () => {
  getWebClock.mockResolvedValue({ allowed: true, addresses: [], yourAddress: '49.205.10.4', recent: [{ address: '49.205.10.9', clockIns: 3 }] });
  saveWebClock.mockResolvedValue({ allowed: true, addresses: ['49.205.10.4'] });
  const onClose = vi.fn();
  render(<WebClockSettings onClose={onClose} />);
  await screen.findByText(/You are on/);
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Add an address/ }));
  const field = screen.getByLabelText('Address 1');
  fireEvent.focus(field);
  expect(await screen.findByText('This network')).toBeTruthy();
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(field.value).toBe('49.205.10.4');
  fireEvent.click(save);
  await waitFor(() => expect(saveWebClock).toHaveBeenCalledWith({ allowed: true, addresses: ['49.205.10.4'] }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('browser clock-in: switched off hides the addresses; a refusal is shown', async () => {
  getWebClock.mockResolvedValue({ allowed: true, addresses: ['49.205.10.0/24'], yourAddress: null, recent: [] });
  saveWebClock.mockRejectedValue(new Error('300.1.1.1 is not an address or a block like 49.205.10.0/24.'));
  render(<WebClockSettings onClose={() => {}} />);
  await screen.findByLabelText('Address 1');
  fireEvent.click(screen.getByLabelText(/Clock in and out from a browser/));
  expect(screen.queryByLabelText('Address 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/is not an address/);
  expect(saveWebClock).toHaveBeenCalledWith({ allowed: false, addresses: ['49.205.10.0/24'] });
});
