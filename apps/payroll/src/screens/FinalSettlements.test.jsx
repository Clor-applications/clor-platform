import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FinalSettlements from './FinalSettlements';
import { approveSettlement, closeSettlementSources, listSettlements, markSettlementPaid, releaseSettlementHold } from '../api/payrollSettlements';
import { confirmDialog } from '@ui/components/ui/notify';

vi.mock('../api/payrollSettlements', () => ({
  approveSettlement: vi.fn(), cancelSettlement: vi.fn(), closeSettlementSources: vi.fn(), listSettlements: vi.fn(), markSettlementPaid: vi.fn(),
  recalculateSettlement: vi.fn(), releaseSettlementHold: vi.fn(), startSettlement: vi.fn(), updateSettlement: vi.fn(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));
vi.mock('@ui/components/list/DocumentListShell', () => ({
  default: ({ tabs, onStatusChange, above, children }) => (
    <main>
      {tabs.map((t) => <button key={t.value} type="button" onClick={() => onStatusChange(t.value)}>{`Tab ${t.label}`}</button>)}
      {above}
      {children}
    </main>
  ),
}));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, children, actions }) => (open ? <aside aria-label="drawer">{children}{actions}</aside> : null) }));

const lines = [
  { code: 'ADVANCE_A1', label: 'Advance A-1 not settled', kind: 'DEDUCTION', amount: 4000, explanation: 'Site visit: not spent.', source: { type: 'ADVANCE', id: 'a', ref: 'A-1' } },
  { code: 'CLAIM_E1', label: 'Expense claim E-1', kind: 'EARNING', amount: 2000, explanation: 'Client lunch.', source: { type: 'CLAIM', id: 'c', ref: 'E-1' } },
  { code: 'LOAN_L1', label: 'Salary advance L-1 recovery', kind: 'DEDUCTION', amount: 1000, explanation: '', source: { type: 'LOAN', id: 'l', ref: 'L-1' } },
  { code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 0, explanation: '' },
];
const base = { id: 's1', employeeName: 'Ravi Kumar', employeeCode: 'E1', leavingDate: '2026-10-14', dueDate: '2026-10-16', netPayable: -3000, updatedAt: 't', lines, notes: '', overdue: false };
const held = { ...base, status: 'APPROVED', hold: { reason: 'Absconded; laptop not returned', since: '2026-10-20T00:00:00Z' } };

const load = (settlements, waiting = []) => vi.mocked(listSettlements).mockResolvedValue({ settlements, waiting });
const open = async (user) => user.click(await screen.findByText('Ravi Kumar'));

beforeEach(() => vi.clearAllMocks());

