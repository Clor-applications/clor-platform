import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import PayrollAdjustments from './PayrollAdjustments';
import { createPayrollAdjustment } from '../api/payrollAdjustments';

vi.mock('../api/payrollAdjustments', () => ({
  listPayrollAdjustments: vi.fn().mockResolvedValue([]),
  listLeaveEncashments: vi.fn().mockResolvedValue([{ id: 'encash-1', employeeId: 'employee-1', days: 6, reason: 'Year-end payout' }]),
  createPayrollAdjustment: vi.fn().mockResolvedValue({ id: 'earning-1' }),
  updatePayrollAdjustment: vi.fn(), approvePayrollAdjustment: vi.fn(), cancelPayrollAdjustment: vi.fn(), deletePayrollAdjustment: vi.fn(),
}));
vi.mock('../api/payrollCalendar', () => ({ listPayrollPeriods: vi.fn().mockResolvedValue([{ id: 'period-1', name: 'September', isLocked: false }]) }));
vi.mock('../api/payrollComponents', () => ({ listSalaryComponents: vi.fn().mockResolvedValue([{ id: 'component-1', name: 'Leave payout', type: 'EARNING' }]) }));
vi.mock('../api/payrollPeople', () => ({ listEmployees: vi.fn().mockResolvedValue({ employees: [{ id: 'employee-1', name: 'Asha' }] }) }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));
vi.mock('@ui/components/list/DocumentListShell', () => ({ default: ({ primary, children }) => <main>{primary}{children}</main> }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, children }) => open ? <aside>{children}</aside> : null }));

it('links the selected HR debit to the explicitly valued payroll earning', async () => {
  const user = userEvent.setup();
  render(<PayrollAdjustments />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'New adjustment' })[0]).toBeEnabled());
  await user.click(screen.getAllByRole('button', { name: 'New adjustment' })[0]);
  await user.selectOptions(screen.getByRole('combobox', { name: /Leave encashment/ }), 'encash-1');
  await user.type(screen.getByLabelText('Amount'), '6000');
  await user.click(screen.getByRole('button', { name: 'Add', exact: true }));
  await waitFor(() => expect(createPayrollAdjustment).toHaveBeenCalledWith(expect.objectContaining({
    leaveEncashmentId: 'encash-1', employeeId: 'employee-1', componentId: 'component-1', periodId: 'period-1', amount: 6000,
  })));
});
