import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { MovedOn, Payslips } from './MeExtras';

/*
 * The employee's payslip says what it could not take and moved on, as
 * Payroll's slip does (QA, 1 Nov 2026): nothing is dropped, and the person is
 * told where the rest went.
 */
const api = vi.hoisted(() => ({
  SignedOut: class SignedOut extends Error {},
  getPayslips: vi.fn(),
  getPayslip: vi.fn(),
  doneJourneyTask: vi.fn(),
  getJourney: vi.fn(),
  getLeaving: vi.fn(),
  getMyDetails: vi.fn(),
  raisePrivateCase: vi.fn(),
  resign: vi.fn(),
  todayIst: () => '2026-11-02',
}));
vi.mock('./portalApi', () => api);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
const guard = (p) => p;
beforeEach(() => vi.clearAllMocks());

const SLIP = {
  id: 's1', number: 'SL-1', company: 'Kave', period: 'October 2026', from: '2026-10-01', to: '2026-10-31', paid: true,
  employee: { name: 'Ravi', code: 'E1' }, days: null,
  earnings: [{ name: 'Basic', amount: 20000 }], deductions: [{ name: 'Loan Recovery', amount: 6000 }],
  gross: 20000, totalDeductions: 6000, net: 14000,
};

it('the opened payslip says what moved to next month and why', async () => {
  api.getPayslips.mockResolvedValue({ available: true, slips: [{ id: 's1', period: 'October 2026', net: 14000, paid: true }] });
  api.getPayslip.mockResolvedValue({ slip: { ...SLIP, leaving: false, deductionNote: { percent: 50, wages: 20000, limit: 10000, counted: 6000, reason: 'LIMIT', total: 4000, carried: [{ label: 'Salary advance', amount: 4000 }] } } });
  render(<Payslips guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open payslip for October 2026' }));
  expect(await screen.findByText('Moved to next month')).toBeTruthy();
  expect(screen.getByText('Salary advance')).toBeTruthy();
  expect(screen.getByText(/up to 50% of your wages/)).toBeTruthy();
  expect(screen.getByText(/The rest comes off next month’s payslip\./)).toBeTruthy();
});

it('says nothing when nothing moved', () => {
  const { container } = render(<MovedOn note={null} />);
  expect(container).toBeEmptyDOMElement();
});

it('words it for net pay running out, and for a leaver whose rest goes to the full and final', () => {
  const { unmount } = render(<MovedOn note={{ reason: 'NET_PAY', total: 100, carried: [{ label: 'Advance', amount: 100 }] }} />);
  expect(screen.getByText(/nothing left to take it from/)).toBeTruthy();
  unmount();
  render(<MovedOn leaving note={{ percent: 50, wages: 20000, limit: 10000, counted: 2000, reason: 'LIMIT', total: 4000, carried: [{ label: 'Loan Recovery', amount: 4000 }] }} />);
  expect(screen.getByText('Left for your full and final')).toBeTruthy();
  expect(screen.getByText(/goes to your full and final settlement/)).toBeTruthy();
  expect(screen.queryByText(/next month/)).toBeNull();
});

it('when other deductions alone passed the share, says none was taken this month', () => {
  render(<MovedOn note={{ percent: 50, wages: 15000, limit: 7500, counted: 7800, reason: 'LIMIT', total: 3000, carried: [{ label: 'Advance', amount: 3000 }] }} />);
  expect(screen.getByText(/other deductions already came to ₹7,800\.00, so none was taken this month/)).toBeTruthy();
});
