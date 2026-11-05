import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import AttendanceToday from './AttendanceToday';
import { punchWhere, punchWho, shiftsOn } from './todayData';

/*
 * The owner's suite spec (6 Nov 2026) names six modules for Attendance's
 * dashboard: the clock-in/out stream, geo-fenced phone punches, reader health,
 * shifts and rosters, overtime, and regularisation. All six exist as screens;
 * the dashboard shows each, and hides a panel whose read is refused.
 */
const TODAY = '2026-11-06';
const api = vi.hoisted(() => ({
  todayIst: () => '2026-11-06',
  getOverview: vi.fn(),
  getReaderHealth: vi.fn(),
  getCalendar: vi.fn(),
  getPhonePunches: vi.fn(),
  listOvertimeRequests: vi.fn(),
  listTransactions: vi.fn(),
  getSchedule: vi.fn(),
}));
vi.mock('../api/attendance', () => api);
vi.mock('@platform/context', () => ({ currentUser: () => ({ fullName: 'Asha Rao' }) }));

const OVERVIEW = { date: TODAY, holiday: null, headcount: 4, present: 2, halfDay: 0, absent: 0, onLeave: 1, notMarked: 1, late: [], notIn: [], toValidate: 0, pendingRequests: 2, pendingLeave: 0 };
const PUNCHES = {
  total: 3,
  transactions: [
    { id: 'p1', localTime: `${TODAY} 09:41:00`, kind: 'IN', employeeId: 'e1', employeeName: 'Ravi Kumar', deviceName: 'Gate ZKTeco', pin: '7' },
    { id: 'p2', localTime: `${TODAY} 09:30:00`, kind: 'IN', employeeId: 'e2', employeeName: 'Meena Iyer', deviceName: 'Phone', latitude: 12.9, longitude: 77.6, siteName: 'Whitefield site', pin: '8' },
    { id: 'p3', localTime: `${TODAY} 09:05:00`, kind: 'OUT', employeeId: null, nameOnReader: null, deviceName: 'Gate ZKTeco', pin: '99' },
  ],
};
const PHONE = { summary: { punches: 5, people: 3, field: 1, refused: 2, outside: 2, waiting: 1 }, sites: [{ id: 's1' }, { id: 's2' }] };
const SCHEDULE = {
  shifts: [
    { id: 'gen', name: 'General', code: 'G', color: '#0EA5E9', startTime: '09:30', endTime: '18:30' },
    { id: 'night', name: 'Night', code: 'N', color: '#6D28D9', startTime: '21:00', endTime: '06:00' },
  ],
  rows: [
    { employeeId: 'e1', cells: [{ date: TODAY, kind: 'WORK', shiftId: 'gen', name: 'General', code: 'G' }] },
    { employeeId: 'e2', cells: [{ date: TODAY, kind: 'WORK', shiftId: 'gen', name: 'General', code: 'G' }] },
    { employeeId: 'e3', cells: [{ date: TODAY, kind: 'WORK', shiftId: 'night', name: 'Night', code: 'N' }] },
    { employeeId: 'e4', cells: [{ date: TODAY, kind: 'LEAVE', shiftId: 'gen' }] },
    { employeeId: 'e5', cells: [{ date: TODAY, kind: 'OFF', shiftId: 'gen' }] },
    { employeeId: 'e6', cells: [{ date: TODAY, kind: 'OUT' }] },
  ],
};

