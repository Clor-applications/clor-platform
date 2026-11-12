import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import AskLetter from './AskLetter';

/*
 * Asking HR for a letter or a copy of a document from the employee app
 * (People plan 8 Nov 2026, step 6): the letters I may ask for, a copy with
 * what it is, my asks with where they stand, withdraw while waiting.
 */
const api = vi.hoisted(() => ({
  SignedOut: class SignedOut extends Error {},
  getMyLetters: vi.fn(),
  askLetter: vi.fn(),
  withdrawMyRequest: vi.fn(),
}));
vi.mock('./portalApi', () => api);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
const guard = (p) => p;
beforeEach(() => vi.clearAllMocks());

it('asks for a letter with what it is for, and lists my asks with where they stand', async () => {
  api.getMyLetters.mockResolvedValue({
    kinds: [{ kind: 'EMPLOYMENT', label: 'Employment certificate' }],
    requests: [
      { id: 'r1', type: 'LETTER_REQUEST', title: 'Ravi: employment certificate', status: 'APPROVED', createdAt: '2026-11-01T06:00:00Z', issued: true },
      { id: 'r2', type: 'DOCUMENT_REQUEST', title: 'Ravi: a copy of my offer', status: 'WAITING', createdAt: '2026-11-02T06:00:00Z', issued: false },
    ],
  });
  api.askLetter.mockResolvedValue({ request: { id: 'r3', status: 'WAITING' } });
  render(<AskLetter guard={guard} />);
  expect(await screen.findByRole('option', { name: 'Employment certificate' })).toBeTruthy();
  expect(screen.getByText('Asked 1 Nov 2026 · in My documents')).toBeTruthy();
  expect(screen.getByText('A copy of my offer')).toBeTruthy();
  expect(screen.getByText('Waiting for HR')).toBeTruthy();
  /* Only the waiting one can be withdrawn. */
  expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Ask for'), { target: { value: 'EMPLOYMENT' } });
  fireEvent.change(screen.getByLabelText('What it is for'), { target: { value: 'For my bank' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to HR' }));
  expect(await screen.findByText('Sent to HR. You will see it here when they decide.')).toBeTruthy();
  expect(api.askLetter).toHaveBeenCalledWith({ kind: 'EMPLOYMENT', what: undefined, note: 'For my bank' });
});

it('a copy needs to say which document; a refusal is shown', async () => {
  api.getMyLetters.mockResolvedValue({ kinds: [], requests: [] });
  api.askLetter.mockRejectedValue(new Error('You have already asked for this. HR has it.'));
  render(<AskLetter guard={guard} />);
  fireEvent.change(await screen.findByLabelText('Ask for'), { target: { value: 'COPY' } });
  const send = screen.getByRole('button', { name: 'Send to HR' });
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Which document'), { target: { value: 'My offer letter' } });
  fireEvent.click(send);
  expect((await screen.findByRole('alert')).textContent).toBe('You have already asked for this. HR has it.');
  expect(api.askLetter).toHaveBeenCalledWith({ kind: 'COPY', what: 'My offer letter', note: undefined });
});

it('withdraws an ask that waits', async () => {
  api.getMyLetters.mockResolvedValue({ kinds: [], requests: [{ id: 'r2', type: 'LETTER_REQUEST', title: 'Ravi: employment certificate', status: 'WAITING', createdAt: '2026-11-02T06:00:00Z', issued: false }] });
  api.withdrawMyRequest.mockResolvedValue({ id: 'r2', status: 'WITHDRAWN' });
  render(<AskLetter guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
  expect(await screen.findByText('Withdrawn.')).toBeTruthy();
  expect(api.withdrawMyRequest).toHaveBeenCalledWith('r2');
});
