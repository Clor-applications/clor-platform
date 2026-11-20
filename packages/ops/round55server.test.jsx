import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Round 55 server picks in Ops: the handover note and renewals on Home, and a saved reply's help page. */
const api = vi.hoisted(() => ({
  opsHome: vi.fn(),
  opsOverview: vi.fn(),
  opsHealth: vi.fn(),
  opsAudit: vi.fn(),
  opsHandover: vi.fn(),
  opsWriteHandover: vi.fn(),
  opsSavedReplies: vi.fn(),
  opsSaveSavedReply: vi.fn(),
  opsRemoveSavedReply: vi.fn(),
}));
vi.mock('./api', () => api);

import { Home } from './Home';
import { SavedReplies } from './SavedReplies';

beforeEach(() => {
  vi.clearAllMocks();
  api.opsOverview.mockResolvedValue({ accounts: 10, paying: 5, trialsEndingIn7d: 0, legacy: 0 });
  api.opsHealth.mockResolvedValue({ workers: [] });
  api.opsAudit.mockResolvedValue({ events: [] });
  api.opsHome.mockResolvedValue({ work: {} });
});

describe('Ops home', () => {
  it('shows the newest handover note and lets a staff member write the next one', async () => {
    api.opsHandover.mockResolvedValue({ note: { id: 'h1', body: 'Kaveri Foods waits for a call.', at: new Date().toISOString(), by: 'Asha', mine: false } });
    api.opsWriteHandover.mockResolvedValue({ note: { id: 'h2', body: 'Call Kaveri at 4.', at: new Date().toISOString(), by: 'Me', mine: true } });
    render(<Home go={vi.fn()} has={() => true} me={{ role: 'SUPPORT' }} />);
    const section = (await screen.findByRole('heading', { name: 'Handover' })).closest('section');
    expect(await within(section).findByText('Kaveri Foods waits for a call.')).toBeTruthy();
    expect(within(section).getByText(/^Asha ·/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Write a new note' }));
    fireEvent.change(within(section).getByLabelText('Handover note'), { target: { value: 'Call Kaveri at 4.' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.opsWriteHandover).toHaveBeenCalledWith('Call Kaveri at 4.'));
    expect(await within(section).findByText('Call Kaveri at 4.')).toBeTruthy();
    expect(within(section).getByText(/^You ·/)).toBeTruthy();
  });

  it('a read-only staff member reads the note but has no Write button', async () => {
    api.opsHandover.mockResolvedValue({ note: null });
    render(<Home go={vi.fn()} has={() => true} me={{ role: 'READ_ONLY' }} />);
    expect(await screen.findByText('No handover note yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Write a/ })).toBeNull();
  });

  it('lists renewals in the next 30 days with the amount and last activity, each opening the subscription', async () => {
    api.opsHandover.mockResolvedValue({ note: null });
    const renewsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    api.opsHome.mockResolvedValue({ renewalsDue: 1, work: { renewals: { total: 1, items: [{ accountId: 'a1', customer: 'Kaveri Foods', renewsAt, interval: 'month', amount: 99_900, lastActiveAt: null }] } } });
    const go = vi.fn();
    render(<Home go={go} has={() => true} me={{ role: 'SALES' }} />);
    const list = await screen.findByRole('list', { name: 'Renewals in the next 30 days' });
    expect(within(list).getByText('In 5 days')).toBeTruthy();
    expect(within(list).getByText('₹999')).toBeTruthy();
    expect(within(list).getByText(/monthly · nobody has signed in/)).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Kaveri Foods' }));
    expect(go).toHaveBeenCalledWith('customers', {}, 'a1', 'subscription');
  });
});

describe('Saved replies', () => {
  it('saves a help page and shows it as Read more', async () => {
    api.opsSavedReplies.mockResolvedValue({ replies: [{ id: 'r1', title: 'GST guide', body: 'Hi {name}, here is the guide.', app: null, helpUrl: 'https://clor.in/help/gst', usedCount: 2 }] });
    api.opsSaveSavedReply.mockResolvedValue({});
    render(<SavedReplies me={{ role: 'SUPPORT' }} />);
    const link = await screen.findByRole('link', { name: 'clor.in/help/gst' });
    expect(link.getAttribute('href')).toBe('https://clor.in/help/gst');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const field = screen.getByLabelText(/Help page \(optional\)/);
    expect(field.value).toBe('https://clor.in/help/gst');
    fireEvent.change(field, { target: { value: 'https://clor.in/help/gst-returns' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
    await waitFor(() => expect(api.opsSaveSavedReply).toHaveBeenCalledWith('r1', expect.objectContaining({ helpUrl: 'https://clor.in/help/gst-returns' })));
  });
});