const allowAll = () => {
  api.getOverview.mockResolvedValue(OVERVIEW);
  api.getReaderHealth.mockResolvedValue({ readers: [{ id: 'r1', name: 'Gate ZKTeco', status: 'ok', lastSeenAt: new Date().toISOString() }] });
  api.getCalendar.mockResolvedValue({ days: [] });
  api.getPhonePunches.mockResolvedValue(PHONE);
  api.listOvertimeRequests.mockResolvedValue({ requests: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }] });
  api.listTransactions.mockResolvedValue(PUNCHES);
  api.getSchedule.mockResolvedValue(SCHEDULE);
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('shows every spec module: punches, phone punches, readers, shifts, overtime and regularisation', async () => {
  allowAll();
  const openScreen = vi.fn();
  render(<AttendanceToday openScreen={openScreen} />);

  const punches = within((await screen.findByRole('heading', { name: 'Punches coming in' })).closest('section'));
  expect(punches.getByText('3 so far')).toBeTruthy();
  expect(punches.getByRole('status').textContent).toMatch(/^Live, checked \d\d:\d\d$/);
  expect(punches.getByText('Ravi Kumar')).toBeTruthy();
  expect(punches.getByText('Phone at Whitefield site')).toBeTruthy();
  expect(punches.getByText('Reader ID 99')).toBeTruthy();
  expect(punches.getByText(/not matched to anyone/)).toBeTruthy();
  expect(api.listTransactions).toHaveBeenCalledWith({ from: TODAY, to: TODAY, limit: 8 });

  const phone = within(screen.getByRole('heading', { name: 'Phone punches' }).closest('section'));
  expect(phone.getByText('2 work sites fenced')).toBeTruthy();
  expect(phone.getByText(/refused, 2 outside the fence/)).toBeTruthy();

  expect(screen.getByRole('heading', { name: 'Readers' })).toBeTruthy();

  const shifts = within((await screen.findByRole('heading', { name: 'Shifts today' })).closest('section'));
  expect(shifts.getByText('3 working')).toBeTruthy();
  expect(shifts.getByText('General')).toBeTruthy();
  expect(shifts.getByText('09:30 to 18:30')).toBeTruthy();
  expect(shifts.getByText('1 weekly off, 1 on leave.')).toBeTruthy();

  /* Waiting for you: regularisation (attendance requests), overtime and field punches, each opening its screen. */
  const queue = within(screen.getByRole('heading', { name: 'Waiting for you' }).parentElement);
  await waitFor(() => expect(queue.getByText('overtime requests')).toBeTruthy());
  expect(queue.getByText('attendance requests')).toBeTruthy();
  expect(queue.getByText('field punch to review')).toBeTruthy();
  fireEvent.click(queue.getByText('overtime requests').closest('button'));
  expect(openScreen).toHaveBeenLastCalledWith('overtime');
  fireEvent.click(queue.getByText('field punch to review').closest('button'));
  expect(openScreen).toHaveBeenLastCalledWith('phonePunches');
});

it('a panel whose read is refused is not shown, and the rest of the dashboard stands', async () => {
  allowAll();
  const no = () => Promise.reject(new Error('Forbidden'));
  api.listTransactions.mockImplementation(no);
  api.getPhonePunches.mockImplementation(no);
  api.getSchedule.mockImplementation(no);
  api.listOvertimeRequests.mockImplementation(no);
  render(<AttendanceToday openScreen={vi.fn()} />);
  expect(await screen.findByRole('heading', { name: 'Readers' })).toBeTruthy();
  await waitFor(() => expect(api.getSchedule).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: 'Punches coming in' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Phone punches' })).toBeNull();
  expect(screen.queryByRole('heading', { name: /^Shifts/ })).toBeNull();
  expect(screen.queryByText(/overtime request/)).toBeNull();
});

it('asks for the latest punches again every 30 seconds while today is open', async () => {
  allowAll();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<AttendanceToday openScreen={vi.fn()} />);
  await screen.findByRole('heading', { name: 'Punches coming in' });
  const before = api.listTransactions.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(api.listTransactions.mock.calls.length).toBe(before + 1);
});

it('a past day shows its punches without the live mark', async () => {
  allowAll();
  render(<AttendanceToday openScreen={vi.fn()} />);
  await screen.findByRole('heading', { name: 'Punches coming in' });
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-11-02' } });
  const past = within((await screen.findByRole('heading', { name: 'Punches that day' })).closest('section'));
  expect(past.queryByRole('status')).toBeNull();
  expect(api.listTransactions).toHaveBeenLastCalledWith({ from: '2026-11-02', to: '2026-11-02', limit: 8 });
});

it('says who and where a punch is in plain words', () => {
  expect(punchWho({ employeeName: 'Ravi', pin: '1' })).toBe('Ravi');
  expect(punchWho({ nameOnReader: 'RAVI K', pin: '1' })).toBe('RAVI K');
  expect(punchWho({ pin: '42' })).toBe('Reader ID 42');
  expect(punchWhere({ deviceName: 'Gate' })).toEqual({ phone: false, text: 'Gate' });
  expect(punchWhere({ latitude: 1, longitude: 2, siteName: 'HQ' })).toEqual({ phone: true, text: 'Phone at HQ' });
  expect(punchWhere({ latitude: 1, longitude: 2 })).toEqual({ phone: true, text: 'Phone, away from a site' });
});

it('counts the day’s shifts in start order, leaving out those not employed', () => {
  const day = shiftsOn(SCHEDULE, TODAY);
  expect(day.list.map((s) => [s.name, s.n])).toEqual([['General', 2], ['Night', 1]]);
  expect(day).toMatchObject({ working: 3, off: 1, leave: 1, holiday: 0 });
  expect(shiftsOn(null, TODAY)).toMatchObject({ list: [], working: 0 });
});
