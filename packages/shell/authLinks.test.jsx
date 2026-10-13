import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = { forgotPassword: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn() };
vi.mock('../platform/auth', () => ({
  forgotPassword: (...a) => api.forgotPassword(...a),
  resetPassword: (...a) => api.resetPassword(...a),
  verifyEmail: (...a) => api.verifyEmail(...a),
}));

import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import VerifyEmail from './VerifyEmail';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('forgot password', () => {
  it('asks the server for a link and answers the same whether or not the account exists', async () => {
    api.forgotPassword.mockResolvedValue({ message: 'If that email exists, a reset link has been sent.' });
    render(<ForgotPassword onHome={() => {}} onSignIn={() => {}} />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' owner@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: /email me a reset link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('If owner@example.com has a Clor account'));
    expect(api.forgotPassword).toHaveBeenCalledWith('owner@example.com');
  });

  it('needs an email before sending', () => {
    render(<ForgotPassword onHome={() => {}} onSignIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /email me a reset link/i }));
    expect(screen.getByText('Enter the email you signed up with.')).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });
});

describe('reset password', () => {
  it('refuses two different passwords without calling the server', () => {
    render(<ResetPassword token="t0k3n-abcdef" onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassw0rd!' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'Different1!' } });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    expect(screen.getByText('The two passwords do not match.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('sends the token with the new password and then offers sign in', async () => {
    api.resetPassword.mockResolvedValue({ message: 'ok' });
    const onDone = vi.fn();
    render(<ResetPassword token="t0k3n-abcdef" onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassw0rd!' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'NewPassw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /go to sign in/i })).toBeInTheDocument());
    expect(api.resetPassword).toHaveBeenCalledWith({ token: 't0k3n-abcdef', password: 'NewPassw0rd!' });
  });

  it('shows the server reason when the link is spent or expired', async () => {
    api.resetPassword.mockRejectedValue(new Error('Invalid or expired token'));
    render(<ResetPassword token="old-token-123" onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassw0rd!' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'NewPassw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() => expect(screen.getByText('Invalid or expired token')).toBeInTheDocument());
  });
});

describe('verify email', () => {
  it('confirms once on arrival', async () => {
    api.verifyEmail.mockResolvedValue({ ok: true, email: 'owner@example.com' });
    render(<VerifyEmail token="verify-123456" onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText('Email confirmed')).toBeInTheDocument());
    expect(api.verifyEmail).toHaveBeenCalledTimes(1);
    expect(api.verifyEmail).toHaveBeenCalledWith('verify-123456');
  });

  it('says plainly when the link no longer works', async () => {
    api.verifyEmail.mockRejectedValue(new Error('Invalid or expired token'));
    render(<VerifyEmail token="verify-123456" onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText('Link not valid')).toBeInTheDocument());
  });
});
