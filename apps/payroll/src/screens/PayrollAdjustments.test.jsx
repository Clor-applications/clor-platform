import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import PayrollAdjustments from './PayrollAdjustments';
import { cancelPayrollAdjustment, createPayrollAdjustment, listPayrollAdjustments, updatePayrollAdjustment } from '../api/payrollAdjustments';

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
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, title, children }) => open ? <aside aria-label={title}>{children}</aside> : null }));

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

/* QA of #82 (owner and HR), F2. */
const carriedRow = (final) => ({ id: 'carry-1', employeeId: 'employee-1', employeeName: 'Meena Iyer', componentId: 'component-1', componentName: 'Advance recovery', periodId: 'period-1', periodName: 'November', type: 'DEDUCTION', amount: 2200, reason: 'Carried from November', reference: '', status: 'APPROVED', carried: { final } });

it('a carried row is cancelled only with a reason, typed in the screen', async () => {
  vi.mocked(listPayrollAdjustments).mockResolvedValue([carriedRow(false)]);
  vi.mocked(cancelPayrollAdjustment).mockResolvedValue({});
  const user = userEvent.setup();
  render(<PayrollAdjustments />);
  await user.click(await screen.findByRole('button', { name: 'Cancel the Advance recovery for Meena Iyer' }));
  const panel = screen.getByRole('complementary', { name: 'Cancel a carried deduction' });
  const go = screen.getByRole('button', { name: 'Cancel it' });
  expect(go).toBeDisabled();
  await user.type(screen.getByLabelText('Why is it cancelled?'), 'Waived by the owner, 2 Nov');
  await user.click(go);
  await waitFor(() => expect(cancelPayrollAdjustment).toHaveBeenCalledWith('carry-1', 'Waived by the owner, 2 Nov'));
  expect(panel).toBeTruthy();
  /* While the payroll that carried it is open, it is not edited by hand. */
  expect(screen.queryByRole('button', { name: 'Edit the Advance recovery for Meena Iyer' })).toBeNull();
});

it('once that payroll is final, the amount is corrected with a reason', async () => {
  vi.mocked(listPayrollAdjustments).mockResolvedValue([carriedRow(true)]);
  vi.mocked(updatePayrollAdjustment).mockResolvedValue({});
  const user = userEvent.setup();
  render(<PayrollAdjustments />);
  await user.click(await screen.findByRole('button', { name: 'Edit the Advance recovery for Meena Iyer' }));
  expect(screen.getByLabelText('Who')).toBeDisabled();
  const amount = screen.getByLabelText('Amount');
  await user.clear(amount);
  await user.type(amount, '1000');
  await user.type(screen.getByLabelText('Why is the amount corrected?'), 'Agreed with the owner, 2 Nov');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(updatePayrollAdjustment).toHaveBeenCalledWith('carry-1', expect.objectContaining({ amount: 1000, correctionReason: 'Agreed with the owner, 2 Nov' })));
});
