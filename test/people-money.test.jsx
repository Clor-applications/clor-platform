import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * Expenses, advances and salary advances (WORKFLOW-GAP-RESEARCH 4.1, 4.2):
 * the employee app's money cards (bills into a draft, sending them against an
 * advance, a lookalike bill asked about, a salary advance over the cap held
 * back), the approver's view in the inbox drawer (allowing less needs a
 * reason), and HR's Expenses screen (pay with salary, paid now, empty states).
 */
const portal = vi.hoisted(() => ({
  getMoney: vi.fn(),
  addBill: vi.fn(),
  removeBill: vi.fn(async () => ({ ok: true })),
  sendClaim: vi.fn(async () => ({})),
  reopenClaim: vi.fn(),
  askAdvance: vi.fn(async () => ({})),
  previewSalaryAdvance: vi.fn(),
  askSalaryAdvance: vi.fn(async () => ({})),
  withdrawMoney: vi.fn(async () => ({ ok: true })),
  answerMoney: vi.fn(),
  billUrl: vi.fn(),
  billData: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));
const hr = vi.hoisted(() => ({
  listClaims: vi.fn(),
  payClaim: vi.fn(async () => ({})),
  sanctionClaim: vi.fn(async () => ({})),
  markRecorded: vi.fn(async () => ({ recorded: 1 })),
  listAdvances: vi.fn(async () => []),
  payAdvance: vi.fn(),
  advanceReturned: vi.fn(),
  recoverAdvance: vi.fn(),
  listSalaryAdvances: vi.fn(async () => []),
  sendToPayroll: vi.fn(),
  moneyRequest: vi.fn(),
  getReport: vi.fn(),
  listCategories: vi.fn(async () => []),
  saveCategory: vi.fn(),
  openBill: vi.fn(),
  downloadCsv: vi.fn(async () => undefined),
}));
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../apps/attendance/src/portal/moneyApi', () => portal);
vi.mock('../apps/attendance/src/portal/portalApi', () => ({ SignedOut: class SignedOut extends Error {}, todayIst: () => '2026-10-30', portalToken: () => 't', setPortalToken: () => {} }));
vi.mock('../apps/people/src/api/money', () => hr);
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => dialogs);
vi.mock('../packages/ui/src/components/ui/notify', () => dialogs);

import MyMoney from '../apps/attendance/src/portal/MyMoney';
import MoneyRequestDetail from '../apps/people/src/money/MoneyRequestDetail';
import Expenses from '../apps/people/src/money/Expenses';

const guard = (p) => p;
const CATS = [{ id: 'c1', name: 'Travel', limitPerBill: null, creditBlocked: false, active: true }, { id: 'c2', name: 'Food and meals', limitPerBill: 1000, creditBlocked: true, active: true }];
const line = (over = {}) => ({ id: 'l1', spentOn: '2026-10-28', category: 'Travel', categoryId: 'c1', merchant: 'Uber', amount: 450, approvedAmount: null, cutReason: null, billId: 'b1', companyGstin: false, supplierGstin: null, taxAmount: null, overLimit: null, creditBlocked: false, possibleDuplicate: false, ...over });
const SALARY = { available: true, asks: [], loans: [], cap: { known: true, monthlyRoom: 25000, explain: 'By law, everything taken off your pay in a month stays within half your wages.' }, maxMonths: 24 };
const base = (over = {}) => ({ categories: CATS, merchants: ['Uber'], draft: null, claims: [], advances: [], salaryAdvance: SALARY, ...over });

beforeEach(() => { vi.clearAllMocks(); perms.current = { isAdmin: true, permissions: new Set() }; });
afterEach(cleanup);

