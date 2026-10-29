import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Joining & Leaving (docs/people/design-v1/JOINING-LEAVING-DECISIONS.md):
 * the overview's counts open their lists; the task queue asks the server for
 * one page of a view; a step that needs a note will not close without one;
 * CLOR's own reader step cannot be ticked while it waits; Leaving shows the
 * readers and final wages in words; the steps editor keeps working days, the
 * note rule and who a step is for.
 */
const api = vi.hoisted(() => ({
  lifecycleOverview: vi.fn(),
  pageTasks: vi.fn(),
  pageLeavers: vi.fn(),
  pageJoiners: vi.fn(),
  updateTask: vi.fn(() => Promise.resolve({})),
  getSteps: vi.fn(),
  saveSteps: vi.fn((kind, items) => Promise.resolve({ items, custom: true })),
  employeeTypes: vi.fn(() => Promise.resolve([{ id: 'perm', name: 'Permanent' }, { id: 'con', name: 'Contractor' }])),
  orgUsers: vi.fn(() => Promise.resolve([{ id: 'u1', fullName: 'Asha HR' }])),
  leavingPreview: vi.fn(() => Promise.resolve({ reports: [], nextManager: null, assets: [] })),
}));
vi.mock('../packages/ui/src/lifecycle/api', async (orig) => ({ ...(await orig()), ...api }));
vi.mock('../packages/ui/src/personnel/api', async (orig) => ({ ...(await orig()), getChecklist: vi.fn(() => Promise.resolve({ joining: { tasks: [], done: 0, total: 0 }, leaving: { tasks: [], done: 0, total: 0 } })) }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: true, permissions: new Set() }) }));

const task = (over = {}) => ({
  id: 't1', kind: 'LEAVING', title: 'Final wages paid', owner: 'PAYROLL', ownerWord: 'Payroll', ownerUserId: 'u1', ownerName: 'Asha HR',
  dueDate: '2026-11-04', workingDays: true, late: false, done: false, doneAt: null, doneBy: '', note: null, needsNote: true, system: null, systemState: null, ownPlan: false,
  employee: { id: 'e1', name: 'Ravi Kumar', code: 'R-1' }, ...over,
});

