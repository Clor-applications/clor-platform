import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { CompanyPf, MovedOn, Payslips } from './MeExtras';

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

/* Server picks, theme C: read-only figures from the payslips themselves. */
it('the list shows PF saved so far, and the opened payslip shows the company PF split and the year since April', async () => {
  api.getPayslips.mockResolvedValue({
    available: true,
    pfSaved: { since: '2026-04-30', payslips: 7, employee: 12600, employer: 4585, pension: 8015, fund: 17185 },
    slips: [{ id: 's1', period: 'October 2026', net: 14000, paid: true }],
  });
  api.getPayslip.mockResolvedValue({ slip: { ...SLIP, leaving: false, deductionNote: null,
    pf: { employee: 1800, pension: 1250, employer: 550 },
    sinceApril: { from: '2026-04-01', payslips: 7, gross: 140000, tax: 3500, pf: 12600, net: 98000 } } });
  render(<Payslips guard={guard} />);
  const list = await screen.findByRole('region', { name: 'Payslips' });
  expect(within(list).getByText('PF saved so far')).toBeTruthy();
  expect(within(list).getByText('₹17,185.00')).toBeTruthy();
  expect(within(list).getByText(/since 30 Apr 2026/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open payslip for October 2026' }));
  const slip = await screen.findByRole('region', { name: 'Payslip · October 2026' });
  expect(within(slip).getByText('To your pension (EPS)')).toBeTruthy();
  expect(within(slip).getByText('₹1,250.00')).toBeTruthy();
  expect(within(slip).getByText('Since 1 Apr 2026')).toBeTruthy();
  expect(within(slip).getByText('₹3,500.00')).toBeTruthy();
  expect(within(slip).getByText('₹98,000.00')).toBeTruthy();
});

it('no PF card where the payslip had no company PF, and no saved card without PF', async () => {
  const { container } = render(<CompanyPf pf={{ employee: 0, pension: 0, employer: 0 }} />);
  expect(container).toBeEmptyDOMElement();
  api.getPayslips.mockResolvedValue({ available: true, pfSaved: null, slips: [] });
  render(<Payslips guard={guard} />);
  await screen.findByText(/No payslips yet/);
  expect(screen.queryByText('PF saved so far')).toBeNull();
});
