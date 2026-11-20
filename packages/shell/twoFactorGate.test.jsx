import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getTwoFactor: vi.fn(), startTwoFactor: vi.fn(), enableTwoFactor: vi.fn(), startSmsTwoFactor: vi.fn(), enableSmsTwoFactor: vi.fn() }));
vi.mock('@ui/profile/twoFactorApi', () => api);
const session = { user: { email: 'owner@x.in' }, recheckTwoFactor: vi.fn(), signOut: vi.fn() };
vi.mock('./session', () => ({ useSession: () => session }));
vi.mock('./legal/LegalLinks', () => ({ default: () => null }));
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:image/png;base64,AA==') } }));

import TwoFactorGate from './TwoFactorGate';

const PHONE = '+91 ••••• ••210';
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  session.recheckTwoFactor.mockReset().mockResolvedValue(false);
});

/* The set-up page an owner or admin lands on when their company requires two-step sign-in. */
describe('setting up two-step sign-in at the gate', () => {
  it('offers only the app until CLOR can send texts', async () => {
    api.getTwoFactor.mockResolvedValue({ enabled: false, sms: { enabled: false, available: false } });
    api.startTwoFactor.mockResolvedValue({ secret: 'ABCDEF', uri: 'otpauth://totp/x' });
    render(<TwoFactorGate />);
    expect(await screen.findByText('Confirm your password')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Text message/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Password for owner@x.in'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.startTwoFactor).toHaveBeenCalledWith('my-password'));
    expect(await screen.findByLabelText('Code from the app')).toBeInTheDocument();
  });

  it('lets them choose a text message: number, texted code, recovery codes, in', async () => {
    api.getTwoFactor.mockResolvedValue({ enabled: false, sms: { enabled: false, available: true } });
    api.startSmsTwoFactor.mockResolvedValue({ sent: true, phone: PHONE, resendIn: 30 });
    api.enableSmsTwoFactor.mockResolvedValue({ enabled: true, phone: PHONE, recoveryCodes: ['AAAA-BBBB'] });
    render(<TwoFactorGate />);
    fireEvent.click(await screen.findByLabelText(/Text message/));
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('Password for owner@x.in'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }));
    await waitFor(() => expect(api.startSmsTwoFactor).toHaveBeenCalledWith('my-password', '9876543210'));
    expect(api.startTwoFactor).not.toHaveBeenCalled();
    expect(await screen.findByText(PHONE)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Code from the text message'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on text codes' }));
    await waitFor(() => expect(api.enableSmsTwoFactor).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('I have saved these codes somewhere safe'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to CLOR' }));
    await waitFor(() => expect(session.recheckTwoFactor).toHaveBeenCalled());
  });

  it('goes straight to Continue when text-message codes are already on', async () => {
    api.getTwoFactor.mockResolvedValue({ enabled: false, sms: { enabled: true, available: true } });
    render(<TwoFactorGate />);
    expect(await screen.findByText('Two-factor sign-in is already on for this account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to CLOR' })).toBeEnabled();
  });
});
