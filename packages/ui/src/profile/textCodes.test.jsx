import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ startSmsTwoFactor: vi.fn(), enableSmsTwoFactor: vi.fn(), sendSmsOffCode: vi.fn(), disableSmsTwoFactor: vi.fn() }));
vi.mock('./twoFactorApi', () => api);

import TextCodesCard from './TextCodesCard';

const PHONE = '+91 ••••• ••210';
beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

/* My profile, Security: codes by text message beside the authenticator app. */
describe('codes by text message on the profile', () => {
  it('is not shown until CLOR can send texts', () => {
    const { container } = render(<TextCodesCard sms={{ enabled: false, available: false, phone: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('turns on with the password, a mobile number and the code sent to it, then shows recovery codes once', async () => {
    api.startSmsTwoFactor.mockResolvedValue({ sent: true, phone: PHONE, resendIn: 30 });
    api.enableSmsTwoFactor.mockResolvedValue({ enabled: true, phone: PHONE, recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
    const onChange = vi.fn();
    render(<TextCodesCard sms={{ enabled: false, available: true, phone: null }} onChange={onChange} />);
    const start = screen.getByRole('button', { name: /Text me a code/ });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98765 43210' } });
    fireEvent.click(start);
    await waitFor(() => expect(api.startSmsTwoFactor).toHaveBeenCalledWith('my-password', '98765 43210'));
    expect(await screen.findByText(PHONE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new code in 30s' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code from the text message'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(api.enableSmsTwoFactor).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it('turns off with the password and a code, which it can text', async () => {
    api.sendSmsOffCode.mockResolvedValue({ sent: true, phone: PHONE, resendIn: 30 });
    api.disableSmsTwoFactor.mockResolvedValue({ enabled: false });
    const onChange = vi.fn();
    render(<TextCodesCard sms={{ enabled: true, available: true, phone: PHONE, enabledAt: '2026-11-17T10:00:00.000Z' }} appOn onChange={onChange} />);
    expect(screen.getByText('On')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`We texted a code to ${PHONE}.`);
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } });
    fireEvent.change(screen.getByLabelText('A texted code, a code from the app, or a recovery code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.disableSmsTwoFactor).toHaveBeenCalledWith('my-password', '654321'));
    expect(onChange).toHaveBeenCalled();
  });

  it('stays for someone who has it on while CLOR’s sender is off, so they can turn it off', () => {
    render(<TextCodesCard sms={{ enabled: true, available: false, phone: PHONE }} />);
    expect(screen.getByRole('heading', { name: 'Codes by text message' })).toBeInTheDocument();
  });
});
