import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import LeavePolicy from './LeavePolicy';
import { createLeaveType } from './api';
import { confirmDialog } from '@ui/components/ui/notify';

/*
 * Statutory leave in the policy form (TIME-LEAVE-MARKET-RESEARCH.md G1–G3): the OSH Code earned-leave starting
 * point sends days worked, the eligibility and the OSH carry rule; maternity is one 26-week request in calendar
 * days with 80 days worked; a state set says which of its figures to check.
 */
vi.mock('./api', () => ({
  ACCRUAL_LABEL: { YEARLY: 'Once a year', MONTHLY: 'Every month' },
  MONTH_NAMES: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  PRIVATE_LABEL: 'Private leave',
  colorOf: () => '#000000',
  swatchOf: () => '#000000',
  creditText: () => 'at the start of the period',
  listLeaveTypes: vi.fn().mockResolvedValue([]),
  getLeaveSettings: vi.fn().mockResolvedValue(null),
  previewLeaveType: vi.fn().mockResolvedValue({ period: null, rows: [] }),
  createLeaveType: vi.fn().mockResolvedValue({ id: 'new' }),
  updateLeaveType: vi.fn(), deleteLeaveType: vi.fn(), saveLeaveSettings: vi.fn(),
  todayIst: () => '2026-10-27',
}));
vi.mock('@ui/personnel/api', () => ({ listStructure: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true }) }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn().mockResolvedValue(false) }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, children, footer }) => (open ? <aside>{children}{footer}</aside> : null) }));
vi.mock('@ui/components/ui/DataTable', () => ({ default: ({ toolbar }) => <div>{toolbar}</div> }));

beforeEach(() => vi.clearAllMocks());

it('the OSH Code earned-leave starting point earns by days worked, with the OSH carry rule', async () => {
  const user = userEvent.setup();
  render(<LeavePolicy />);
  await user.click(await screen.findByRole('button', { name: /Earned Leave \(OSH Code\)/ }));
  expect(screen.getByLabelText('One day for every, days worked')).toHaveValue(20);
  expect(screen.getByLabelText('Only once worked, days in the period')).toHaveValue(180);
  expect(screen.getByRole('checkbox', { name: /OSH Code carry-forward/ })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(createLeaveType).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Earned Leave (OSH Code)', accrualBasis: 'PER_DAYS_WORKED', perDaysWorked: 20, minDaysWorked: 180, carryForwardMax: 30, oshCarry: true, entitlements: [],
  })));
});

it('maternity is one 26-week request in calendar days, after 80 days worked', async () => {
  const user = userEvent.setup();
  render(<LeavePolicy />);
  await user.click(await screen.findByRole('button', { name: /Maternity Leave/ }));
  expect(screen.getByRole('checkbox', { name: /Counts calendar days/ })).toBeChecked();
  expect(screen.getByText(/paid by ESIC/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(createLeaveType).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Maternity Leave', countsCalendarDays: true, maxDaysPerRequest: 182, availableAfterDays: 80, availableAfterBasis: 'DAYS_WORKED',
    description: expect.stringContaining('26 weeks (12 from the third child)'), accrualBasis: 'CALENDAR', oshCarry: false,
  })));
});

it('a usual type sends the statutory options off, so nothing changes for it', async () => {
  const user = userEvent.setup();
  render(<LeavePolicy />);
  await user.click(await screen.findByRole('button', { name: /Casual Leave/ }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(createLeaveType).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Casual Leave', annualDays: 12, accrualBasis: 'CALENDAR', perDaysWorked: null, minDaysWorked: null, oshCarry: false, countsCalendarDays: false, availableAfterBasis: 'JOINING',
  })));
});

it('a state set says which figure to check against the state’s rules', async () => {
  const user = userEvent.setup();
  render(<LeavePolicy />);
  await user.click(await screen.findByRole('combobox', { name: /Start from your state's rules/ }));
  await user.click(await screen.findByRole('option', { name: 'Delhi' }));
  await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
  expect(confirmDialog.mock.calls[0][0].message).toMatch(/Check against your state's rules: The carry-forward limit: 45 days .* 30 in commentary/);
  expect(createLeaveType).not.toHaveBeenCalled();
});
