import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Attendance's Today: one line pointing whoever looks after the plan to Workspace, Billing, when People is not on it. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
const opened = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/context', () => ({ requestOpenApp: (...a) => opened.call(...a) }));

import MoveToPeople from './MoveToPeople';

describe('the move to People line', () => {
  it('opens Workspace, Billing, and stays hidden once dismissed', async () => {
    window.localStorage.clear();
    fetches.call.mockResolvedValue({ ownedApps: ['attendance'], mayChangePlan: true });
    const { unmount } = render(<MoveToPeople />);
    fireEvent.click(await screen.findByRole('button', { name: 'See moving to People' }));
    expect(opened.call).toHaveBeenCalledWith('admin', 'billing');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Growing\?/)).toBeNull();
    unmount();
    fetches.call.mockClear();
    render(<MoveToPeople />);
    expect(fetches.call).not.toHaveBeenCalled();
  });

  it('says nothing when People is on, or to someone who cannot change the plan', async () => {
    window.localStorage.clear();
    fetches.call.mockResolvedValue({ ownedApps: ['attendance', 'people'], mayChangePlan: true });
    const a = render(<MoveToPeople />);
    await waitFor(() => expect(fetches.call).toHaveBeenCalled());
    expect(a.container.textContent).toBe('');
    a.unmount();
    fetches.call.mockResolvedValue({ ownedApps: ['attendance'], mayChangePlan: false });
    const b = render(<MoveToPeople />);
    await waitFor(() => expect(fetches.call).toHaveBeenCalledTimes(2));
    expect(b.container.textContent).toBe('');
  });
});