it('shows Held in the list, and a held settlement cannot be marked paid', async () => {
  load([held], [{ id: 'p2', name: 'Other Person', dateOfLeaving: '2026-10-01', held: true }]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  expect(screen.getAllByText('Held').length).toBe(2);
  const drawer = screen.getByRole('complementary', { name: 'drawer' });
  expect(within(drawer).getByRole('button', { name: 'Mark paid' })).toBeDisabled();
  expect(within(drawer).getByText('Absconded; laptop not returned')).toBeInTheDocument();
  expect(within(drawer).getByText(/Nothing is forfeited/)).toBeInTheDocument();
  expect(within(drawer).getByText(/Code on Wages 2019, s\.17/)).toBeInTheDocument();
  expect(markSettlementPaid).not.toHaveBeenCalled();
});

it('lifting the hold needs a reason, and then paying is open', async () => {
  load([held]);
  vi.mocked(releaseSettlementHold).mockResolvedValue({ ...held, hold: null });
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  const lift = screen.getByRole('button', { name: 'Lift the hold' });
  expect(lift).toBeDisabled();
  await user.type(screen.getByLabelText('Why is the hold lifted?'), 'Came in to settle, 4 Nov');
  await user.click(lift);
  await waitFor(() => expect(releaseSettlementHold).toHaveBeenCalledWith('s1', 'Came in to settle, 4 Nov'));
  expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Lift the hold' })).toBeNull();
});

it('a settlement with no hold pays as before', async () => {
  load([{ ...base, status: 'APPROVED', hold: null }]);
  vi.mocked(markSettlementPaid).mockResolvedValue({ ...base, status: 'PAID', paidAt: '2026-10-30', hold: null, sourcesClosedAt: 't' });
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  expect(screen.queryByText(/Nothing is forfeited/)).toBeNull();
  /* Asked first (QA of #82, F7): she owes ₹3,000, so it is money received. */
  vi.mocked(confirmDialog).mockResolvedValueOnce(false);
  await user.click(screen.getByRole('button', { name: 'Mark paid' }));
  expect(vi.mocked(confirmDialog).mock.calls.at(-1)[0].title).toMatch(/^Mark ₹3,000(\.00)? received from Ravi Kumar\?$/);
  expect(markSettlementPaid).not.toHaveBeenCalled();
  vi.mocked(confirmDialog).mockResolvedValueOnce(true);
  await user.click(screen.getByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(markSettlementPaid).toHaveBeenCalledWith('s1', null));
});

it('names the source of each line', async () => {
  load([{ ...base, status: 'DRAFT', hold: null }]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  expect(screen.getByText('From: Expense advance in People A-1')).toBeInTheDocument();
  expect(screen.getByText('From: Expense claim in People E-1')).toBeInTheDocument();
  expect(screen.getByText('From: Payroll loan L-1')).toBeInTheDocument();
  expect(screen.getAllByText(/^From:/)).toHaveLength(3);
});

it('the Held tab lists only held ones', async () => {
  load([held, { ...base, id: 's2', employeeName: 'Not Held', status: 'APPROVED', hold: null }]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  expect(await screen.findByText('Not Held')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Tab Held' }));
  expect(screen.queryByText('Not Held')).toBeNull();
  expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
});

it('offers to finish when People did not take the update, and only then', async () => {
  load([{ ...base, status: 'PAID', paidAt: '2026-10-30', hold: null, sourcesClosedAt: null }]);
  vi.mocked(closeSettlementSources).mockResolvedValue({ ...base, status: 'PAID', paidAt: '2026-10-30', hold: null, sourcesClosedAt: 't' });
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  await user.click(screen.getByRole('button', { name: 'Close them now' }));
  await waitFor(() => expect(closeSettlementSources).toHaveBeenCalledWith('s1'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Close them now' })).toBeNull());
});

/* QA of #82 (employee and boundaries). */
const loadAs = (you, settlements, waiting = []) => vi.mocked(listSettlements).mockResolvedValue({ settlements, waiting, you });

it('F3: somebody who may not lift a hold is told why, with no button to press', async () => {
  loadAs({ liftHold: false, liftHoldWhy: 'Lifting a hold needs People edit for all employees (HR) as well as Payroll approval. Ask HR or the owner.', selfEmployeeId: null }, [held]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  const drawer = screen.getByRole('complementary', { name: 'drawer' });
  expect(within(drawer).queryByRole('button', { name: 'Lift the hold' })).toBeNull();
  expect(within(drawer).getByText(/needs People edit/)).toBeInTheDocument();
});

it('F2: your own full and final is shown, never editable or approvable by you', async () => {
  loadAs({ liftHold: true, liftHoldWhy: null, selfEmployeeId: 'me' }, [{ ...base, employeeId: 'me', status: 'DRAFT', hold: null }], [{ id: 'me', name: 'Kavya', dateOfLeaving: '2026-11-20' }]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  const drawer = screen.getByRole('complementary', { name: 'drawer' });
  expect(within(drawer).queryByRole('button', { name: /Approve/ })).toBeNull();
  expect(within(drawer).queryByRole('button', { name: 'Add a line' })).toBeNull();
  expect(within(drawer).queryAllByRole('textbox', { name: 'Item' })).toEqual([]);
  expect(within(drawer).getByText(/This is your own full and final/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Work it out/ })).toBeNull();
});

it('F6: held since the India day, not the UTC one', async () => {
  load([{ ...held, hold: { ...held.hold, since: '2026-10-30T20:20:00Z' } }]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  const drawer = screen.getByRole('complementary', { name: 'drawer' });
  expect(within(drawer).getByRole('heading', { name: /Held since/ }).textContent).toMatch(/31/);
});

/* QA of #82 (owner and HR). */
it('F7: approving a settlement the person owes says so in words', async () => {
  load([{ ...base, status: 'DRAFT', hold: null, netPayable: -11200, employeeName: 'Meena Iyer' }]);
  vi.mocked(confirmDialog).mockResolvedValueOnce(false);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await user.click(await screen.findByText('Meena Iyer'));
  await user.click(within(screen.getByRole('complementary', { name: 'drawer' })).getByRole('button', { name: 'Approve' }));
  const title = vi.mocked(confirmDialog).mock.calls.at(-1)[0].title;
  expect(title).toMatch(/^Meena Iyer owes ₹11,200(\.00)?\. Approve this settlement\?$/);
  expect(title).not.toMatch(/−|-₹/);
  expect(approveSettlement).not.toHaveBeenCalled();
});

it('F8: a held settlement says who may lift it, and that the authenticator is asked', async () => {
  loadAs({ liftHold: true, liftHoldWhy: null, selfEmployeeId: null, stepUp: true }, [held]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  const drawer = screen.getByRole('complementary', { name: 'drawer' });
  expect(within(drawer).getByText(/HR with People edit and Payroll approval, or the owner, lifts it/)).toBeInTheDocument();
  expect(within(drawer).getByText(/authenticator code/)).toBeInTheDocument();
});

it('QA retest: the hold mentions the authenticator code even where the company has not asked for one yet', async () => {
  loadAs({ liftHold: true, liftHoldWhy: null, selfEmployeeId: null, stepUp: false }, [held]);
  const user = userEvent.setup();
  render(<FinalSettlements />);
  await open(user);
  expect(within(screen.getByRole('complementary', { name: 'drawer' })).getByText(/Where the company asks for authenticator codes on payroll, they enter one/)).toBeInTheDocument();
});

describe('the limit on recovering loans and advances (setting 4)', () => {
  const capLines = [
    { code: 'LOAN_L1', label: 'Loan L-1 recovery', kind: 'DEDUCTION', amount: 4000, explanation: '', source: { type: 'LOAN', id: 'l', ref: 'L-1', owed: 6000 }, recover: { due: 6000, wanted: 6000, capped: 2000 } },
    { code: 'ADVANCE_A1', label: 'Advance A-1 not settled', kind: 'DEDUCTION', amount: 0, explanation: '', source: { type: 'ADVANCE', id: 'a', ref: 'A-1', owed: 4000 }, recover: { due: 4000, wanted: 4000, capped: 4000 } },
    { code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount: 50000, explanation: '' },
    { code: 'NOTICE', label: 'Notice pay', kind: 'EARNING', amount: 8000, explanation: '' },
  ];
  const cap = { percent: 50, finalWages: 8000, settlementWages: 8000, slip: null, otherDeductions: 0, limit: 4000, room: 4000, due: 10000, recovered: 4000, heldBack: 6000, owed: 6000 };
  const capped = { ...base, status: 'DRAFT', hold: null, lines: capLines, netPayable: 54000, recoveryCap: cap };
  const row = (drawer, name) => within(drawer).getByText(name).closest('div');

  it('when it binds, shows the limit, what was recovered and what stays owed, in words', async () => {
    load([capped]);
    const user = userEvent.setup();
    render(<FinalSettlements />);
    await open(user);
    const drawer = screen.getByRole('complementary', { name: 'drawer' });
    expect(within(row(drawer, 'Final wages')).getByText('₹8,000')).toBeInTheDocument();
    expect(within(row(drawer, 'Most that can be recovered (50%)')).getByText('₹4,000')).toBeInTheDocument();
    expect(within(row(drawer, 'Recovered here')).getByText('₹4,000')).toBeInTheDocument();
    expect(within(row(drawer, 'Stays owed by Ravi Kumar')).getByText('₹6,000')).toBeInTheDocument();
    expect(within(drawer).getByText(/₹4,000 of ₹6,000 recovered here; ₹2,000 stays owed\. The limit on recovery holds it back\./)).toBeInTheDocument();
    expect(within(drawer).getByText(/₹0 of ₹4,000 recovered here; ₹4,000 stays owed/)).toBeInTheDocument();
    expect(within(drawer).getByText(/not written off: it stays on the loan or advance, shown in People/)).toBeInTheDocument();
    expect(within(drawer).getByText(/gratuity and reimbursements never count/)).toBeInTheDocument();
    /* No payslip for the leaving month yet: said, with what to do. */
    expect(within(drawer).getByText(/days worked counts once the leaving month's payroll is approved/)).toBeInTheDocument();
  });

  it('when it does not bind, says nothing is left owed and names the payslip counted', async () => {
    const full = capLines.map((l) => (l.recover ? { ...l, amount: l.recover.due, recover: { ...l.recover, capped: 0 } } : l));
    load([{ ...capped, lines: full, recoveryCap: { ...cap, slip: { wages: 14000, deducted: 0, ref: 'PS-10', periodName: 'October' }, finalWages: 22000, limit: 11000, recovered: 10000, heldBack: 0, owed: 0 } }]);
    const user = userEvent.setup();
    render(<FinalSettlements />);
    await open(user);
    const drawer = screen.getByRole('complementary', { name: 'drawer' });
    expect(within(drawer).getByText(/Nothing is left owed/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Days worked ₹14,000 \(payslip PS-10\)/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/stays owed\./)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/payroll is approved/)).not.toBeInTheDocument();
  });

  it('once paid, it still shows what stays owed, without asking to work it out again', async () => {
    load([{ ...capped, status: 'PAID', paidAt: '2026-10-20T00:00:00Z', sourcesClosedAt: 't' }]);
    const user = userEvent.setup();
    render(<FinalSettlements />);
    await open(user);
    const drawer = screen.getByRole('complementary', { name: 'drawer' });
    expect(within(row(drawer, 'Stays owed by Ravi Kumar')).getByText('₹6,000')).toBeInTheDocument();
    expect(within(drawer).queryByText(/Work it out again then/)).not.toBeInTheDocument();
  });

  it('a draft made before the limit says how to apply it; a paid one says nothing', async () => {
    load([{ ...capped, recoveryCap: null }]);
    const user = userEvent.setup();
    const { unmount } = render(<FinalSettlements />);
    await open(user);
    expect(screen.getByText(/Save it or work it out again to apply the limit/)).toBeInTheDocument();
    unmount();
    load([{ ...capped, status: 'PAID', paidAt: '2026-10-20T00:00:00Z', sourcesClosedAt: 't', recoveryCap: null }]);
    render(<FinalSettlements />);
    await open(user);
    expect(screen.queryByText(/Worked out before loans and advances/)).not.toBeInTheDocument();
  });
});
