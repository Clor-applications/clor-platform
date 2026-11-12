import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Data health, full days paid short (fullDayFix.ts, review of PR #141):
 * "Paid the difference" asks first, with an optional note sent to the
 * server, and can be undone straight after.
 */
const api = vi.hoisted(() => ({
  getDataHealth: vi.fn(),
  getHeadcount: vi.fn(async () => null),
  markFullDaysPaid: vi.fn(async () => ({ settled: 2 })),
  unmarkFullDaysPaid: vi.fn(async () => ({ undone: 2 })),
  snoozeHealthCheck: vi.fn(),
  unsnoozeHealthCheck: vi.fn(),
}));
vi.mock('../packages/ui/src/personnel/api', () => api);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import DataHealth from '../packages/ui/src/personnel/DataHealth';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const held = {
  people: 3,
  blocking: 0,
  checks: [
    {
      id: 'full-day-held-paid', area: 'Payroll', severity: 'FIX_SOON', title: 'Worked the shift, paid short', why: 'Why.', fix: 'Pay each day as an adjustment.', screen: 'adjustments', count: 1,
      people: [{ id: 'e1', name: 'Ravi', code: 'E1', detail: '9 Sep 2026 half day → present; 16 Sep 2026 half day → present', settle: ['r1', 'r2'] }],
    },
  ],
  snoozed: [],
};

describe('Data health: paid the difference', () => {
  it('asks first, sends the note, and can be undone', async () => {
    api.getDataHealth.mockResolvedValue(held);
    render(<DataHealth app="people" />);
    await userEvent.click(await screen.findByRole('button', { name: /paid the difference to ravi/i }));
    expect(api.markFullDaysPaid).not.toHaveBeenCalled();
    expect(await screen.findByText(/9 Sep 2026 half day → present/, { selector: 'p' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'Paid in October');
    api.getDataHealth.mockResolvedValue({ ...held, checks: [] });
    await userEvent.click(screen.getByRole('button', { name: /mark 2 days paid/i }));
    await waitFor(() => expect(api.markFullDaysPaid).toHaveBeenCalledWith(['r1', 'r2'], 'Paid in October'));
    expect(await screen.findByRole('status')).toHaveTextContent(/2 days for Ravi marked paid/);
    api.getDataHealth.mockResolvedValue(held);
    await userEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    await waitFor(() => expect(api.unmarkFullDaysPaid).toHaveBeenCalledWith(['r1', 'r2']));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('cancel sends nothing; an empty note goes as none', async () => {
    api.getDataHealth.mockResolvedValue(held);
    render(<DataHealth app="people" />);
    await userEvent.click(await screen.findByRole('button', { name: /paid the difference to ravi/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(api.markFullDaysPaid).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /paid the difference to ravi/i }));
    await userEvent.click(screen.getByRole('button', { name: /mark 2 days paid/i }));
    await waitFor(() => expect(api.markFullDaysPaid).toHaveBeenCalledWith(['r1', 'r2'], null));
  });
});
