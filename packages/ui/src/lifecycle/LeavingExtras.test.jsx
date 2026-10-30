import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import LeavingSections, { ExitQuestionsForm, FinalPayBanner, FinalPayList } from './LeavingExtras';

/*
 * The leaving plan's final-pay clock, no-dues sign-off and exit interview (WORKFLOW-GAP-RESEARCH 4.3,
 * 4.9): each state of the clock in words, a line signed by its owner, money owed with an amount, a
 * manager who was kept from the answers, and HR's outcome.
 */
const api = vi.hoisted(() => ({
  addClearanceLine: vi.fn(),
  decideExitInterview: vi.fn(),
  enterExitInterview: vi.fn(),
  withOwner: (users, id, name) => (id && !users.some((u) => u.id === id) ? [...users, { id, fullName: name }] : users),
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
  expect(screen.getByText(/asked to keep the answers from their managers/)).toBeTruthy();
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

it('a line whose money is not yours shows none of it, and the form sends none of it', async () => {
  const line = { id: 'f', dept: 'FINANCE', deptWord: 'Accounts', label: 'Advances, loans and claims', ownerName: 'Priya', items: [], status: 'OPEN', canSign: false, mine: false, moneyHidden: true };
  render(<LeavingSections data={{ canEdit: false, interview: null, clearance: { leaving: true, lines: [line], totals: null, open: 1, found: null } }} employeeId="e1" name="Ravi" />);
  fireEvent.click(screen.getByRole('button', { name: /Accounts: Advances/ }));
  await screen.findByText(/Priya or HR signs this line/);
  expect(screen.queryByText('Money')).toBeNull();
  expect(screen.queryByLabelText(/Note/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign off' })).toBeNull();
  expect(screen.queryByText(/For the full and final/)).toBeNull();
});

it('the amount is right-aligned, in tabular figures', async () => {
  const line = { id: 'f', dept: 'FINANCE', deptWord: 'Accounts', label: 'Advances', ownerName: 'Priya', items: [], direction: 'OWES', amount: 4000, note: null, status: 'OPEN', canSign: true, mine: true };
  render(<LeavingSections data={{ canEdit: false, interview: null, clearance: { leaving: true, lines: [line], totals: { owes: 4000, owed: 0 }, open: 1, found: null } }} employeeId="e1" name="Ravi" />);
  fireEvent.click(screen.getByRole('button', { name: /Accounts: Advances/ }));
  expect((await screen.findByLabelText(/Amount/)).className).toMatch(/tabular-nums.*text-right/);
});

it('Payroll down: the clock and the loans say so, not "no settlement"', () => {
  render(<><FinalPayBanner clock={clock({ payrollUnknown: true })} /><LeavingSections data={{ canEdit: true, interview: null, clearance: { leaving: true, lines: [{ id: 'a', dept: 'ADMIN', deptWord: 'Admin', label: 'Keys', items: [], direction: 'NONE', amount: 0, status: 'OPEN', canSign: true }], totals: { owes: 0, owed: 0 }, open: 1, found: { loansUnknown: true } } }} employeeId="e1" name="Ravi" /></>);
  expect(screen.getByText(/Payroll could not be read just now/)).toBeTruthy();
  expect(screen.queryByText(/No settlement in Payroll/)).toBeNull();
  expect(screen.getByText(/loans are not checked/)).toBeTruthy();
});

it('paid by hand on the plan: the banner says so', () => {
  render(<FinalPayBanner clock={clock({ paid: true, paidOnPlan: true })} />);
  expect(screen.getByText('Final pay paid')).toBeTruthy();
  expect(screen.getByText(/Marked paid on the plan/)).toBeTruthy();
});

it('Home with several leavers: one alert with a row each, the rest behind a link', () => {
  const open = vi.fn((id) => () => id);
  const more = vi.fn();
  const rows = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ ...clock({ overdue: i === 0 }), employeeId: n, name: `Person ${n}` }));
  const { container } = render(<FinalPayList rows={rows} onOpen={open} onMore={more} />);
  expect(container.querySelectorAll('.ui-alert')).toHaveLength(1);
  expect(container.querySelector('.ui-alert-neg')).toBeTruthy();
  expect(screen.getByText('Final pay is waiting for 5 leavers')).toBeTruthy();
  expect(screen.getByText('Person C')).toBeTruthy();
  expect(screen.queryByText('Person D')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2 more' }));
  expect(more).toHaveBeenCalled();
});

/* QA on #81 (manager): the Leaving screen is view only for a Team Manager, and its write guard read "Sign off" as an approval. */
const perms = vi.hoisted(() => ({ current: { loading: false, error: null, isAdmin: false, permissions: new Set(['PEOPLE::Employees::VIEW']) } }));
vi.mock('../permissions/usePermissions', () => ({ usePermissions: () => perms.current, default: () => perms.current }));
const { WriteGuard } = await import('../permissions/WriteGuard');

it('on a view-only screen, the owner of a line still ticks, notes, saves and signs it off', async () => {
  api.updateClearanceLine.mockResolvedValue({ line: {} });
  const own = line({ items: [{ title: 'Work handed over', returned: false }] });
  render(<WriteGuard permission="PEOPLE::Employees::VIEW"><LeavingSections data={{ canEdit: false, interview: null, clearance: { leaving: true, lines: [own], totals: { owes: 0, owed: 0 }, open: 1, found: null } }} employeeId="e1" name="Lakshmi" /></WriteGuard>);
  expect(screen.getByText(/View only/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Manager: Handover/ }));
  fireEvent.click(await screen.findByLabelText('Work handed over'));
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Files on the shared drive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.updateClearanceLine).toHaveBeenCalledWith('l1', expect.objectContaining({ items: [{ title: 'Work handed over', returned: true }], note: 'Files on the shared drive' })));
  api.updateClearanceLine.mockClear();
  /* Saved, the drawer closed; opened again, signed. */
  fireEvent.click(await screen.findByRole('button', { name: /Manager: Handover/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign off' }));
  await waitFor(() => expect(api.updateClearanceLine).toHaveBeenCalledWith('l1', expect.objectContaining({ sign: true })));
  expect(dialogs.notify.error).not.toHaveBeenCalled();
});

it('on the same screen, nothing else is let through: an HR-only button is still stopped', () => {
  render(<WriteGuard permission="PEOPLE::Employees::VIEW"><div><button type="button" className="ui-btn ui-btn-primary" onClick={api.addClearanceLine}>Add</button></div><LeavingSections data={{ canEdit: false, interview: null, clearance: { leaving: true, lines: [line()], totals: null, open: 1, found: null } }} employeeId="e1" name="Lakshmi" /></WriteGuard>);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(api.addClearanceLine).not.toHaveBeenCalled();
  expect(dialogs.notify.error).toHaveBeenCalled();
});

it('a line that is not yours reads as words, with no boxes that look tickable', async () => {
  const theirs = line({ id: 'a', dept: 'ADMIN', deptWord: 'Admin', label: 'ID card, keys and access', ownerName: 'Kavya Nair', canSign: false, mine: false, items: [{ title: 'ID card', returned: true }, { title: 'Keys', returned: false }] });
  render(<LeavingSections data={{ canEdit: false, interview: null, clearance: { leaving: true, lines: [theirs], totals: null, open: 1, found: null } }} employeeId="e1" name="Lakshmi" />);
  fireEvent.click(screen.getByRole('button', { name: /Admin: ID card/ }));
  const list = await screen.findByRole('list', { name: 'To hand back' });
  expect(within(list).getByText('Back')).toBeTruthy();
  expect(within(list).getByText('Not back yet')).toBeTruthy();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Sign off' })).toBeNull();
});

it('exit form choices are a thumb’s width on a phone', () => {
  render(<ExitQuestionsForm questions={[{ key: 'reason', kind: 'REASON', text: 'Main reason?', options: [{ code: 'PAY', label: 'Pay' }] }]} answers={{}} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Pay' }).className).toMatch(/\bmin-h-11\b/);
});

/* QA on #81 (HR and owner). */
it('HR, who may edit but not approve, signs a line: the screen guard does not stop "Sign off"', async () => {
  perms.current = { loading: false, error: null, isAdmin: false, permissions: new Set(['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT']) };
  api.updateClearanceLine.mockResolvedValue({ line: {} });
  render(<WriteGuard permission="PEOPLE::Employees::VIEW"><LeavingSections data={{ canEdit: true, interview: null, clearance: { leaving: true, lines: [line({ ownerUserId: null, ownerName: null, mine: false })], totals: null, open: 1, found: null } }} employeeId="e1" name="Vikram" /></WriteGuard>);
  fireEvent.click(screen.getByRole('button', { name: /Manager: Handover/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign off' }));
  await waitFor(() => expect(api.updateClearanceLine).toHaveBeenCalledWith('l1', expect.objectContaining({ sign: true })));
  expect(dialogs.notify.error).not.toHaveBeenCalled();
  perms.current = { loading: false, error: null, isAdmin: false, permissions: new Set(['PEOPLE::Employees::VIEW']) };
});

it('HR picks a line’s owner by name; one the list cannot name still shows a name, never an id', async () => {
  api.orgUsers.mockResolvedValue([{ id: 'u2', fullName: 'Tanvi Shah' }]);
  render(<LeavingSections data={{ canEdit: true, interview: null, clearance: { leaving: true, lines: [line({ ownerUserId: 'cmvv8lxyz', ownerName: 'Kavya Nair' })], totals: null, open: 1, found: null } }} employeeId="e1" name="Vikram" />);
  fireEvent.click(screen.getByRole('button', { name: /Manager: Handover/ }));
  const pick = await screen.findByRole('combobox', { name: 'Whose line' });
  await waitFor(() => expect(pick.textContent).toMatch(/Kavya Nair/));
  expect(document.body.textContent).not.toMatch(/cmvv8lxyz/);
  fireEvent.click(pick);
  expect(await screen.findByRole('option', { name: 'Tanvi Shah' })).toBeTruthy();
});

it('money reads ₹1,250.50, and a total shown alone starts with a capital', () => {
  render(<LeavingSections data={{ canEdit: true, interview: null, clearance: { leaving: true, lines: [line({ direction: 'OWED', amount: 1250.5 })], totals: { owes: 0, owed: 1250.5 }, open: 1, found: null } }} employeeId="e1" name="Vikram" />);
  expect(screen.getByText('Owed to them ₹1,250.50')).toBeTruthy();
  expect(screen.queryByText(/1,250\.5(?!0)/)).toBeNull();
});

it('someone with no employee app access is not said to answer it there', () => {
  const iv = { status: 'OPEN', questions: [], answers: null, canEnter: true, canDecide: true, appAccess: false, purpose: 'The answers help…', dueBy: '2026-11-10' };
  render(<LeavingSections data={{ canEdit: true, interview: iv, clearance: { leaving: true, lines: [], totals: null, open: 0, found: null } }} employeeId="e1" name="Vikram" />);
  expect(screen.getByText(/no employee app access.*Enter the answers from a conversation/)).toBeTruthy();
  expect(screen.queryByText(/answer in the employee app/)).toBeNull();
});

it('Home’s "Open plan" is a thumb’s height on a phone', () => {
  render(<FinalPayList rows={[{ ...clock(), employeeId: 'a', name: 'A' }, { ...clock(), employeeId: 'b', name: 'B' }]} onOpen={() => () => {}} onMore={() => {}} />);
  for (const b of screen.getAllByRole('button', { name: 'Open plan' })) expect(b.className).toMatch(/\bmin-h-11\b/);
});