describe('the employee app: spent for work', () => {
  it('with nothing yet, says how it works and opens the bill form with the camera first', async () => {
    portal.getMoney.mockResolvedValue(base());
    render(<MyMoney guard={guard} />);
    expect(await screen.findByText(/Take a photo of each bill/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add a bill/ }));
    expect(screen.getByRole('button', { name: /Take a photo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose a file/ })).toBeTruthy();
  });

  it('adds a bill; a lookalike bill is asked about and sent again as a different one', async () => {
    portal.getMoney.mockResolvedValue(base());
    portal.addBill
      .mockRejectedValueOnce(Object.assign(new Error('You already have ₹450 at Uber on that day (EXP-0001). Is this a different bill?'), { code: 'POSSIBLE_DUPLICATE' }))
      .mockResolvedValueOnce({ lineId: 'l2', claimId: 'k1', overLimit: null });
    render(<MyMoney guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a bill/ }));
    const form = screen.getByRole('form', { name: 'Add a bill' });
    fireEvent.change(within(form).getByPlaceholderText('₹'), { target: { value: '450' } });
    fireEvent.change(within(form).getByRole('combobox', { name: /What it was for/ }), { target: { value: 'c1' } });
    fireEvent.change(within(form).getByPlaceholderText('Shop, cab, hotel'), { target: { value: 'Uber' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add bill' }));
    await waitFor(() => expect(portal.addBill).toHaveBeenCalledTimes(2));
    expect(dialogs.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Is this a different bill?' }));
    expect(portal.addBill.mock.calls[0][0]).toMatchObject({ amount: 450, categoryId: 'c1', merchant: 'Uber', notDuplicate: false });
    expect(portal.addBill.mock.calls[1][0]).toMatchObject({ notDuplicate: true });
  });

  it('a draft shows its bills and total, and is sent against an open advance', async () => {
    portal.getMoney.mockResolvedValue(base({
      draft: { id: 'k1', claimed: 1650, lines: [line(), line({ id: 'l2', merchant: 'Hotel Saravana', category: 'Food and meals', amount: 1200, overLimit: 1000 })] },
      advances: [{ id: 'a1', number: 'ADV-0001', purpose: 'Mysuru visit', amount: 1000, open: 1000, status: 'PAID', statusLabel: 'Paid to you', settleBy: '2026-11-28' }],
    }));
    render(<MyMoney guard={guard} />);
    expect(await screen.findByText('Not sent yet')).toBeTruthy();
    expect(screen.getByText('₹1,650')).toBeTruthy();
    expect(screen.getByText(/Over the ₹1,000 limit for Food and meals/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: /Set against an advance/ }), { target: { value: 'a1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 bills for approval' }));
    await waitFor(() => expect(portal.sendClaim).toHaveBeenCalledWith('k1', { title: undefined, advanceId: 'a1' }));
  });

  it('a sent claim shows what was allowed and why', async () => {
    portal.getMoney.mockResolvedValue(base({
      claims: [{ id: 'k2', number: 'EXP-0002', title: 'Mysuru visit', status: 'APPROVED', statusLabel: 'Approved, to be paid', claimed: 1650, approved: 1450, advanceSettled: 1000, advanceNumber: 'ADV-0001', toPay: 450, lines: [line({ amount: 1200, approvedAmount: 1000, cutReason: 'Meals up to ₹1,000 a day', merchant: 'Hotel Saravana' })] }],
    }));
    render(<MyMoney guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: /Mysuru visit/ }));
    expect(screen.getByText(/Allowed ₹1,000 of ₹1,200: Meals up to ₹1,000 a day/)).toBeTruthy();
    expect(screen.getByText(/₹1,000 set against advance ADV-0001; ₹450 to you/)).toBeTruthy();
  });
});

describe('the employee app: salary advance', () => {
  it('shows the cap, and holds back an ask over it', async () => {
    portal.getMoney.mockResolvedValue(base());
    portal.previewSalaryAdvance.mockResolvedValue({ amount: 30000, months: 1, emi: 30000, fits: false, monthlyRoom: 25000, mostYouCanAsk: 25000, perquisite: false });
    render(<MyMoney guard={guard} />);
    expect(await screen.findByText('₹25,000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for one' }));
    const form = screen.getByRole('form', { name: 'Ask for a salary advance' });
    fireEvent.change(within(form).getByPlaceholderText('₹'), { target: { value: '30000' } });
    fireEvent.change(within(form).getByRole('combobox', { name: /Repay over/ }), { target: { value: '1' } });
    expect(await screen.findByText(/more than can come off your pay/)).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Ask' }).disabled).toBe(true);
  });

  it('is not shown where the company does not run payroll here', async () => {
    portal.getMoney.mockResolvedValue(base({ salaryAdvance: { available: false, asks: [], loans: [], cap: null } }));
    render(<MyMoney guard={guard} />);
    await screen.findByText('Spent for work');
    expect(screen.queryByText('Salary advance')).toBeNull();
  });
});

