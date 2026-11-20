import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Round 67 "whatsnew": a dot on Help while a release note is unread; opening What's new lists the notes and marks them read. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));

import HelpMenu from './HelpMenu';

describe('What’s new under Help', () => {
  it('shows a dot until the notes are opened, then marks them read', async () => {
    fetches.call.mockImplementation(async (path) => {
      if (path === '/announcements/whats-new') return { notes: [{ id: 'n1', title: 'Proformas in Billing', body: 'Get a proforma with GST from Billing.', on: '2026-11-18T06:00:00Z', seen: false }], unseen: 1 };
      return {};
    });
    render(<HelpMenu />);
    const trigger = await screen.findByRole('button', { name: 'Help and support, something new to read' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: /What’s new/ }));
    expect(await screen.findByText('Proformas in Billing')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    await waitFor(() => expect(fetches.call).toHaveBeenCalledWith('/announcements/whats-new/seen', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByRole('button', { name: 'Help and support' })).toBeTruthy();
  });

  it('is not in Books', async () => {
    document.documentElement.dataset.palette = 'indigo';
    fetches.call.mockClear();
    render(<HelpMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Help and support' }));
    expect(screen.queryByRole('menuitem', { name: /What’s new/ })).toBeNull();
    expect(fetches.call).not.toHaveBeenCalledWith('/announcements/whats-new');
    delete document.documentElement.dataset.palette;
  });
});
