import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Tags from './Tags';

/*
 * Settings → Tags: Add is the one save in People where no toast fires (the new tag appearing is the answer), so it
 * uses the shared button states: loading while the tag is created, then "Added" for a moment (DESIGN.md, Buttons).
 */
const api = vi.hoisted(() => ({ listTags: vi.fn(), createTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('@ui/personnel/api', () => api);
vi.mock('@ui/chrome/SettingsScreenHeader', () => ({ default: ({ title }) => <h1>{title}</h1> }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

beforeEach(() => {
  vi.clearAllMocks();
  api.listTags.mockResolvedValue([]);
});

it('adds a tag: busy while it saves, refuses a second press, then says Added', async () => {
  let finish;
  api.createTag.mockImplementation(() => new Promise((r) => { finish = r; }));
  render(<Tags />);
  fireEvent.change(await screen.findByLabelText('New tag'), { target: { value: 'Remote' } });
  const add = screen.getByRole('button', { name: 'Add' });
  fireEvent.click(add);
  await waitFor(() => expect(add).toHaveAttribute('aria-busy', 'true'));
  expect(screen.getByRole('button', { name: 'Add' })).toBe(add);
  fireEvent.click(add);
  expect(api.createTag).toHaveBeenCalledTimes(1);
  api.listTags.mockResolvedValue([{ id: 't1', name: 'Remote', color: '#E54F38' }]);
  finish({});
  expect(await screen.findByRole('button', { name: 'Added' })).toHaveAttribute('data-state', 'done');
  expect(await screen.findByText('Remote')).toBeInTheDocument();
  expect(dialogs.notify.success).not.toHaveBeenCalled();
});
