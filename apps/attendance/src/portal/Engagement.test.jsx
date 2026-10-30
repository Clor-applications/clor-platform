import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { Celebrations, ExitInterview, TodayPosts } from './Engagement';

/*
 * The employee app's leaving and engagement cards (WORKFLOW-GAP-RESEARCH 4.8, 4.9): today's greetings,
 * the exit interview on the phone (a choice must be picked, sent once, then thanks), and the opt-out.
 */
const api = vi.hoisted(() => ({
  SignedOut: class SignedOut extends Error {},
  getTodayPosts: vi.fn(),
  getExitInterview: vi.fn(),
  sendExitInterview: vi.fn(),
  getCelebrations: vi.fn(),
  setCelebrations: vi.fn(),
}));
vi.mock('./portalApi', () => api);
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);
vi.mock('@platform/context', () => ({ hasApp: () => false, orgId: () => 'org1' }));
const guard = (p) => p;

beforeEach(() => vi.clearAllMocks());

it('today: the team’s birthday and the holiday tomorrow; nothing at all when there is none', async () => {
  api.getTodayPosts.mockResolvedValueOnce({ posts: [{ id: 'p1', kind: 'BIRTHDAY', text: 'Ravi Kumar’s birthday today', mine: false }, { id: 'p2', kind: 'HOLIDAY', text: 'Tomorrow, Fri 31 Oct, is a holiday: Diwali', mine: false }] });
  const { unmount } = render(<TodayPosts guard={guard} />);
  expect(await screen.findByText('Ravi Kumar’s birthday today')).toBeTruthy();
  expect(screen.getByText(/is a holiday: Diwali/)).toBeTruthy();
  unmount();
  api.getTodayPosts.mockResolvedValueOnce({ posts: [] });
  const { container } = render(<TodayPosts guard={guard} />);
  await waitFor(() => expect(api.getTodayPosts).toHaveBeenCalledTimes(2));
  expect(container.textContent).toBe('');
});

const IV = {
  status: 'OPEN', lastDay: '2026-11-14', questions: [
    { key: 'reason', text: 'What is the main reason you are leaving?', kind: 'REASON', options: [{ code: 'PAY', label: 'Better pay elsewhere' }, { code: 'GROWTH', label: 'Career growth' }] },
    { key: 'keptYou', text: 'What would have made you stay?', kind: 'TEXT' },
  ],
  purpose: 'Your answers help the company understand why people leave. They are kept for 24 months, then erased.',
};

it('exit interview: nothing while not leaving', async () => {
  api.getExitInterview.mockResolvedValue({ interview: null });
  const { container } = render(<ExitInterview guard={guard} />);
  await waitFor(() => expect(api.getExitInterview).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

it('exit interview: answered on the phone, the reason first, hidden from the manager, then thanks', async () => {
  api.getExitInterview.mockResolvedValueOnce({ interview: IV }).mockResolvedValueOnce({ interview: { ...IV, status: 'SUBMITTED', submittedAt: '2026-10-30T06:00:00.000Z', enteredBy: 'EMPLOYEE' } });
  api.sendExitInterview.mockResolvedValue({});
  render(<ExitInterview guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Answer now' }));
  expect(screen.getByText(/kept for 24 months/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/main reason/);
  expect(api.sendExitInterview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Career growth', pressed: false }));
  fireEvent.change(screen.getByLabelText('What would have made you stay?'), { target: { value: 'A lead role' } });
  fireEvent.click(screen.getByLabelText('Keep my answers from my managers'));
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  await waitFor(() => expect(api.sendExitInterview).toHaveBeenCalledWith({ answers: { reason: 'GROWTH', keptYou: 'A lead role' }, hideFromManager: true }));
  expect(dialogs.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ message: 'HR and the owner read them; your managers do not.' }));
  expect(await screen.findByText(/You sent your answers on .*Thank you/)).toBeTruthy();
});

it('exit interview: a refusal (already sent elsewhere) is said plainly', async () => {
  api.getExitInterview.mockResolvedValue({ interview: IV });
  api.sendExitInterview.mockRejectedValue(new Error('The exit interview has already been sent.'));
  render(<ExitInterview guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Answer now' }));
  fireEvent.click(screen.getByRole('button', { name: 'Better pay elsewhere', pressed: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  expect((await screen.findByRole('alert')).textContent).toBe('The exit interview has already been sent.');
});

it('celebrations: announced by default; switched off, the team is not told', async () => {
  api.getCelebrations.mockResolvedValueOnce({ optedOut: false }).mockResolvedValueOnce({ optedOut: true });
  api.setCelebrations.mockResolvedValue({ optedOut: true });
  render(<Celebrations guard={guard} />);
  const sw = await screen.findByRole('switch', { name: 'Tell my team on my birthday and work anniversary' });
  expect(sw.checked).toBe(true);
  expect(screen.getByText('Only the day is shown, never the year.')).toBeTruthy();
  fireEvent.click(sw);
  await waitFor(() => expect(api.setCelebrations).toHaveBeenCalledWith(true));
  expect(await screen.findByText('Done. Your team will not be told.')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('switch').checked).toBe(false));
});
