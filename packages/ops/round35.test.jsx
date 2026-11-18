import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsNotes: vi.fn() }));
vi.mock('./api', () => api);
const account = vi.hoisted(() => ({ openTicket: vi.fn() }));
vi.mock('@platform/admin/account', () => account);

import { PhoneRule, PinnedNotes } from './PinnedNotes';
import { CallMe, callTicket, phoneOk } from '../../apps/admin/src/screens/CallMe';

describe('round 35: pinned notes on the customer page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows only pinned notes, with who wrote them, and opens the Notes tab', async () => {
    api.opsNotes.mockResolvedValue({
      tags: [],
      notes: [
        { id: 'n1', body: 'Owner prefers WhatsApp, never call before 11.', author: 'Asha', pinned: true, createdAt: '2026-11-12T06:00:00Z' },
        { id: 'n2', body: 'Old note', author: 'Ravi', pinned: false, createdAt: '2026-11-10T06:00:00Z' },
      ],
    });
    const open = vi.fn();
    render(<PinnedNotes id="acc1" onOpen={open} />);
    const box = await screen.findByRole('region', { name: 'Pinned notes' });
    expect(box).toHaveTextContent('Owner prefers WhatsApp');
    expect(box).toHaveTextContent('Asha');
    expect(box).not.toHaveTextContent('Old note');
    fireEvent.click(screen.getByRole('button', { name: 'All notes' }));
    expect(open).toHaveBeenCalled();
  });

  it('shows nothing with no pinned note or when notes fail to load', async () => {
    api.opsNotes.mockResolvedValue({ tags: [], notes: [{ id: 'n2', body: 'x', pinned: false }] });
    const { container, rerender } = render(<PinnedNotes id="acc1" />);
    await waitFor(() => expect(api.opsNotes).toHaveBeenCalledWith('acc1'));
    expect(container).toBeEmptyDOMElement();
    api.opsNotes.mockRejectedValue(new Error('403'));
    rerender(<PinnedNotes id="acc2" />);
    await waitFor(() => expect(api.opsNotes).toHaveBeenCalledWith('acc2'));
    expect(container).toBeEmptyDOMElement();
  });

  it('says changes are never made over the phone', () => {
    render(<PhoneRule />);
    expect(screen.getByRole('note')).toHaveTextContent('do not change an account over the phone');
  });
});

describe('round 35: Call me during setup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts Indian mobile numbers only', () => {
    expect(phoneOk('98450 12345')).toBe(true);
    expect(phoneOk('+91 98450-12345')).toBe(true);
    expect(phoneOk('12345')).toBe(false);
    expect(phoneOk('5845012345')).toBe(false);
  });

  it('opens a support ticket with the number and confirms', async () => {
    account.openTicket.mockResolvedValue({ code: 'T-0042' });
    render(<CallMe />);
    fireEvent.click(screen.getByRole('button', { name: /call me/i }));
    const send = screen.getByRole('button', { name: 'Ask for a call' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Mobile number to call'), { target: { value: '98450 12345' } });
    fireEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('T-0042');
    expect(account.openTicket).toHaveBeenCalledWith(callTicket('9845012345'));
    expect(callTicket('98450 12345').body).toContain('9845012345');
  });
});
