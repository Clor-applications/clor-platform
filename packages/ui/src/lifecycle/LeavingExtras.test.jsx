import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import LeavingSections, { FinalPayBanner } from './LeavingExtras';

/*
 * The leaving plan's final-pay clock, no-dues sign-off and exit interview (WORKFLOW-GAP-RESEARCH 4.3,
 * 4.9): each state of the clock in words, a line signed by its owner, money owed with an amount, a
 * manager who was kept from the answers, and HR's outcome.
 */
const api = vi.hoisted(() => ({
  addClearanceLine: vi.fn(),
  decideExitInterview: vi.fn(),
  enterExitInterview: vi.fn(),
  orgUsers: vi.fn(async () => []),
  removeClearanceLine: vi.fn(),
  updateClearanceLine: vi.fn(),
}));
vi.mock('./api', () => api);
vi.mock('@platform/context', () => ({ hasApp: (a) => a === 'payroll', orgId: () => 'org1' }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

const RULE = 'Code on Wages 2019 s.17(2): wages are paid within two working days of the last day.';
const clock = (over) => ({ lastDay: '2026-11-03', dueDate: '2026-11-05', daysLeft: 2, started: true, overdue: false, settlement: null, paid: false, held: null, rule: RULE, ...over });

beforeEach(() => vi.clearAllMocks());

it('the clock: before the last day, counting down, late, held, paid', () => {
  const { rerender } = render(<FinalPayBanner clock={clock({ started: false })} />);
  expect(screen.getByRole('status').textContent).toMatch(/Final pay due 5 Nov 2026.*Two working days after the last day/);
  expect(screen.getByText(RULE)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Full and final' })).toBeTruthy();
  rerender(<FinalPayBanner clock={clock({ daysLeft: 1, settlement: { id: 's1', status: 'DRAFT' } })} />);
  expect(screen.getByRole('status').textContent).toMatch(/1 working day left.*Settlement drafted in Payroll/);
  rerender(<FinalPayBanner clock={clock({ daysLeft: 0 })} />);
  expect(screen.getByRole('status').textContent).toMatch(/Final pay due today/);
  rerender(<FinalPayBanner clock={clock({ overdue: true, daysLeft: -2 })} name="Ravi Kumar" />);
  expect(screen.getByRole('status').className).toMatch(/ui-alert-neg/);
  expect(screen.getByRole('status').textContent).toMatch(/Ravi Kumar: final pay was due 5 Nov 2026.*2 working days late/);
  rerender(<FinalPayBanner clock={clock({ held: { reason: 'No contact after notice 2' } })} />);
  expect(screen.getByRole('status').textContent).toMatch(/Final pay held.*No contact after notice 2.*stays owed/);
  rerender(<FinalPayBanner clock={clock({ paid: true })} />);
  expect(screen.getByRole('status').textContent).toMatch(/Final pay paid/);
  expect(screen.queryByRole('link', { name: 'Full and final' })).toBeNull();
});

const line = (over) => ({ id: 'l1', dept: 'MANAGER', deptWord: 'Manager', label: 'Handover', ownerUserId: 'u1', ownerName: 'Mina Lead', items: [], direction: 'NONE', amount: 0, note: null, status: 'OPEN', signedBy: null, signedAt: null, updatedAt: '2026-10-30T10:00:00.000Z', canSign: true, ...over });
const data = (over = {}) => ({
  canEdit: false,
  clearance: { leaving: true, lastDay: '2026-11-03', open: 2, totals: { owes: 4000, owed: 0 }, lines: [line(), line({ id: 'l2', dept: 'FINANCE', deptWord: 'Accounts', label: 'Advances, loans and claims', ownerName: 'Arun Rao', canSign: false, direction: 'OWES', amount: 4000 })] },
  interview: null,
  ...over,
});

it('no-dues: lines with owner and money; the manager signs theirs', async () => {
  api.updateClearanceLine.mockResolvedValue({ line: {} });
  const onChanged = vi.fn();
  render(<LeavingSections data={data()} employeeId="e1" name="Ravi Kumar" onChanged={onChanged} />);
  expect(screen.getByText('0 of 2 signed')).toBeTruthy();
  expect(screen.getByText('Owes ₹4,000')).toBeTruthy();
  expect(screen.getByText(/never hold up final wages/)).toBeTruthy();
  /* Not HR: no line can be added. */
  expect(screen.queryByText('Add a line')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Manager: Handover/ }));
  const drawer = await screen.findByRole('dialog');
  fireEvent.click(within(drawer).getByRole('button', { name: 'Sign off' }));
  await waitFor(() => expect(api.updateClearanceLine).toHaveBeenCalledWith('l1', expect.objectContaining({ sign: true, seenAt: '2026-10-30T10:00:00.000Z' })));
  expect(onChanged).toHaveBeenCalled();
});

it('no-dues: someone else’s line opens read only; owed money needs an amount', async () => {
  render(<LeavingSections data={data({ canEdit: true, clearance: { ...data().clearance, lines: [line({ canSign: true, dept: 'FINANCE', deptWord: 'Accounts', label: 'Advances' }), line({ id: 'l3', canSign: false, label: 'Theirs' })] } })} employeeId="e1" name="Ravi Kumar" />);
  expect(screen.getByText('Add a line')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Manager: Theirs/ }));
  let drawer = await screen.findByRole('dialog');
  expect(within(drawer).queryByRole('button', { name: 'Sign off' })).toBeNull();
  expect(within(drawer).getByText(/Mina Lead or HR signs this line/)).toBeTruthy();
  fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).pop());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Accounts: Advances/ }));
  drawer = await screen.findByRole('dialog');
  fireEvent.click(within(drawer).getByRole('combobox', { name: 'Money' }));
  fireEvent.click(await screen.findByRole('option', { name: 'The company owes them' }));
  fireEvent.click(within(drawer).getByRole('button', { name: 'Sign off' }));
  expect(await within(drawer).findByRole('alert')).toBeTruthy();
  expect(api.updateClearanceLine).not.toHaveBeenCalled();
  fireEvent.change(within(drawer).getByLabelText('Amount (₹) *'), { target: { value: '1250' } });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Sign off' }));
  await waitFor(() => expect(api.updateClearanceLine).toHaveBeenCalledWith('l1', expect.objectContaining({ direction: 'OWED', amount: 1250, sign: true })));
});

