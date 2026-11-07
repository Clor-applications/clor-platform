import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Accounting → Settings → Email keeps its Notifications tab after automations
 * B5 moved the list into a component it shares with Workspace.
 */
const api = vi.hoisted(() => ({
  getEmailSettings: vi.fn(), getNotifications: vi.fn(), saveNotifications: vi.fn(), getOutbox: vi.fn(),
}));
vi.mock('../../api/email', () => ({
  getEmailSettings: () => api.getEmailSettings(),
  getNotifications: () => api.getNotifications(),
  saveNotifications: (e) => api.saveNotifications(e),
  getOutbox: () => api.getOutbox(),
  retryOutbox: vi.fn(), saveEmailSettings: vi.fn(), sendTestEmail: vi.fn(), testEmailConnection: vi.fn(),
}));
vi.mock('@ui/chrome/SettingsScreenHeader', () => ({ default: ({ title, actions }) => <header><h1>{title}</h1>{actions}</header> }));

const { EmailSettings } = await import('./EmailSettings');

beforeEach(() => {
  api.getEmailSettings.mockReset().mockResolvedValue({ settings: { provider: 'SYSTEM' } });
  api.getNotifications.mockReset().mockResolvedValue({
    events: [
      { key: 'invoice.sent', label: 'Invoice to customer', description: 'On request.', enabled: true },
      { key: 'people.joined', label: 'Somebody joined', description: 'To HR.', enabled: true },
    ],
  });
  api.saveNotifications.mockReset().mockResolvedValue({ ok: true });
  api.getOutbox.mockReset().mockResolvedValue({ messages: [] });
});

describe('notifications tab', () => {
  it('lists the emails by app and saves a switch', async () => {
    render(<EmailSettings />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Notifications' }));
    const accounting = screen.getByRole('region', { name: 'Accounting' });
    expect(screen.getByRole('region', { name: 'People' })).toBeInTheDocument();
    fireEvent.click(within(accounting).getByRole('checkbox', { name: /Invoice to customer/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() =>
      expect(api.saveNotifications).toHaveBeenCalledWith([
        { eventKey: 'invoice.sent', enabled: false },
        { eventKey: 'people.joined', enabled: true },
      ])
    );
  });
});
