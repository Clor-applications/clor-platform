import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Tags from './Tags';

/*
 * Settings → Tags (PEOPLE-39): Add tag is the one primary action and opens a drawer; while the tag is created the
 * drawer's button is busy and a second press does nothing; then the drawer closes and the tag is in the list. No toast:
 * the new row is the answer.
 */
const api = vi.hoisted(() => ({ listTags: vi.fn(), createTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('@ui/personnel/api', () => api);
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

beforeEach(() => {
  vi.clearAllMocks();
  api.listTags.mockResolvedValue([]);
});

it('adds a tag from the drawer: busy while it saves, refuses a second press, then lists it', async () => {
  let finish;
  api.createTag.mockImplementation(() => new Promise((r) => { finish = r; }));
  render(<Tags />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add tag' }));
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Remote' } });
  const save = screen.getAllByRole('button', { name: 'Add tag' }).find((b) => b.getAttribute('type') === 'submit');
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Adding…' }));
  expect(api.createTag).toHaveBeenCalledTimes(1);
  expect(api.createTag).toHaveBeenCalledWith({ name: 'Remote', color: '#2A78D6' });
  api.listTags.mockResolvedValue([{ id: 't1', name: 'Remote', color: '#2A78D6', createdAt: '2026-11-14T10:00:00Z' }]);
  finish({});
  expect(await screen.findByText('Remote')).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Name/)).toBeNull();
  expect(screen.getByText('1 item')).toBeInTheDocument();
  expect(dialogs.notify.success).not.toHaveBeenCalled();
});

it('deletes a tag after asking', async () => {
  api.listTags.mockResolvedValue([{ id: 't1', name: 'Remote', color: '#2A78D6' }]);
  api.deleteTag.mockResolvedValue({});
  render(<Tags />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Remote' }));
  await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith('t1'));
  expect(dialogs.confirmDialog).toHaveBeenCalled();
});
