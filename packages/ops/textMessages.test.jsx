import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsSms: vi.fn(), opsSaveSms: vi.fn(), opsTestSms: vi.fn() }));
vi.mock('./api', () => api);
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify }));

import { TextMessages } from './TextMessages';

const OFF = { provider: 'MSG91', enabled: false, ready: false, templateId: null, senderId: null, authKeySaved: false, authKeyHint: null, lastTestAt: null, lastTestOk: null, lastTestMessage: null };
const ON = { ...OFF, enabled: true, ready: true, templateId: 'tmpl1234abcd', senderId: 'CLORIN', authKeySaved: true, authKeyHint: '9012' };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  notify.success.mockReset();
  notify.error.mockReset();
  api.opsSms.mockResolvedValue({ sms: OFF });
  api.opsSaveSms.mockResolvedValue({ sms: ON });
});

/* Ops, Text messages: CLOR's SMS sender for sign-in codes. */
describe('the Text messages page', () => {
  it('saves the key, template and sender an owner pastes', async () => {
    render(<TextMessages role="SUPER_ADMIN" />);
    expect(await screen.findByRole('heading', { name: 'Text messages' })).toBeInTheDocument();
    expect(screen.getByText('No test sent yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Offer sign-in codes by text message/));
    fireEvent.change(screen.getByLabelText('Auth key'), { target: { value: 'Abcd1234Efgh5678Ijkl9012' } });
    fireEvent.change(screen.getByLabelText('Template ID'), { target: { value: 'tmpl1234abcd' } });
    fireEvent.change(screen.getByLabelText('Sender ID'), { target: { value: 'clorin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.opsSaveSms).toHaveBeenCalledWith({ enabled: true, authKey: 'Abcd1234Efgh5678Ijkl9012', templateId: 'tmpl1234abcd', senderId: 'CLORIN' }));
    expect(notify.success).toHaveBeenCalledWith('Saved. People can now choose a code by text message.');
  });

  it('never shows a saved key, only its last four, and keeps it when the box is left empty', async () => {
    api.opsSms.mockResolvedValue({ sms: ON });
    render(<TextMessages role="SUPER_ADMIN" />);
    const key = await screen.findByLabelText('Auth key');
    expect(key).toHaveValue('');
    expect(key.getAttribute('placeholder')).toContain('ends in 9012');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.opsSaveSms).toHaveBeenCalledWith({ enabled: true, authKey: null, templateId: 'tmpl1234abcd', senderId: 'CLORIN' }));
  });

  it('lists what the server says is wrong', async () => {
    api.opsSaveSms.mockRejectedValue(Object.assign(new Error('x'), { data: { problems: ['Paste MSG91’s auth key to switch text messages on.', 'Enter the template ID of the approved sign-in code template.'] } }));
    render(<TextMessages role="SUPER_ADMIN" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste MSG91’s auth key');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the template ID');
  });

  it('sends a test text and shows how the last one went', async () => {
    api.opsSms.mockResolvedValue({ sms: { ...ON, lastTestAt: '2026-11-17T10:00:00.000Z', lastTestOk: false, lastTestMessage: 'MSG91 did not send it: template not approved' } });
    api.opsTestSms.mockResolvedValue({ ok: true, message: 'Sent a test code to +91 ••••• ••210.' });
    render(<TextMessages role="SUPER_ADMIN" />);
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    expect(screen.getByText(/template not approved/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send test text' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Indian mobile number'), { target: { value: '98765 43210' } });
    fireEvent.click(send);
    await waitFor(() => expect(api.opsTestSms).toHaveBeenCalledWith('98765 43210'));
    expect(notify.success).toHaveBeenCalledWith('Sent a test code to +91 ••••• ••210.');
  });

  it('is read-only for staff who are not owners of the console', async () => {
    api.opsSms.mockResolvedValue({ sms: ON });
    render(<TextMessages role="SUPPORT" />);
    expect(await screen.findByLabelText('Template ID')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send test text' })).toBeNull();
    expect(screen.getByText('Only an owner of the console can change this.')).toBeInTheDocument();
  });
});