const QUESTIONS = [
  { key: 'reason', text: 'What is the main reason you are leaving?', kind: 'REASON', options: [{ code: 'PAY', label: 'Better pay elsewhere' }, { code: 'GROWTH', label: 'Career growth' }] },
  { key: 'keptYou', text: 'What would have made you stay?', kind: 'TEXT' },
];
const iv = (over) => ({ status: 'SUBMITTED', questions: QUESTIONS, answers: { reason: 'GROWTH', keptYou: 'A lead role' }, hideFromManager: false, hiddenFromYou: false, enteredBy: 'EMPLOYEE', submittedAt: '2026-10-29T08:00:00.000Z', dueBy: '2026-11-01', canEnter: false, canDecide: false, outcome: null, couldKeep: null, purpose: 'Your answers help the company understand why people leave.', ...over });

it('exit interview: a manager kept from the answers sees only that it was answered', () => {
  render(<LeavingSections data={data({ clearance: null, interview: iv({ answers: null, hiddenFromYou: true, hideFromManager: true }) })} employeeId="e1" name="Ravi Kumar" />);
  expect(screen.getByText(/asked to keep the answers from their manager/)).toBeTruthy();
  expect(screen.queryByText('Career growth')).toBeNull();
  expect(screen.queryByRole('button', { name: 'They stay' })).toBeNull();
});

it('exit interview: HR reads the answers, says whether they could have been kept, and keeps them', async () => {
  api.decideExitInterview.mockResolvedValue({ interview: {} });
  render(<LeavingSections data={data({ clearance: null, interview: iv({ canDecide: true }) })} employeeId="e1" name="Ravi Kumar" />);
  expect(screen.getByText('Career growth')).toBeTruthy();
  expect(screen.getByText('A lead role')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'They stay' }));
  await waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Keep Ravi Kumar?' })));
  await waitFor(() => expect(api.decideExitInterview).toHaveBeenCalledWith('e1', { outcome: 'RETAINED' }));
});

it('exit interview: not answered yet, HR enters it; a choice must be picked', async () => {
  api.enterExitInterview.mockResolvedValue({ interview: {} });
  render(<LeavingSections data={data({ clearance: null, interview: iv({ status: 'OPEN', answers: {}, canEnter: true, canDecide: true }) })} employeeId="e1" name="Ravi Kumar" />);
  expect(screen.getByText(/can answer in the employee app, under Me, until 1 Nov 2026/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Enter answers' }));
  const drawer = await screen.findByRole('dialog');
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save answers' }));
  expect((await within(drawer).findByRole('alert')).textContent).toMatch(/main reason/);
  fireEvent.click(within(drawer).getByRole('button', { name: 'Better pay elsewhere', pressed: false }));
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save answers' }));
  await waitFor(() => expect(api.enterExitInterview).toHaveBeenCalledWith('e1', { answers: { reason: 'PAY' }, hideFromManager: false }));
});
