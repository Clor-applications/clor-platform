import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appliedBeforeText, copyOf, earlierApplications, lastYearGoals, monthYear, nextYear, weightNote, weightTotal } from './round53';
import { AppliedBefore, CopyLastYear, WeightTotal } from './round53Parts';

const api = vi.hoisted(() => ({ listCandidates: vi.fn(), listGoals: vi.fn(), createGoal: vi.fn() }));
const ui = vi.hoisted(() => ({ confirmDialog: vi.fn(), notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../api/talent', () => api);
vi.mock('@ui/components/ui/notify', () => ui);
vi.mock('./shared', () => ({ todayIst: () => '2026-11-18' }));
beforeEach(() => vi.clearAllMocks());

describe('dupcandidate A: applied before', () => {
  const now = { id: 'c2', email: 'Asha@Example.com', phone: '+91 98450 12345', createdAt: '2026-11-10T05:00:00Z' };
  const rows = [
    now,
    { id: 'c1', email: 'asha@example.com', openingTitle: 'Sales Executive', createdAt: '2026-03-12T05:00:00Z' },
    { id: 'c0', email: null, phone: '9845012345', openingTitle: 'Cashier', createdAt: '2025-06-01T05:00:00Z' },
    { id: 'cx', email: 'other@example.com', openingTitle: 'Driver', createdAt: '2026-01-01T05:00:00Z' },
    { id: 'c9', email: 'asha@example.com', openingTitle: 'Later job', createdAt: '2026-11-15T05:00:00Z' },
  ];
  it('matches on e-mail or the last ten phone digits, earlier ones only, newest first', () => {
    expect(earlierApplications(now, rows).map((r) => r.id)).toEqual(['c1', 'c0']);
  });
  it('says where and when, and how many more', () => {
    expect(monthYear('2026-03-12T05:00:00Z')).toBe('Mar 2026');
    expect(appliedBeforeText(earlierApplications(now, rows))).toBe('Applied before for Sales Executive in Mar 2026, and 1 more time.');
    expect(appliedBeforeText([])).toBe('');
  });
  it('no e-mail and no full phone matches nothing', () => {
    expect(earlierApplications({ id: 'z', phone: '123' }, rows)).toEqual([]);
  });
  it('shows the line to HR and asks nothing for others', async () => {
    api.listCandidates.mockResolvedValue({ rows });
    const { unmount } = render(<AppliedBefore candidate={now} hr />);
    expect(await screen.findByText('Applied before for Sales Executive in Mar 2026, and 1 more time.')).toBeTruthy();
    expect(api.listCandidates).toHaveBeenCalledWith({ q: now.email, stage: 'all', limit: 50 });
    unmount();
    api.listCandidates.mockClear();
    render(<AppliedBefore candidate={{ ...now, email: null, phone: null }} hr={false} />);
    await waitFor(() => expect(screen.queryByTestId('applied-before')).toBeNull());
    expect(api.listCandidates).not.toHaveBeenCalled();
  });
});

describe('goalweight A: weights add to 100%', () => {
  const goals = [
    { id: 'g1', employeeId: 'e1', status: 'ACTIVE', weight: 40 },
    { id: 'g2', employeeId: 'e1', status: 'ACTIVE', weight: 30 },
    { id: 'g3', employeeId: 'e1', status: 'DONE', weight: 50 },
    { id: 'g4', employeeId: 'e2', status: 'ACTIVE', weight: 90 },
  ];
  it('counts the person’s active goals, the edited one once at its new weight', () => {
    expect(weightTotal(goals, 'e1', { weight: '30' })).toBe(100);
    expect(weightTotal(goals, 'e1', { exceptId: 'g2', weight: '10' })).toBe(50);
    expect(weightTotal(goals, 'e1')).toBe(70);
  });
  it('says what is left or how far over', () => {
    expect(weightNote(100)).toBe('Their active goals add to 100%.');
    expect(weightNote(70)).toMatch(/30% is still to give/);
    expect(weightNote(120)).toMatch(/20% over 100%/);
  });
  it('reads the person’s active goals and writes the total under the field', async () => {
    api.listGoals.mockResolvedValue({ goals });
    render(<WeightTotal employeeId="e1" weight="40" />);
    expect((await screen.findByTestId('weight-total')).textContent).toMatch(/110%.*10% over 100%/);
    expect(api.listGoals).toHaveBeenCalledWith({ status: 'ACTIVE', employeeId: 'e1' });
  });
});

describe('goalcopy A: copy last year’s goals', () => {
  const goals = [
    { id: 'a', employeeId: 'e1', status: 'DONE', title: 'Close books monthly', measure: 'By day 5', dueDate: '2025-12-31T00:00:00.000Z', weight: 40, description: null },
    { id: 'b', employeeId: 'e1', status: 'DONE', title: 'Leap goal', dueDate: '2024-02-29', weight: null },
    { id: 'c', employeeId: 'e1', status: 'DROPPED', title: 'Dropped one', dueDate: '2025-06-30' },
    { id: 'd', employeeId: 'e1', status: 'DONE', title: 'Already again', dueDate: '2025-05-01' },
    { id: 'e', employeeId: 'e1', status: 'ACTIVE', title: 'already again', dueDate: '2026-05-01' },
    { id: 'f', employeeId: 'e1', status: 'DONE', title: 'Undated', dueDate: null, createdAt: '2025-02-01T00:00:00Z' },
  ];
  it('takes finished goals from last year not already set again', () => {
    expect(lastYearGoals(goals, '2026-11-18').map((g) => g.id)).toEqual(['a', 'f']);
  });
  it('moves the date a year on, 29 Feb to 28 Feb, and drops a date already past', () => {
    expect(nextYear('2024-02-29')).toBe('2025-02-28');
    expect(copyOf(goals[0], '2026-11-18')).toEqual({ employeeId: 'e1', title: 'Close books monthly', measure: 'By day 5', dueDate: '2026-12-31', weight: 40, description: null });
    expect(copyOf({ ...goals[0], dueDate: '2025-03-31' }, '2026-11-18').dueDate).toBeNull();
  });
  it('asks, then creates each copy and reloads', async () => {
    api.listGoals.mockResolvedValue({ goals });
    api.createGoal.mockResolvedValue({ id: 'n' });
    ui.confirmDialog.mockResolvedValue(true);
    const onDone = vi.fn();
    render(<CopyLastYear employeeId="e1" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy last year’s goals' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(ui.confirmDialog.mock.calls[0][0].title).toBe('Copy 2 goals from last year?');
    expect(api.createGoal).toHaveBeenCalledTimes(2);
    expect(ui.notify.success).toHaveBeenCalledWith('2 goals copied.');
  });
  it('says so when there is nothing to copy', async () => {
    api.listGoals.mockResolvedValue({ goals: [] });
    render(<CopyLastYear employeeId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy last year’s goals' }));
    await waitFor(() => expect(ui.notify.info).toHaveBeenCalledWith('No finished goals from last year to copy.'));
    expect(api.createGoal).not.toHaveBeenCalled();
  });
});
