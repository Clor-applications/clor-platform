import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PeopleOverview from './PeopleOverview';

/*
 * Time depth review: Home's headline counts everything waiting in the one
 * Approvals inbox (leave, field punches, overtime…), not leave alone; leave
 * stays the detail line, and the count opens Approvals.
 */
vi.mock('@ui/personnel/api', () => ({
  getOverview: vi.fn().mockResolvedValue({ headcount: 10, byDepartment: [], byStatus: {}, joinedThisMonth: [], leftThisMonth: 0 }),
  getPeopleHome: vi.fn().mockResolvedValue([
    { key: 'leave', title: 'Leave waiting', count: 1, screen: 'approvals', params: { kind: 'LEAVE' } },
    { key: 'fieldPunches', title: 'Field punches waiting', count: 2, screen: 'approvals', params: { kind: 'PUNCH' } },
    { key: 'overtime', title: 'Overtime waiting', count: 1, screen: 'approvals', params: { kind: 'OVERTIME' } },
    { key: 'documents', title: 'Documents expiring', count: 4, screen: 'documents' },
  ]),
  listEmployees: vi.fn().mockResolvedValue({ employees: [] }),
  listMyTasks: vi.fn().mockResolvedValue([]),
  summaryOpened: vi.fn().mockResolvedValue({}),
  updateChecklistTask: vi.fn(),
}));
vi.mock('@ui/timeOff/api', () => ({
  approveLeave: vi.fn(),
  listLeaveRequests: vi.fn().mockResolvedValue([{ id: 'l1', status: 'PENDING', fromDate: '2026-11-18', toDate: '2026-11-18', employeeName: 'Asha', days: 1 }]),
}));
vi.mock('../api/workspace', () => ({ listRecords: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/timeOff/MyDays', () => ({ HomeCheckIn: () => null }));
vi.mock('./HomeSetup', () => ({ default: () => null }));

it('counts the whole inbox in the headline and the To approve figure, with leave as the detail', async () => {
  const openScreen = vi.fn();
  render(<PeopleOverview openScreen={openScreen} />);
  expect(await screen.findByText('4 requests')).toBeTruthy();
  expect(await screen.findByText(/1 leave request, next starts/)).toBeTruthy();
  fireEvent.click(screen.getByText('To approve').closest('button'));
  expect(openScreen).toHaveBeenCalledWith('approvals', undefined);
});

/* Company choices, "leavings: no" (SPEC 3.5): a reader the leavings are kept from gets no On notice figure. */
it('shows On notice by default, and leaves it out when the company keeps leavings from this reader', async () => {
  const api = await import('@ui/personnel/api');
  const { unmount } = render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('On notice')).toBeTruthy();
  unmount();
  api.getOverview.mockResolvedValueOnce({ headcount: 10, byDepartment: [], byStatus: { ACTIVE: 10 }, joinedThisMonth: [], leftThisMonth: null, leavingsHidden: true });
  render(<PeopleOverview openScreen={vi.fn()} />);
  expect(await screen.findByText('To approve')).toBeTruthy();
  expect(screen.queryByText('On notice')).toBeNull();
});

/* QA, Team Manager (1 Nov 2026): Home offered Announce, Post one, HR cases and Add an employee, which his role refuses. */
it('offers only the actions this reader may use', async () => {
  const { PermissionContext } = await import('@ui/permissions/context');
  const as = (permissions, isAdmin = false) => (
    <PermissionContext.Provider value={{ loading: false, isAdmin, permissions: new Set(permissions) }}>
      <PeopleOverview openScreen={vi.fn()} />
    </PermissionContext.Provider>
  );
  const { unmount } = render(as(['PEOPLE::Employees::VIEW', 'ATTENDANCE::Leave Requests::VIEW']));
  expect(await screen.findByText('To approve')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Leave requests/ })).toBeTruthy();
  for (const name of [/Announce/, /Post one/, /HR cases/, /Add an employee/, /All events/]) expect(screen.queryByRole('button', { name })).toBeNull();
  unmount();
  render(as([], true));
  expect(await screen.findByRole('button', { name: /Announce/ })).toBeTruthy();
  for (const name of [/Post one/, /HR cases/, /Add an employee/, /All events/]) expect(screen.getByRole('button', { name })).toBeTruthy();
});