describe('the approver in the inbox drawer', () => {
  it('sees each bill with its warnings, and allowing less needs the reason sent with it', async () => {
    hr.moneyRequest.mockResolvedValue({ kind: 'EXPENSE_CLAIM', waitingOnMe: true, record: { id: 'k1', number: 'EXP-0001', claimed: 1650, lines: [line(), line({ id: 'l2', merchant: 'Hotel Saravana', amount: 1200, overLimit: 1000, companyGstin: true, supplierGstin: '29ABCDE1234F1Z5', taxAmount: 60, creditBlocked: true, possibleDuplicate: true })] }, advance: { number: 'ADV-0001', purpose: 'Mysuru visit', open: 1000, amount: 1000 } });
    render(<MoneyRequestDetail request={{ id: 'r1', requestType: 'EXPENSE_CLAIM' }} />);
    expect(await screen.findByText(/Over the ₹1,000 limit/)).toBeTruthy();
    expect(screen.getByText(/credit usually not available/)).toBeTruthy();
    expect(screen.getByText(/they say it is a different one/)).toBeTruthy();
    expect(screen.getByText(/Set against advance ADV-0001/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow less on a bill' }));
    fireEvent.change(screen.getByLabelText('Allow for Hotel Saravana'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Why less for Hotel Saravana'), { target: { value: 'Meals up to ₹1,000 a day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save allowed amounts' }));
    await waitFor(() => expect(hr.sanctionClaim).toHaveBeenCalledWith('k1', [{ id: 'l2', approvedAmount: 1000, reason: 'Meals up to ₹1,000 a day' }]));
  });

  it('a salary advance shows the cap and the perquisite warning', async () => {
    hr.moneyRequest.mockResolvedValue({ kind: 'SALARY_ADVANCE', waitingOnMe: true, record: { amount: 250000, months: 24, emi: 10417, reason: 'House repair' }, cap: { known: true, monthlyRoom: 25000, wages: 50000, basis: 'salary structure', fits: true }, perquisite: 'Above ₹2,00,000 in total, the interest saved can be a taxable perquisite.' });
    render(<MoneyRequestDetail request={{ id: 'r2', requestType: 'SALARY_ADVANCE' }} />);
    expect(await screen.findByText('₹25,000 a month')).toBeTruthy();
    expect(screen.getByText(/taxable perquisite/)).toBeTruthy();
  });

  it('says nothing for a request that is not money', () => {
    const { container } = render(<MoneyRequestDetail request={{ id: 'r3', requestType: 'JOB_CHANGE' }} />);
    expect(container.textContent).toBe('');
    expect(hr.moneyRequest).not.toHaveBeenCalled();
  });
});

describe('HR: Expenses', () => {
  const approved = { id: 'k1', number: 'EXP-0001', title: 'Mysuru visit', status: 'APPROVED', employeeName: 'Asha Nair', employeeCode: 'E-1', claimed: 1650, approved: 1450, toPay: 450, advanceSettled: 1000, advanceNumber: 'ADV-0001', lines: [line()] };

  it('pays an approved claim with salary after saying what that means', async () => {
    hr.listClaims.mockResolvedValue([approved]);
    render(<Expenses params={{}} updateParams={() => {}} />);
    fireEvent.click((await screen.findAllByText('Asha Nair'))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with salary' }));
    await waitFor(() => expect(hr.payClaim).toHaveBeenCalledWith('k1', { mode: 'SALARY' }));
    expect(dialogs.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pay ₹450 with Asha Nair’s salary?' }));
  });

  it('records a claim paid now with how and when', async () => {
    hr.listClaims.mockResolvedValue([approved]);
    render(<Expenses params={{}} updateParams={() => {}} />);
    fireEvent.click((await screen.findAllByText('Asha Nair'))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Paid now' }));
    fireEvent.change(screen.getByRole('combobox', { name: /^How/ }), { target: { value: 'CASH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(hr.payClaim).toHaveBeenCalledWith('k1', expect.objectContaining({ mode: 'NOW', method: 'CASH' })));
  });

  it('with nothing to pay, says where claims come from; without the right to pay, offers no pay buttons', async () => {
    hr.listClaims.mockResolvedValue([]);
    render(<Expenses params={{}} updateParams={() => {}} />);
    expect(await screen.findByText('Nothing to pay')).toBeTruthy();
    cleanup();
    perms.current = { isAdmin: false, permissions: new Set(['PEOPLE::Expenses::VIEW']) };
    hr.listClaims.mockResolvedValue([approved]);
    render(<Expenses params={{}} updateParams={() => {}} />);
    fireEvent.click((await screen.findAllByText('Asha Nair'))[0]);
    await screen.findByText('Asha Nair: Mysuru visit');
    expect(screen.queryByRole('button', { name: 'Pay with salary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download for Books' })).toBeNull();
  });
});
