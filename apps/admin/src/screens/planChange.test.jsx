import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Platform audit, 11 Nov 2026: Workspace, Billing lets the customer ask to move to People, ask for other changes, and stop renewing. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast }));

import PlanChange from './PlanChange';

const attendance = (extra = {}) => ({
  ownedApps: ['attendance'], mayChangePlan: true, mayStopPlan: true,
  subscription: { status: 'active', currentPeriodEnd: '2026-12-10T00:00:00Z', cancelAtPeriodEnd: false }, ...extra,
});

describe('changing the plan', () => {
  it('an Attendance customer asks to move to People; it goes to sales as a ticket', async () => {
    fetches.call.mockImplementation(async (path) => (path === '/billing/subscription' ? attendance() : { ticket: { code: 'T-42' } }));
    render(<PlanChange />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to People' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '60 employees' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to CLOR' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('T-42')));
    const sent = fetches.call.mock.calls.find(([p]) => p === '/billing/plan-change');
    expect(sent[1].body).toEqual({ kind: 'UPGRADE_PEOPLE', app: null, note: '60 employees' });
  });

  it('the owner stops renewing, with a reason, and can keep the plan after', async () => {
    let stopped = false;
    fetches.call.mockImplementation(async (path) => {
      if (path === '/billing/cancel') stopped = true;
      if (path === '/billing/resume') stopped = false;
      return attendance({ subscription: { status: 'active', currentPeriodEnd: '2026-12-10T00:00:00Z', cancelAtPeriodEnd: stopped } });
    });
    render(<PlanChange />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop renewing' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Too costly' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop renewing' }));
    expect(await screen.findByText(/will not renew; it stops on 10 Dec 2026/)).toBeTruthy();
    expect(fetches.call.mock.calls.find(([p]) => p === '/billing/cancel')[1].body).toEqual({ reason: 'Too costly' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the plan' }));
    expect(await screen.findByRole('button', { name: 'Stop renewing' })).toBeTruthy();
  });

  it('shows nothing to someone who may neither ask nor stop, and no move to People when People is on', async () => {
    fetches.call.mockResolvedValue(attendance({ mayChangePlan: false, mayStopPlan: false }));
    const { container } = render(<PlanChange />);
    await waitFor(() => expect(fetches.call).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    fetches.call.mockResolvedValue(attendance({ ownedApps: ['people', 'attendance'] }));
    render(<PlanChange />);
    expect(await screen.findByRole('button', { name: 'Ask for another change' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move to People' })).toBeNull();
  });
});
