import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import LeaveBalances from './LeaveBalances';
import { PermissionContext } from '@ui/permissions/context';
import { addLeaveAdjustment, setAllocation } from './api';
import { notify } from '@ui/components/ui/notify';

/*
 * Time depth: one person's days for the period set in place of the policy's
 * (gap 22), put back on the policy, and days paid out going to Payroll with
 * their amount (gap 19).
 */
const ledger = {
  period: { from: '2026-01-01', to: '2026-12-31' },
  types: [{ type: { id: 't1', name: 'Earned', isPaid: true, encashable: true }, balance: { available: 15, allocated: 20 }, projected: null, entries: [{ id: 'x', kind: 'ALLOCATED', date: '2026-01-01', days: 20, note: 'Set for this person this period' }], explain: [] }],
};
vi.mock('./api', async (orig) => ({
  ...(await orig()),
  getLeaveSettings: vi.fn().mockResolvedValue(null),
  getLeaveBalances: vi.fn().mockResolvedValue({ year: 2026, types: [{ id: 't1', name: 'Earned', isPaid: true }], rows: [{ employeeId: 'e1', name: 'Asha', code: 'A1', balances: { t1: { available: 15, allocated: 20 } } }] }),
  getLeaveLedger: vi.fn(() => Promise.resolve(ledger)),
  addLeaveAdjustment: vi.fn(), setAllocation: vi.fn(), deleteLeaveAdjustment: vi.fn(), grantCompOff: vi.fn(),
}));
vi.mock('./suggestions', () => ({ useSuggestions: () => [] }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn().mockResolvedValue(true) }));

const mount = () => render(<PermissionContext.Provider value={{ loading: false, error: '', isAdmin: true, permissions: new Set() }}><LeaveBalances /></PermissionContext.Provider>);
const openLedger = async () => {
  fireEvent.click((await screen.findAllByText('Asha'))[0]);
  return screen.findByRole('dialog');
};
const pick = async (drawer, current, option) => {
  fireEvent.click(within(drawer).getAllByText(current)[0]);
  fireEvent.click(await screen.findByRole('option', { name: option }));
};
beforeEach(() => vi.clearAllMocks());

it("sets one person's days for the period, and puts them back on the policy", async () => {
  setAllocation.mockResolvedValue({});
  mount();
  const drawer = await openLedger();
  await within(drawer).findByText('Set for this person');
  await pick(drawer, 'Choose…', 'Earned');
  await pick(drawer, 'Add days', 'Set their days for the period');
  fireEvent.change(within(drawer).getByLabelText(/^Days/), { target: { value: '24' } });
  fireEvent.change(within(drawer).getByLabelText(/^Reason/), { target: { value: 'Agreed at joining' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
  await waitFor(() => expect(setAllocation).toHaveBeenCalledWith({ employeeId: 'e1', leaveTypeId: 't1', year: 2026, days: 24, note: 'Agreed at joining' }));
  fireEvent.click(within(drawer).getByRole('button', { name: /back on the policy/i }));
  await waitFor(() => expect(setAllocation).toHaveBeenLastCalledWith({ employeeId: 'e1', leaveTypeId: 't1', year: 2026, days: null }));
});

it('says what a pay-out is worth and that it went to Payroll', async () => {
  addLeaveAdjustment.mockResolvedValue({ adjustment: {}, payout: { sent: true, amount: 3000, periodName: 'November 2026' } });
  mount();
  const drawer = await openLedger();
  await pick(drawer, 'Choose…', 'Earned');
  await pick(drawer, 'Add days', 'Pay out days');
  fireEvent.change(within(drawer).getByLabelText(/^Days/), { target: { value: '3' } });
  fireEvent.change(within(drawer).getByLabelText(/^Reason/), { target: { value: 'Paid out on request' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Paid out: ₹3,000 sent to Payroll for November 2026, to be approved there.'));
});
