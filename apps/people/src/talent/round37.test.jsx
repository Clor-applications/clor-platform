import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { oneDueDate, showSideBySide, withOneDueDate } from './round37';
import TrainingsDue, { trainingsDue } from '../../../attendance/src/portal/TrainingsDue';

vi.mock('../../../attendance/src/portal/portalApi', () => ({
  getGrowth: vi.fn(async () => ({ on: true, trainings: [
    { id: 't1', title: 'Food Safety Basics', status: 'ASSIGNED', startDate: '2026-12-01' },
    { id: 't2', title: 'Fire drill', status: 'COMPLETED', completedOn: '2026-10-01' },
  ] })),
}));

describe('round 37: one review due date', () => {
  it('reads one date when both match or only one is set, null when they differ', () => {
    expect(oneDueDate({ selfDue: '2026-04-30', managerDue: '2026-04-30T00:00:00Z' })).toBe('2026-04-30');
    expect(oneDueDate({ selfDue: null, managerDue: '2026-04-30' })).toBe('2026-04-30');
    expect(oneDueDate({})).toBe('');
    expect(oneDueDate({ selfDue: '2026-04-10', managerDue: '2026-04-20' })).toBeNull();
  });
  it('sends the one date as both fields', () => {
    expect(withOneDueDate({ name: 'A', dueBy: '2026-04-30' })).toEqual({ name: 'A', selfDue: '2026-04-30', managerDue: '2026-04-30' });
    expect(withOneDueDate({ name: 'A', dueBy: '' })).toEqual({ name: 'A', selfDue: null, managerDue: null });
  });
});

describe('round 37: side by side', () => {
  it('only when neither review can still be written', () => {
    expect(showSideBySide({ canSelf: false, canManager: false })).toBe(true);
    expect(showSideBySide({ canSelf: true, canManager: false })).toBe(false);
    expect(showSideBySide({ canSelf: false, canManager: true })).toBe(false);
  });
});

describe('round 37: trainings to finish', () => {
  it('keeps assigned, unfinished trainings, earliest first', () => {
    const out = trainingsDue([
      { id: 'a', status: 'ASSIGNED', startDate: '2026-12-05' },
      { id: 'b', status: 'MISSED' },
      { id: 'c', status: 'ASSIGNED', startDate: '2026-11-20' },
      { id: 'd', status: 'ASSIGNED' },
      { id: 'e', status: 'COMPLETED', completedOn: '2026-11-01' },
    ]);
    expect(out.map((t) => t.id)).toEqual(['c', 'a', 'd']);
  });
  it('shows the card on Today until the training is completed', async () => {
    render(<TrainingsDue guard={(p) => p} />);
    await waitFor(() => expect(screen.getByText('A training to finish')).toBeTruthy());
    expect(screen.getByText('Food Safety Basics')).toBeTruthy();
    expect(screen.queryByText('Fire drill')).toBeNull();
  });
});
