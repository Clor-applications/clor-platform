import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

/* Round 55 (snooze A): "Remind me tomorrow" takes a notice off the bell at once; the server brings it back at 9 AM. */
const bellApi = vi.hoisted(() => ({
  getInbox: vi.fn(async () => ({ unread: 1, notifications: [{ id: 'n1', kind: 'people.approval', title: 'Waiting for you: Selvi leave', body: null, createdAt: new Date().toISOString(), readAt: null }] })),
  markRead: vi.fn(async () => ({})),
  markAllRead: vi.fn(async () => ({})),
  getMutes: vi.fn(async () => []),
  setMute: vi.fn(async () => []),
  snoozeNotice: vi.fn(async () => ({ unread: 0 })),
}));
vi.mock('@ui/api/notifications', () => bellApi);

import NotificationBell from './NotificationBell';

it('Remind me tomorrow takes the notice off the list and asks the server to bring it back', async () => {
  render(<NotificationBell tenantKey="t1" onOpen={() => {}} />);
  await waitFor(() => expect(bellApi.getInbox).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
  const snooze = await screen.findByRole('button', { name: 'Remind me tomorrow: Waiting for you: Selvi leave' });
  bellApi.getInbox.mockResolvedValue({ unread: 0, notifications: [] });
  fireEvent.click(snooze);
  expect(bellApi.snoozeNotice).toHaveBeenCalledWith('n1');
  await waitFor(() => expect(screen.queryByText('Waiting for you: Selvi leave')).toBeNull());
});
