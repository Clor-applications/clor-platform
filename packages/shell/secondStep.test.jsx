import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * The second step of a sign-in (owner, 17 Nov 2026): a code from the
 * authenticator app or one sent by text message, whichever the person has on.
 */
const api = { signIn: vi.fn(), signInWithCode: vi.fn(), sms: vi.fn() };
vi.mock('./session', () => ({ useSession: () => ({ signIn: (...a) => api.signIn(...a), signInWithCode: (...a) => api.signInWithCode(...a) }) }));
vi.mock('@platform/auth', () => ({ resendVerificationForSignIn: vi.fn(), loginTwoFactorSms: (...a) => api.sms(...a) }));
vi.mock('@platform/http', () => ({ API_BASE: '/api', apiFetch: () => Promise.resolve({ providers: [] }) }));
vi.mock('./AuthLayout', () => ({ default: ({ title, subtitle, children }) => <div><h1>{title}</h1><p data-testid="sub">{subtitle}</p>{children}</div> }));

import SignIn from './SignIn';

const PHONE = '+91 ••••• ••210';
const refusal = (code, message, status, data = {}) => Object.assign(new Error(message), { code, status, data: { code, error: message, ...data } });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.sms.mockResolvedValue({ sent: true, phone: PHONE, expiresIn: 300, resendIn: 30 });
  api.signInWithCode.mockResolvedValue({});
});

const password = async (methods, phone = null) => {
  api.signIn.mockResolvedValue({ twoFactorRequired: true, challenge: 'chal-1', methods, phone });
  render(<SignIn onHome={() => {}} />);
  fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'kavya@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Passw0rd!23' } });
  fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
  await screen.findByText('Enter your code');
};

describe('the code step of a sign-in', () => {
  it('asks for the app’s code, and offers no text, when only the app is on', async () => {
    await password(['APP']);
    expect(screen.getByTestId('sub')).toHaveTextContent('Open your authenticator app');
    expect(screen.queryByRole('button', { name: /Text me a code/ })).toBeNull();
    expect(api.sms).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
    await waitFor(() => expect(api.signInWithCode).toHaveBeenCalledWith({ challenge: 'chal-1', code: '123456' }));
  });

  it('texts a code only when asked, by someone with both, and holds the resend back', async () => {
    await password(['APP', 'SMS'], PHONE);
    expect(api.sms).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code instead' }));
    await waitFor(() => expect(api.sms).toHaveBeenCalledWith('chal-1'));
    expect(await screen.findByText(`We texted a 6-digit code to ${PHONE}. It works for 5 minutes.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new code in 30s' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use my authenticator app' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
    await waitFor(() => expect(api.signInWithCode).toHaveBeenCalledWith({ challenge: 'chal-1', code: '654321' }));
    expect(api.sms).toHaveBeenCalledTimes(1);
  });

  it('texts a code as the page opens when text messages are the only way', async () => {
    await password(['SMS'], PHONE);
    await waitFor(() => expect(api.sms).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(new RegExp('We texted a 6-digit code'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my authenticator app' })).toBeNull();
  });

  it('treats “one was just sent” as sent, and says plainly when a text cannot go', async () => {
    api.sms.mockRejectedValueOnce(refusal('SMS_HELD', 'A code was just sent. You can ask for another in 12 seconds.', 429, { retryAfter: 12 }));
    await password(['SMS'], PHONE);
    expect(await screen.findByRole('button', { name: 'Send a new code in 12s' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows why when the text could not be sent', async () => {
    api.sms.mockRejectedValueOnce(refusal('SMS_NOT_SENT', 'MSG91 could not be reached. Try again in a minute. Use your authenticator app or a recovery code.', 503));
    await password(['APP', 'SMS'], PHONE);
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code instead' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('MSG91 could not be reached');
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('goes back to the password when the sign-in took too long', async () => {
    await password(['APP']);
    api.signInWithCode.mockRejectedValue(refusal('CHALLENGE_EXPIRED', 'That sign-in took too long. Enter your password again.', 401));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('took too long');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
