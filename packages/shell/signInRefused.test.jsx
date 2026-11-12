import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * #4: a company that asks for a confirmed address refuses the sign-in with a
 * plain message, and the person can ask for a new link from right there.
 */
const api = { signIn: vi.fn(), resend: vi.fn() };
vi.mock('./session', () => ({ useSession: () => ({ signIn: (...a) => api.signIn(...a), signInWithCode: vi.fn() }) }));
vi.mock('@platform/auth', () => ({ resendVerificationForSignIn: (...a) => api.resend(...a) }));
vi.mock('@platform/http', () => ({ API_BASE: '/api', apiFetch: () => Promise.resolve({ providers: [] }) }));

import SignIn from './SignIn';

const refusal = (code, message, data = {}) => Object.assign(new Error(message), { code, status: 403, data: { code, error: message, ...data } });

beforeEach(() => {
  api.signIn.mockReset();
  api.resend.mockReset();
});

const fill = () => {
  fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'kavya@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Passw0rd!23' } });
  fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
};

describe('a refused sign-in', () => {
  it('says why, and sends a new confirmation link when asked', async () => {
    api.signIn.mockRejectedValue(refusal('EMAIL_NOT_CONFIRMED', 'This company asks everyone to confirm their email address before signing in.', { resendChallenge: 'chal-1' }));
    api.resend.mockResolvedValue({ ok: true });
    render(<SignIn onHome={() => {}} />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('confirm their email address');
    fireEvent.click(await screen.findByRole('button', { name: 'Send the link again' }));
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith('chal-1'));
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a new link to kavya@example.com');
  });

  it('offers no link for an address outside the allowed domains', async () => {
    api.signIn.mockRejectedValue(refusal('EMAIL_DOMAIN_NOT_ALLOWED', 'This company only lets in people with an email address at example.in.'));
    render(<SignIn onHome={() => {}} />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('example.in');
    expect(screen.queryByRole('button', { name: 'Send the link again' })).toBeNull();
  });
});
