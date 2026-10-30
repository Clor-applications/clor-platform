import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

/* HR records someone's wish not to be announced on birthdays and anniversaries, on their record (QA on #81). */
const api = vi.hoisted(() => ({ getCelebrationsFor: vi.fn(), setCelebrationsFor: vi.fn(async () => ({})) }));
vi.mock('../api/engagement', () => api);
vi.mock('./api', () => ({}));
vi.mock('@platform/context', () => ({ currentUser: () => null, orgId: () => 'org1', branchId: () => 'b1' }));
vi.mock('@platform/auth', () => ({ featuresFor: async () => ({}) }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

const { PersonCelebrations } = await import('./RecordExtras');
beforeEach(() => vi.clearAllMocks());

it('HR switches someone out of the announcements, and back', async () => {
  api.getCelebrationsFor.mockResolvedValueOnce({ optedOut: false, canEdit: true }).mockResolvedValueOnce({ optedOut: true, canEdit: true });
  render(<PersonCelebrations employeeId="e1" />);
  const sw = await screen.findByRole('switch', { name: 'Announce their birthday and work anniversary' });
  expect(sw.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(sw);
  await waitFor(() => expect(api.setCelebrationsFor).toHaveBeenCalledWith('e1', true));
  expect(await screen.findByText(/Not announced: they asked not to be/)).toBeTruthy();
});

it('without HR’s rights it is shown, not changed', async () => {
  api.getCelebrationsFor.mockResolvedValue({ optedOut: true, canEdit: false });
  render(<PersonCelebrations employeeId="e1" />);
  expect((await screen.findByRole('switch')).disabled).toBe(true);
  expect(screen.getByText(/HR changes this/)).toBeTruthy();
});
