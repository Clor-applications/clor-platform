import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Employee app → Me → "Before your last day" (JOINING-LEAVING-DECISIONS.md):
 * the person's own steps, ticked there (a note first when the step needs
 * one), and the things they hand back, which HR or IT tick.
 */
const api = vi.hoisted(() => ({
  getJourney: vi.fn(async () => ({
    joining: [],
    leaving: [
      { id: 's1', title: 'Write handover notes', dueDate: '2026-11-13', done: false, mine: true, needsNote: true },
      { id: 'r1', title: 'Return Laptop (LT-12)', dueDate: '2026-11-16', done: false, mine: false, needsNote: false },
    ],
    handBack: [{ id: 'r1', title: 'Return Laptop (LT-12)', dueDate: '2026-11-16', done: false, mine: false, needsNote: false }],
  })),
  doneJourneyTask: vi.fn(async () => ({ done: true })),
}));
vi.mock('../apps/attendance/src/portal/portalApi', async (orig) => ({ ...(await orig()), ...api }));

describe('My steps in the employee app', () => {
  it('ticks only the person’s own step, asking for a note first; hand-back items have no button', async () => {
    const { MySteps } = await import('../apps/attendance/src/portal/MeExtras');
    const user = userEvent.setup();
    render(<MySteps guard={(p) => p} refreshKey={0} />);
    expect(await screen.findByText('Before your last day')).toBeInTheDocument();
    expect(screen.getByText(/HR or IT marks it when they have it/)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Add a note to close this.')).toBeInTheDocument();
    expect(api.doneJourneyTask).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Note for Write handover notes'), 'Shared drive /handover');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.doneJourneyTask).toHaveBeenCalledWith('s1', 'Shared drive /handover'));
  });
});
