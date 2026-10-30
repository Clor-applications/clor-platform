import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * The employee app's attendance-rules cards: a day to fix opens the request, the late-mark line
 * says what the next one costs, and night-work consent shows to a woman only.
 */
const api = vi.hoisted(() => ({
  SignedOut: class SignedOut extends Error {},
  getFixes: vi.fn(),
  getMyMarks: vi.fn(),
  getNightConsent: vi.fn(),
  setNightConsent: vi.fn(),
}));
vi.mock('./portalApi', () => api);
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

import { FixNotices, MyMarks, NightConsent } from './TimeRules';

const guard = (p) => p;
beforeEach(() => vi.clearAllMocks());

it('lists the days to fix; Fix hands the day on', async () => {
  const fix = { date: '2026-10-29', what: 'NO_OUT', checkIn: '09:05', suggestedOut: '18:00' };
  api.getFixes.mockResolvedValue({ fixes: [fix], team: { count: 2 }, notices: [{ id: 'n1', seq: 1, reportBy: '2026-11-06' }] });
  const onFix = vi.fn();
  render(<FixNotices guard={guard} onFix={onFix} />);
  expect(await screen.findByText('No punch-out')).toBeTruthy();
  expect(screen.getByText(/2 days of your team still to fix/)).toBeTruthy();
  expect(screen.getByText(/HR sent you a notice about your absence/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Fix/ }));
  expect(onFix).toHaveBeenCalledWith(fix);
});

it('shows nothing when there is nothing to fix', async () => {
  api.getFixes.mockResolvedValue({ fixes: [], team: null, notices: [] });
  const { container } = render(<FixNotices guard={guard} />);
  await waitFor(() => expect(api.getFixes).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

it('says how far to the next cost, and the rule', async () => {
  api.getMyMarks.mockResolvedValue({ on: true, late: { count: 2, line: '2 of 3 late marks; the next one costs ½ day.' }, early: null, days: 0, policy: 'Every 3 late arrivals in a month cost ½ day, unpaid.' });
  render(<MyMarks guard={guard} month="2026-10" />);
  expect(await screen.findByText('2 of 3 late marks; the next one costs ½ day.')).toBeTruthy();
  expect(screen.getByText(/Every 3 late arrivals/)).toBeTruthy();
});

it('night work: hidden unless asked; a woman withdraws with a confirm', async () => {
  api.getNightConsent.mockResolvedValueOnce({ asked: false });
  const { container, unmount } = render(<NightConsent guard={guard} />);
  await waitFor(() => expect(api.getNightConsent).toHaveBeenCalled());
  expect(container.textContent).toBe('');
  unmount();
  api.getNightConsent.mockResolvedValue({ asked: true, window: '7 pm to 6 am', consent: { status: 'GIVEN', onDate: '2026-10-01' }, nightDaysAhead: 2 });
  api.setNightConsent.mockResolvedValue({ consent: { status: 'WITHDRAWN' } });
  render(<NightConsent guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw consent' }));
  await waitFor(() => expect(api.setNightConsent).toHaveBeenCalledWith({ status: 'WITHDRAWN' }));
  expect(dialogs.confirmDialog).toHaveBeenCalled();
});
