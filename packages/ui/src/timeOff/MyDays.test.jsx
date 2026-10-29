import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import MyDays, { CheckInCard } from './MyDays';
import { PermissionContext } from '@ui/permissions/context';

/*
 * People audit, 30 Oct 2026, gap 3: a sign-in that may see its own days but
 * not act on them (My attendance VIEW without CREATE) is shown no Check in and
 * no Ask, because the server refuses both. While the permissions are still
 * loading, nothing is hidden: the server decides.
 */
vi.mock('./api', () => ({
  DAY_LABEL: {}, DAY_PILL: {}, STATUS_LABEL: {}, STATUS_PILL: {},
  cancelMyRequest: vi.fn(), clock: vi.fn(),
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
