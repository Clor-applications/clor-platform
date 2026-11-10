import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => Object.fromEntries(
  ['opsEmailLog', 'opsEmailSenders', 'opsEmailTemplates', 'opsPreviewTemplate', 'opsResendEmail', 'opsResetTemplate', 'opsSaveSender', 'opsSaveTemplate', 'opsTestSender', 'opsTestTemplate'].map((k) => [k, vi.fn()]),
));
vi.mock('./api', () => api);
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify }));

import { EmailAddresses, EmailLog, EmailTemplates } from './Email';

const reason = (text) => fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: text } });
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  notify.success.mockReset();
  notify.error.mockReset();
});

const senders = {
  serverFrom: 'CLOR <no-reply@localhost>',
  sending: false,
  senders: [
    { purpose: 'sales', label: 'Sales', uses: 'Demo requests and Explore links', name: 'CLOR Sales', email: 'sales@clor.in', replyTo: '', set: true },
    { purpose: 'support', label: 'Support', uses: 'Replies to customers who need help', name: '', email: '', replyTo: '', set: false },
  ],
};

describe('Email addresses', () => {
  it('shows each address, says when mail is not being delivered, and sends a test with a plain result', async () => {
    api.opsEmailSenders.mockResolvedValue(senders);
    api.opsTestSender.mockResolvedValue({ sent: false, status: 'FAILED', message: 'The mail server refused CLOR’s sign-in. Engineering should check the mail password.' });
    render(<EmailAddresses role="SUPPORT" />);
    expect(await screen.findByText('<sales@clor.in>')).toBeInTheDocument();
    expect(screen.getByText(/Not set\. Uses the server’s address, CLOR <no-reply@localhost>/)).toBeInTheDocument();
    expect(screen.getByText(/no mail server set up/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Send test' })[0]);
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('The mail server refused CLOR’s sign-in. Engineering should check the mail password.'));
    expect(api.opsTestSender).toHaveBeenCalledWith('sales');
  });

  it('lets the owner change an address with a reason', async () => {
    api.opsEmailSenders.mockResolvedValue(senders);
    api.opsSaveSender.mockResolvedValue({});
    render(<EmailAddresses role="SUPER_ADMIN" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[1]);
    expect(screen.getByLabelText('Email address')).toHaveValue('support@clor.in');
    fireEvent.change(screen.getByLabelText('Name people see'), { target: { value: 'CLOR Support' } });
    reason('Support desk opens');
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(api.opsSaveSender).toHaveBeenCalledWith('support', { name: 'CLOR Support', email: 'support@clor.in', replyTo: '', reason: 'Support desk opens' }));
  });
});

const tpl = { key: 'people.joined', label: 'Somebody joined', description: 'When a person joins.', fields: ['name', 'appName'], transactional: false, sender: 'no-reply', changed: true, changedAt: '2026-11-09T00:00:00Z', subject: 'Joined {{appName}}', body: 'Hello {{name}}', defaultSubject: 'x', defaultBody: 'y' };

describe('Email templates', () => {
  it('opens a template, shows its placeholders, previews, saves and resets with a reason', async () => {
    api.opsEmailTemplates.mockResolvedValue({ templates: [tpl] });
    api.opsPreviewTemplate.mockResolvedValue({ subject: 'Joined CLOR', body: 'Hello Asha Rao, welcome', unknown: [] });
    api.opsSaveTemplate.mockResolvedValue({});
    api.opsResetTemplate.mockResolvedValue({});
    render(<EmailTemplates role="SUPER_ADMIN" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Somebody joined' }));
    expect(screen.getByText('{{name}}')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello {{name}}, welcome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Hello Asha Rao, welcome')).toBeInTheDocument();
    expect(api.opsPreviewTemplate).toHaveBeenCalledWith('people.joined', { subject: 'Joined {{appName}}', body: 'Hello {{name}}, welcome' });
    expect(screen.getByRole('button', { name: 'Send test' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));
    reason('Warmer');
    fireEvent.click(screen.getAllByRole('button', { name: 'Save wording' }).at(-1));
    await waitFor(() => expect(api.opsSaveTemplate).toHaveBeenCalledWith('people.joined', { subject: 'Joined {{appName}}', body: 'Hello {{name}}, welcome', reason: 'Warmer' }));
  });

  it('lets anybody but read-only send a test of the saved wording; only the owner edits', async () => {
    api.opsEmailTemplates.mockResolvedValue({ templates: [tpl] });
    api.opsTestTemplate.mockResolvedValue({ sent: true, message: 'Sent to meena@clor.in. Check that inbox.' });
    render(<EmailTemplates role="SALES" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Somebody joined' }));
    expect(screen.queryByRole('button', { name: 'Save wording' })).toBeNull();
    expect(screen.getByLabelText('Subject')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Sent to meena@clor.in. Check that inbox.'));
  });
});

describe('Email log', () => {
  it('shows each message with a plain reason, filters failed ones, and resends with a reason', async () => {
    api.opsEmailLog.mockResolvedValue({
      total: 1, page: 0, pageSize: 50, failedThisWeek: 1,
      messages: [{ id: 'm1', to: 'asha@rao.in', template: 'auth.password_reset', templateLabel: 'Password reset', subject: 'Reset your password', status: 'FAILED', attempts: 1, reason: 'Could not reach the mail server. Engineering should check the mail settings.', accountId: 'a1', accountName: 'Rao Textiles', at: '2026-11-10T05:00:00Z' }],
    });
    api.opsResendEmail.mockResolvedValue({ sent: true, message: 'Sent to asha@rao.in. Check that inbox.' });
    const openCustomer = vi.fn();
    render(<EmailLog role="SUPPORT" initialStatus="FAILED" openCustomer={openCustomer} />);
    expect(await screen.findByText('Could not reach the mail server. Engineering should check the mail settings.')).toBeInTheDocument();
    expect(api.opsEmailLog).toHaveBeenCalledWith({ status: 'FAILED', q: '', page: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Rao Textiles' }));
    expect(openCustomer).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    reason('Customer asked');
    fireEvent.click(screen.getAllByRole('button', { name: 'Resend' }).at(-1));
    await waitFor(() => expect(api.opsResendEmail).toHaveBeenCalledWith('m1', 'Customer asked'));
    expect(notify.success).toHaveBeenCalledWith('Sent to asha@rao.in. Check that inbox.');
  });

  it('offers Sales no Resend', async () => {
    api.opsEmailLog.mockResolvedValue({ total: 1, page: 0, pageSize: 50, failedThisWeek: 0, messages: [{ id: 'm1', to: 'a@b.in', templateLabel: 'X', subject: 'S', status: 'FAILED', reason: 'r', at: '2026-11-10T05:00:00Z' }] });
    render(<EmailLog role="SALES" openCustomer={() => {}} />);
    expect(await screen.findByText('a@b.in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
  });
});
