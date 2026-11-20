import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsNotes: vi.fn(), opsTags: vi.fn(), opsAddNote: vi.fn(), opsAddTag: vi.fn(), opsChangeNote: vi.fn(), opsRemoveNote: vi.fn(), opsRemoveTag: vi.fn() }));
vi.mock('./api', () => api);
const ask = vi.hoisted(() => vi.fn());
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: (...a) => ask(...a) }));

import { CustomerNotes } from './CustomerNotes';

const note = { id: 'n1', author: 'Asha Rao', mine: false, mayChange: true, pinned: false, body: 'Called the owner: e-invoice password was wrong.', createdAt: '2026-11-10T05:00:00Z' };
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  ask.mockReset();
  api.opsTags.mockResolvedValue({ tags: [] });
  api.opsNotes.mockResolvedValue({ tags: [], notes: [note] });
  api.opsRemoveNote.mockResolvedValue({});
});

describe('Customer notes', () => {
  it('asks before removing a note, quoting it, and removes it only on yes', async () => {
    render(<CustomerNotes id="a1" role="SUPPORT" />);
    ask.mockResolvedValueOnce(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove this note?', confirmLabel: 'Remove note', message: expect.stringMatching(/e-invoice password was wrong.*by Asha Rao/) })));
    expect(api.opsRemoveNote).not.toHaveBeenCalled();
    ask.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.opsRemoveNote).toHaveBeenCalledWith('a1', 'n1'));
  });

  it('offers Try again when the notes cannot be read', async () => {
    api.opsNotes.mockRejectedValueOnce(new Error('down'));
    render(<CustomerNotes id="a1" role="SUPPORT" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/e-invoice password was wrong/)).toBeInTheDocument();
  });
});