describe('Joining & Leaving', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockClear?.());
    api.lifecycleOverview.mockResolvedValue({
      counts: { startingThisWeek: 2, lastDaysThisWeek: 1, lateTasks: 3, myTasks: 1, readersNotConfirmed: 1, readersFailed: 1, wagesDue: 0, wagesLate: 1, plansMissing: 0, probationDue: 0, contractsEnding: 0 },
      late: [task({ late: true, title: 'Collect ID proof', kind: 'JOINING' })],
      comingUp: [{ kind: 'JOINING', date: '2026-11-02', employee: { id: 'e2', name: 'Meera K' }, what: 'Joins as Accountant', detail: 'Preparing' }],
      today: '2026-10-27',
    });
    api.pageTasks.mockResolvedValue({ rows: [task()], total: 1, counts: { mine: 1, late: 0, nobody: 2, open: 5, done: 0 }, mineOnly: false });
  });

  it('overview: the counts say what is wrong and each opens its list', async () => {
    const { default: Overview } = await import('../packages/ui/src/lifecycle/Overview');
    const openScreen = vi.fn();
    const user = userEvent.setup();
    render(<Overview openScreen={openScreen} />);
    expect(await screen.findByRole('button', { name: '1 Readers not confirmed: open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 Final wages late: open' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2 Starting this week: open' }));
    expect(openScreen).toHaveBeenCalledWith('joiners', { view: 'week' });
    expect(screen.getByText('Meera K')).toBeInTheDocument();
    expect(screen.getByText('Collect ID proof')).toBeInTheDocument();
  });

  it('tasks: asks for one page of a view, and a step that needs a note will not close without one', async () => {
    const { default: Tasks } = await import('../packages/ui/src/lifecycle/Tasks');
    const user = userEvent.setup();
    render(<Tasks params={{ view: 'open' }} updateParams={() => {}} />);
    await screen.findAllByText('Final wages paid');
    expect(api.pageTasks).toHaveBeenCalledWith(expect.objectContaining({ view: 'open', limit: 25, offset: 0 }));
    expect(screen.getByRole('tab', { name: /Nobody/ })).toHaveTextContent('2');
    await user.click(screen.getAllByText('Final wages paid')[0]);
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Mark done' }));
    expect(await within(drawer).findByText('Add a note, for example the payment reference.')).toBeInTheDocument();
    expect(api.updateTask).not.toHaveBeenCalled();
    await user.type(within(drawer).getByLabelText(/Note/), 'UTR 99812');
    await user.click(within(drawer).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('t1', { done: true, note: 'UTR 99812' }));
  });

  it('tasks: the reader step cannot be ticked while it waits for the readers', async () => {
    api.pageTasks.mockResolvedValueOnce({ rows: [task({ id: 't2', title: 'Readers and app access removed', needsNote: false, system: 'READERS', systemState: 'WAITING', owner: 'HR', ownerWord: 'HR' })], total: 1, counts: { open: 1 }, mineOnly: false });
    const { default: Tasks } = await import('../packages/ui/src/lifecycle/Tasks');
    const user = userEvent.setup();
    render(<Tasks params={{ view: 'open' }} updateParams={() => {}} />);
    await screen.findAllByText('Waiting for readers');
    await user.click(screen.getAllByText('Readers and app access removed')[0]);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Waiting for every reader to confirm.')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  });

  it('tasks: someone without the Employees right sees only Mine and Done', async () => {
    api.pageTasks.mockResolvedValueOnce({ rows: [], total: 0, counts: { mine: 0, done: 0 }, mineOnly: true });
    const { default: Tasks } = await import('../packages/ui/src/lifecycle/Tasks');
    render(<Tasks params={{}} updateParams={() => {}} />);
    expect(await screen.findByText('Nothing on your name')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Nobody/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Done/ })).toBeInTheDocument();
  });

  it('leaving: readers, final wages and the sign-in in words; the reason only when the server sends it', async () => {
    api.pageLeavers.mockResolvedValue({
      rows: [
        { id: 'e1', name: 'Ravi Kumar', code: 'R-1', dateOfLeaving: '2026-10-24', status: 'LEFT', stage: 'CLEARING', stageLabel: 'Clearing', done: 4, total: 8, late: 1, readers: { state: 'FAILED', word: 'Not confirmed' }, wages: { dueDate: '2026-10-28', paid: false, late: true }, signIn: { open: true } },
        { id: 'e2', name: 'Sara Ali', code: 'R-2', dateOfLeaving: '2026-11-20', status: 'ON_NOTICE', stage: 'NOTICE', stageLabel: 'On notice', done: 1, total: 8, late: 0, readers: { state: 'PENDING', word: 'On the last day' }, wages: { dueDate: '2026-11-24', paid: false, late: false }, signIn: null },
      ],
      total: 2, counts: { notice: 1, clearing: 1 },
    });
    const { default: Leaving } = await import('../packages/ui/src/lifecycle/Leaving');
    render(<Leaving params={{ view: 'all' }} updateParams={() => {}} />);
    await screen.findAllByText('Ravi Kumar');
    expect(screen.getAllByText('Not confirmed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Late since/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Still on').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Resigned|Employment ended/)).not.toBeInTheDocument();
  });

  it('steps: keeps working days, the note rule and who a step is for', async () => {
    api.getSteps.mockResolvedValue({ joining: { custom: false, items: [{ title: 'Collect PAN', owner: 'HR', dueDays: 0 }] }, leaving: { custom: false, items: [{ title: 'Readers and app access removed', owner: 'HR', dueDays: 0, system: 'READERS' }, { title: 'Final wages paid', owner: 'PAYROLL', dueDays: 2, workingDays: true, needsNote: true }] } });
    const { default: Steps } = await import('../packages/ui/src/lifecycle/Steps');
    const user = userEvent.setup();
    render(<Steps />);
    await user.click(await screen.findByRole('tab', { name: 'Leaving' }));
    expect(await screen.findByText(/CLOR does this on the last day/)).toBeInTheDocument();
    const reader = screen.getByDisplayValue('Readers and app access removed');
    expect(reader).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Joining' }));
    await user.click(await screen.findByRole('checkbox', { name: /Needs a note/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveSteps).toHaveBeenCalledWith('JOINING', [expect.objectContaining({ title: 'Collect PAN', needsNote: true })]));
  });
});
