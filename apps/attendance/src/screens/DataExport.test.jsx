import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import DataExport from './DataExport';
import { PermissionContext } from '@ui/permissions/context';

/* Export data lists only what this person may read (People audit gap 5); with nothing, it says so. */
vi.mock('../api/attendance', () => ({
  listEmployees: vi.fn(), listHolidays: vi.fn(), listLeaveRequests: vi.fn(), listRecords: vi.fn(), listShifts: vi.fn(), listTransactions: vi.fn(),
  todayIst: () => '2026-10-30',
}));

const mount = (keys, extra = {}) => render(
  <PermissionContext.Provider value={{ loading: false, error: '', isAdmin: false, permissions: new Set(keys), ...extra }}><DataExport /></PermissionContext.Provider>,
);

it('offers HR only the datasets its reads allow, starting on the first of them', () => {
  mount(['ATTENDANCE::Leave Requests::VIEW', 'ATTENDANCE::Holidays::VIEW']);
  expect(screen.queryByText('Attendance days')).toBeNull();
  expect(screen.queryByText('Punches')).toBeNull();
  expect(screen.getByText('Leave requests')).toBeTruthy();
  expect(screen.getByText('Holidays')).toBeTruthy();
  expect(screen.getByLabelText(/Employees/)).toHaveProperty('checked', true);
});

it('says there is nothing to export, rather than offer a list the server refuses', () => {
  mount(['PEOPLE::Employees::VIEW']);
  expect(screen.getByText('Nothing here you can export')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
});

it('shows every dataset while permissions are unknown', () => {
  mount([], { loading: true });
  expect(screen.getByText('Attendance days')).toBeTruthy();
});
