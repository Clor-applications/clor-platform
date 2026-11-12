import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import MyDays, { CheckInCard, TodayPunches } from './MyDays';
import { getMyDays } from './api';
import { PermissionContext } from '@ui/permissions/context';

/*
 * People audit, 30 Oct 2026, gap 3: a sign-in that may see its own days but
 * not act on them (My attendance VIEW without CREATE) is shown no Check in and
 * no Ask, because the server refuses both. While the permissions are still
 * loading, nothing is hidden: the server decides.
 */
vi.mock('./api', () => ({
  DAY_LABEL: {}, DAY_PILL: {}, STATUS_LABEL: {}, STATUS_PILL: {},
  cancelMyRequest: vi.fn(), clock: vi.fn(), phonePunch: vi.fn(),
  getMyDays: vi.fn().mockResolvedValue({ employee: { id: 'e1', name: 'Kavya', code: 'MF-1' }, clockedIn: false, todayRecord: null, records: [], requests: [], shift: { startTime: '09:30', endTime: '18:00' } }),
  myRequests: vi.fn().mockResolvedValue({ requests: [], rules: {}, usage: {} }),
  todayIst: () => '2026-10-30',
}));
vi.mock('./AttendanceRequests', () => ({ EnterRequest: () => null, KINDS: [], KIND_NAME: {}, WhenCell: () => null, detailsText: () => '', monthChoices: () => [] }));

const perms = (keys, extra = {}) => ({ loading: false, error: '', isAdmin: false, permissions: new Set(keys), ...extra });
const withPerms = (value, ui) => render(<PermissionContext.Provider value={value}>{ui}</PermissionContext.Provider>);
const me = { clockedIn: false, todayRecord: null, shift: { startTime: '09:30', endTime: '18:00' } };

beforeEach(() => vi.clearAllMocks());

it('offers Check in to someone who may act on their own days', () => {
  withPerms(perms(['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE']), <CheckInCard me={me} onChanged={() => {}} />);
  expect(screen.getByRole('button', { name: /check in/i })).toBeTruthy();
});

it('shows the day but no Check in to someone with view only', () => {
  withPerms(perms(['ATTENDANCE::My Attendance::VIEW']), <CheckInCard me={me} onChanged={() => {}} />);
  expect(screen.getByText('Not checked in today')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /check in/i })).toBeNull();
});

it('hides nothing while the permissions are loading or could not be read', () => {
  const { unmount } = withPerms(perms([], { loading: true }), <CheckInCard me={me} onChanged={() => {}} />);
  expect(screen.getByRole('button', { name: /check in/i })).toBeTruthy();
  unmount();
  withPerms(perms([], { error: 'offline' }), <CheckInCard me={me} onChanged={() => {}} />);
  expect(screen.getByRole('button', { name: /check in/i })).toBeTruthy();
});

it('drops Ask from My attendance for view only, and keeps it for an administrator', async () => {
  const { unmount } = withPerms(perms(['ATTENDANCE::My Attendance::VIEW']), <MyDays />);
  await waitFor(() => expect(screen.getByText('Not checked in today')).toBeTruthy());
  expect(screen.queryByRole('button', { name: /^ask$/i })).toBeNull();
  unmount();
  withPerms(perms([], { isAdmin: true }), <MyDays />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeTruthy());
});

/* Time depth, gap 18: HR switched phone punching on for this person, so My attendance punches with the position instead of the plain check-in, and a field punch says it waits. */
it('punches from the phone when HR allows it, instead of the plain check-in', async () => {
  getMyDays.mockResolvedValueOnce({ employee: { id: 'e1', name: 'Kavya' }, clockedIn: false, todayRecord: null, records: [], requests: [], shift: {}, phone: { allowed: true, next: 'IN', sites: [{ id: 's1', name: 'Head office', latitude: 12.9, longitude: 77.6, radiusMeters: 100 }] }, punches: [{ time: '09:05', kind: 'IN', phone: true, site: 'Outside the work sites', outside: true, review: 'PENDING' }] });
  withPerms(perms([], { isAdmin: true }), <MyDays />);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Punch from this phone' })).toBeTruthy());
  expect(screen.queryByText('Not checked in today')).toBeNull();
  expect(screen.getByText('Waiting for approval')).toBeTruthy();
});

it('lists nothing when there are no punches yet, and says a refused field punch does not count', () => {
  const { container, unmount } = render(<TodayPunches punches={[]} />);
  expect(container.textContent).toBe('');
  unmount();
  render(<TodayPunches punches={[{ time: '18:10', kind: 'OUT', phone: true, site: 'Client site', review: 'REJECTED' }]} />);
  expect(screen.getByText('Not counted')).toBeTruthy();
});

/* Attendance audit, 7 Nov 2026, #6: the company's punch policy refuses this browser, so the card says why instead of a button the server refuses. */
it('says why instead of Check in when the punch policy refuses this browser', () => {
  const why = 'Clock-in from a browser counts only from the office network. Punch at a reader, or ask HR.';
  withPerms(perms([], { isAdmin: true }), <CheckInCard me={{ ...me, webClock: { allowed: false, code: 'WEB_CLOCK_ADDRESS', why } }} onChanged={() => {}} />);
  expect(screen.getByRole('note').textContent).toBe(why);
  expect(screen.queryByRole('button', { name: /check in/i })).toBeNull();
});

/* Review of #144: a day the browser clock opened can always be closed by it. */
it('keeps Check out for a day the browser clock opened, even when the policy now refuses a new one', () => {
  withPerms(perms([], { isAdmin: true }), <CheckInCard me={{ ...me, clockedIn: true, todayRecord: { checkInTime: '09:05' }, webClock: { allowed: true, outOnly: true, code: 'WEB_CLOCK_OFF', why: 'Off here.' } }} onChanged={() => {}} />);
  expect(screen.getByRole('button', { name: /check out/i })).toBeTruthy();
});
