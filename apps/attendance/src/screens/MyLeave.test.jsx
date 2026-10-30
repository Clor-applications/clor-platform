import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import MyLeave from './MyLeave';
import { PermissionContext } from '@ui/permissions/context';

/*
 * People audit, 30 Oct 2026, gap 3: asking for leave, changing or cancelling a
 * request, and picking a restricted holiday all need My attendance CREATE on
 * the server. Someone with view only sees their leave and none of those buttons.
 */
vi.mock('../api/attendance', () => ({
  LEAVE_STATUS: { PENDING: 'ui-pill-warn' },
  applyLeave: vi.fn(), cancelMyLeave: vi.fn(), editMyLeave: vi.fn(), explainMyLeave: vi.fn(), shortenMyLeave: vi.fn(), pickMyRestrictedHoliday: vi.fn(),
  getMyLeave: vi.fn().mockResolvedValue({
    year: 2026, today: '2026-10-30',
    types: [{ id: 't1', name: 'Casual leave', isPaid: true, available: 11, allocated: 12, pending: 1 }],
    requests: [{ id: 'r1', leaveTypeName: 'Casual leave', fromDate: '2026-11-18', toDate: '2026-11-18', days: 1, status: 'PENDING', reason: 'Family function' }],
  }),
  getMyRestrictedHolidays: vi.fn().mockResolvedValue({ year: 2026, quota: 2, picked: 0, left: 2, holidays: [{ id: 'h1', date: '2026-12-24', name: 'Christmas Eve', picked: false, past: false }] }),
}));

const perms = (keys, extra = {}) => ({ loading: false, error: '', isAdmin: false, permissions: new Set(keys), ...extra });
const mount = (value) => render(<PermissionContext.Provider value={value}><MyLeave /></PermissionContext.Provider>);

it('view only: the leave and the holidays show, with no Ask for leave, Pick or row actions', async () => {
  mount(perms(['ATTENDANCE::My Attendance::VIEW']));
  await waitFor(() => expect(screen.getByText('Christmas Eve')).toBeTruthy());
  expect(screen.getAllByText(/Casual leave/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /ask for leave/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /^pick$/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /actions/i })).toBeNull();
});

it('with My attendance CREATE: Ask for leave and Pick are there', async () => {
  mount(perms(['ATTENDANCE::My Attendance::VIEW', 'ATTENDANCE::My Attendance::CREATE']));
  await waitFor(() => expect(screen.getByText('Christmas Eve')).toBeTruthy());
  expect(screen.getByRole('button', { name: /ask for leave/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^pick$/i })).toBeTruthy();
});
