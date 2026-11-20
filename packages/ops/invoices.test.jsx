import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  one: vi.fn(),
  start: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  discard: vi.fn(),
  issue: vi.fn(),
  paid: vi.fn(),
  void: vi.fn(),
  books: vi.fn(),
  accounts: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  choices: vi.fn(),
  link: vi.fn(),
  test: vi.fn(),
  sendAgain: vi.fn(),
  remind: vi.fn(),
  sends: vi.fn(),
  reminders: vi.fn(),
  confirm: vi.fn(),
  saveSeats: vi.fn(),
}));
vi.mock('./api', () => ({
  opsInvoices: (p) => api.list(p),
  opsSaveSelfServe: (b) => api.saveSeats(b),
  opsInvoice: (id) => api.one(id),
  opsInvoiceStart: (a) => api.start(a),
  opsNewInvoice: (b) => api.create(b),
  opsSaveInvoice: (id, b) => api.save(id, b),
  opsDiscardInvoice: (id) => api.discard(id),
  opsIssueInvoice: (id, email) => api.issue(id, email),
  opsSendInvoiceAgain: (id) => api.sendAgain(id),
  opsRemindInvoice: (id) => api.remind(id),
  opsInvoiceSends: (id) => api.sends(id),
  opsInvoiceReminders: (id, off) => api.reminders(id, off),
  opsMarkInvoicePaid: (id, b) => api.paid(id, b),
  opsVoidInvoice: (id, r) => api.void(id, r),
  opsSendInvoiceToBooks: (id) => api.books(id),
  opsPaymentAccounts: (q) => api.accounts(q),
  opsInvoicing: () => api.settings(),
  opsSaveInvoicing: (b) => api.saveSettings(b),
  opsBooksChoices: (q) => api.choices(q),
  opsSaveBooksLink: (b) => api.link(b),
  opsTestBooks: () => api.test(),
  opsRenewals: () => Promise.resolve({ renewals: { on: true, daysBefore: 7 }, upcoming: [] }),
  opsRunRenewals: () => Promise.resolve({ issued: 0, skipped: 0, failed: [] }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast, confirmDialog: (o) => api.confirm(o) }));

import { InvoicePage, Invoices, daysLate, sendWords } from './Invoices';
import { InvoiceSettings } from './InvoiceSettings';

const payTo = { upiId: 'clor@okaxis', payeeName: 'CLOR Applications', qr: 'data:image/png;base64,AAA', bank: { accountName: 'CLOR Applications Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' } };
const issued = {
  id: 'i1', number: 'CLOR/26-27/0001', accountId: 'a1', account: { id: 'a1', name: 'Kaveri Traders' }, status: 'ISSUED', overdue: false,
  issueDate: '2026-11-10T06:00:00Z', dueDate: '2026-11-25T06:00:00Z', lines: [{ description: 'CLOR People, 25 users', quantity: 25, unitAmount: 9900, amount: 247500 }],
  subtotal: 247500, tax: { charged: false }, taxTotal: 0, total: 247500, buyer: { name: 'Kaveri Traders', state: 'Karnataka' }, seller: { legalName: 'Clor Applications Private Limited' },
  payTo, months: 1, booksStatus: 'NOT_SENT',
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  Object.values(toast).forEach((f) => f.mockReset());
  api.sends.mockResolvedValue({ sends: [] });
  api.confirm.mockResolvedValue(true);
});

describe('Invoices list', () => {
  it('shows each invoice with its status and amount, and what is unpaid', async () => {
    api.list.mockResolvedValue({ invoices: [{ ...issued, buyerName: 'Kaveri Traders', overdue: true }, { id: 'd1', number: null, status: 'DRAFT', total: 100000, buyerName: 'Godavari Foods', booksStatus: 'NOT_SENT' }], hasMore: false, totals: { ISSUED: { count: 1, amount: 247500 }, OVERDUE: { count: 1, amount: 247500 } } });
    const open = vi.fn();
    render(<Invoices role="BILLING" openInvoice={open} />);
    expect(await screen.findByText('1 unpaid, ₹2,475 · 1 overdue')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Overdue')).toBeTruthy();
    expect(within(rows[1]).getByText('₹2,475')).toBeTruthy();
    expect(within(rows[2]).getByText('Draft', { selector: 'span' })).toBeTruthy();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'CLOR/26-27/0001' }));
    expect(open).toHaveBeenCalledWith('i1');
  });

  it('a read-only operator has no New invoice', async () => {
    api.list.mockResolvedValue({ invoices: [], hasMore: false, totals: {} });
    render(<Invoices role="READ_ONLY" openInvoice={() => {}} />);
    expect(await screen.findByText(/No invoices yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New invoice' })).toBeNull();
  });

  it('New invoice starts from the customer’s apps and saves a draft in paise', async () => {
    api.list.mockResolvedValue({ invoices: [], hasMore: false, totals: {} });
    api.accounts.mockResolvedValue({ accounts: [{ id: 'a1', name: 'Kaveri Traders', code: '4831920657' }] });
    api.start.mockResolvedValue({ buyer: { name: 'Kaveri Traders', state: 'Karnataka', stateCode: '29' }, lines: [{ description: 'CLOR People, 25 users', appCode: 'people', quantity: 25, unitAmount: 9900 }], gstRegistered: false });
    api.create.mockResolvedValue({ id: 'new1' });
    const open = vi.fn();
    render(<Invoices role="BILLING" openInvoice={open} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New invoice' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kaveri Traders' }));
    expect(await screen.findByDisplayValue('CLOR People, 25 users')).toBeTruthy();
    expect(screen.getByText(/No GST is added/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Price, ₹'), { target: { value: '120.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toMatchObject({ accountId: 'a1', months: 1, lines: [{ description: 'CLOR People, 25 users', quantity: 25, unitAmount: 12050 }], buyer: { name: 'Kaveri Traders', state: 'Karnataka' } });
    expect(open).toHaveBeenCalledWith('new1');
  });
});

describe('one invoice', () => {
  it('shows how to pay an unpaid invoice: the UPI QR and the bank account', async () => {
    api.one.mockResolvedValue(issued);
    render(<InvoicePage id="i1" role="BILLING" back={() => {}} openCustomer={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'CLOR/26-27/0001' })).toBeTruthy();
    expect(screen.getByAltText('UPI QR code to pay ₹2,475.00 to clor@okaxis')).toBeTruthy();
    expect(screen.getByText('50200012345678')).toBeTruthy();
    expect(screen.getByText('Put CLOR/26-27/0001 in the transfer’s remarks.')).toBeTruthy();
  });

  it('Mark paid sends the UTR, the date and the amount', async () => {
    api.one.mockResolvedValue(issued);
    api.paid.mockResolvedValue({ ...issued, status: 'PAID', paidAmount: 247500, paidAt: '2026-11-11T00:00:00Z', paymentReference: 'UTR123456789012', payTo: null, paidUntil: '2026-12-11T00:00:00Z' });
    render(<InvoicePage id="i1" role="BILLING" back={() => {}} openCustomer={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
    fireEvent.change(await screen.findByLabelText('UTR or bank reference'), { target: { value: 'UTR123456789012' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.paid).toHaveBeenCalled());
    expect(api.paid.mock.calls[0]).toEqual(['i1', expect.objectContaining({ reference: 'UTR123456789012', amount: 247500 })]);
    expect(await screen.findByText(/Paid ₹2,475.00 on/)).toBeTruthy();
    expect(screen.queryByAltText(/UPI QR code/)).toBeNull();
  });

  it('a draft is issued from its page; a failed Books send says why', async () => {
    api.one.mockResolvedValue({ ...issued, id: 'd1', number: null, status: 'DRAFT', issueDate: null, dueDate: null });
    api.issue.mockResolvedValue({ ...issued, id: 'd1', booksStatus: 'FAILED', booksError: 'The connector is off.', booksAttempts: 1 });
    render(<InvoicePage id="d1" role="BILLING" back={() => {}} openCustomer={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Draft invoice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(await screen.findByRole('heading', { name: 'CLOR/26-27/0001' })).toBeTruthy();
    expect(screen.getByText(/Not sent to Books: The connector is off./)).toBeTruthy();
  });
});

describe('emailing an invoice', () => {
  const draft = { ...issued, id: 'd1', number: null, status: 'DRAFT', issueDate: null, dueDate: null, emailTo: 'owner@kaveri.in' };
  const page = (id = 'i1') => render(<InvoicePage id={id} role="BILLING" back={() => {}} openCustomer={() => {}} />);
  const openIssue = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Issue invoice' }));
    return screen.findByRole('dialog');
  };

  it('issuing emails the customer unless the box is cleared, and always says which', async () => {
    api.one.mockResolvedValue(draft);
    api.issue.mockResolvedValue({ ...issued, id: 'd1', emailed: true, emailedTo: 'owner@kaveri.in', emailError: null });
    page('d1');
    const dialog = await openIssue();
    const box = within(dialog).getByLabelText(/Email it to owner@kaveri.in/);
    expect(box.checked).toBe(true);
    expect(within(dialog).queryByText(/sees it in Workspace, Billing, with how to pay/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(api.issue).toHaveBeenCalledWith('d1', true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Issued and emailed to owner@kaveri.in.'));
  });

  it('with the box cleared it sends email: false and says it was not emailed', async () => {
    api.one.mockResolvedValue(draft);
    api.issue.mockResolvedValue({ ...issued, id: 'd1', emailed: false, emailedTo: null, emailError: null });
    page('d1');
    const dialog = await openIssue();
    fireEvent.click(within(dialog).getByLabelText(/Email it to owner@kaveri.in/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(api.issue).toHaveBeenCalledWith('d1', false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Issued. Not emailed.'));
  });

  it('with nobody to send to, the box is off, cannot be ticked and says why', async () => {
    api.one.mockResolvedValue({ ...draft, emailTo: null });
    api.issue.mockResolvedValue({ ...issued, id: 'd1', emailed: false, emailedTo: null, emailError: null });
    page('d1');
    const dialog = await openIssue();
    const box = within(dialog).getByRole('checkbox');
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(within(dialog).getByText('No email on this invoice and no owner to send to. Add the customer’s email to the draft first.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(api.issue).toHaveBeenCalledWith('d1', false));
  });

  it('says so when the invoice was issued but the email did not go', async () => {
    api.one.mockResolvedValue(draft);
    api.issue.mockResolvedValue({ ...issued, id: 'd1', emailed: false, emailedTo: 'owner@kaveri.in', emailError: 'The mail server did not take it just now.' });
    page('d1');
    const dialog = await openIssue();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Issued. The email did not go: The mail server did not take it just now.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('the page says who it was emailed to and how often it was reminded', async () => {
    api.one.mockResolvedValue({ ...issued, emailTo: 'owner@kaveri.in', sentTo: 'owner@kaveri.in', lastSentAt: '2026-11-17T06:00:00Z', reminderCount: 2, lastRemindedAt: '2026-11-16T06:00:00Z' });
    page();
    expect(await screen.findByText('Emailed to owner@kaveri.in on 17 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Reminded 2 times, last on 16 Nov 2026')).toBeTruthy();
  });

  it('Send again and Send reminder ask first, naming who gets it, then send and read the list again', async () => {
    const inv = { ...issued, emailTo: 'owner@kaveri.in', sentTo: null };
    api.one.mockResolvedValue(inv);
    api.sendAgain.mockResolvedValue({ ...inv, sentTo: 'owner@kaveri.in', lastSentAt: '2026-11-17T06:00:00Z', emailed: true, emailedTo: 'owner@kaveri.in', emailError: null });
    api.remind.mockResolvedValue({ ...inv, reminderCount: 1, lastRemindedAt: '2026-11-17T06:00:00Z', emailed: true, emailedTo: 'owner@kaveri.in', emailError: null });
    page();
    expect(await screen.findByText('Not emailed yet')).toBeTruthy();
    expect(await screen.findByText('Nothing sent yet.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Mark paid' }).filter((b) => b.className.includes('ws-btn--primary'))).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send again' }).className).not.toMatch(/primary/);

    api.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Send again', message: expect.stringContaining('owner@kaveri.in') })));
    expect(api.sendAgain).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(api.sendAgain).toHaveBeenCalledWith('i1'));
    expect(await screen.findByText('Emailed to owner@kaveri.in on 17 Nov 2026')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Sent again to owner@kaveri.in.');
    await waitFor(() => expect(api.sends).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    await waitFor(() => expect(api.remind).toHaveBeenCalledWith('i1'));
    expect(api.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'Send reminder', message: expect.stringContaining('owner@kaveri.in') }));
    expect(await screen.findByText('Reminded once, last on 17 Nov 2026')).toBeTruthy();
    await waitFor(() => expect(api.sends).toHaveBeenCalledTimes(3));
  });

  it('a refusal from the server is shown as it is', async () => {
    api.one.mockResolvedValue({ ...issued, emailTo: 'owner@kaveri.in' });
    api.remind.mockRejectedValue(new Error('A reminder went a moment ago. Wait a minute before sending another.'));
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Send reminder' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('A reminder went a moment ago.')));
  });

  it('nothing to send for a paid, cancelled or draft invoice, or one with nobody to send to', async () => {
    for (const inv of [{ ...issued, status: 'PAID', emailTo: null }, { ...issued, status: 'VOID', emailTo: null }, { ...draft }, { ...issued, emailTo: null }]) {
      api.one.mockResolvedValue(inv);
      const { unmount } = page(inv.id);
      expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull();
      unmount();
    }
  });

  it('stops and allows automatic reminders for one invoice', async () => {
    const inv = { ...issued, emailTo: 'owner@kaveri.in', remindersOff: false };
    api.one.mockResolvedValue(inv);
    api.reminders.mockResolvedValue({ ...inv, remindersOff: true });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop automatic reminders for this invoice' }));
    await waitFor(() => expect(api.reminders).toHaveBeenCalledWith('i1', true));
    expect(await screen.findByRole('button', { name: 'Allow automatic reminders again' })).toBeTruthy();
  });

  it('lists every email sent: what, to whom, and whether a person or the schedule sent it', async () => {
    api.one.mockResolvedValue({ ...issued, emailTo: 'owner@kaveri.in' });
    api.sends.mockResolvedValue({
      sends: [
        { id: 's4', kind: 'REMINDER', step: 'after:7', auto: true, toEmail: 'owner@kaveri.in', createdAt: '2026-12-02T06:00:00Z' },
        { id: 's3', kind: 'REMINDER', step: 'manual', auto: false, toEmail: 'owner@kaveri.in', createdAt: '2026-11-20T06:00:00Z', sentByName: 'Meena Rao' },
        { id: 's2', kind: 'RESEND', step: 'manual', auto: false, toEmail: 'owner@kaveri.in', createdAt: '2026-11-12T06:00:00Z', sentByName: null },
        { id: 's1', kind: 'ISSUED', step: 'manual', auto: false, toEmail: 'accounts@kaveri.in', createdAt: '2026-11-10T06:00:00Z', sentByName: 'Meena Rao' },
      ],
    });
    page();
    const list = within((await screen.findByRole('heading', { name: 'Emails sent' })).closest('section'));
    const rows = await list.findAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Reminder: 7 days overdue')).toBeTruthy();
    expect(within(rows[0]).getByText(/automatic/)).toBeTruthy();
    expect(within(rows[1]).getByText('Reminder: by hand')).toBeTruthy();
    expect(within(rows[1]).getByText(/Meena Rao/)).toBeTruthy();
    expect(within(rows[2]).getByText('Sent again')).toBeTruthy();
    expect(within(rows[3]).getByText('Invoice')).toBeTruthy();
    expect(within(rows[3]).getByText(/To accounts@kaveri.in/)).toBeTruthy();
    expect(sendWords({ kind: 'REMINDER', auto: true, step: 'before:3' })).toBe('Reminder: 3 days before due');
    expect(sendWords({ kind: 'REMINDER', auto: true, step: 'due' })).toBe('Reminder: on the due date');
    expect(sendWords({ kind: 'REMINDER', auto: true, step: 'after:1' })).toBe('Reminder: 1 day overdue');
  });
});

describe('the Overdue view', () => {
  const late = { ...issued, buyerName: 'Kaveri Traders', overdue: true, dueDate: new Date(Date.now() - 9 * 86400000).toISOString(), sentTo: 'owner@kaveri.in', lastRemindedAt: '2026-11-12T06:00:00Z', reminderCount: 2, remindersOff: true };
  const reply = { invoices: [late, { ...late, id: 'i2', number: 'CLOR/26-27/0002', lastRemindedAt: null, reminderCount: 0, remindersOff: false }], hasMore: false, totals: {} };

  it('counts whole days past the due date', () => {
    expect(daysLate('2026-11-10T06:00:00Z', new Date('2026-11-17T04:00:00Z'))).toBe(7);
    expect(daysLate('2026-11-25T06:00:00Z', new Date('2026-11-17T04:00:00Z'))).toBe(0);
  });

  it('shows how late each invoice is and when it was last reminded, only there', async () => {
    api.list.mockResolvedValue(reply);
    render(<Invoices role="BILLING" openInvoice={() => {}} />);
    await screen.findByRole('button', { name: 'CLOR/26-27/0001' });
    expect(screen.queryByRole('columnheader', { name: 'Days late' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Overdue' }));
    expect(await screen.findByRole('columnheader', { name: 'Days late' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Last reminded' })).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith({ status: 'OVERDUE', before: null });
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('9')).toBeTruthy();
    expect(within(rows[1]).getByText('12 Nov 2026, 2 times in all')).toBeTruthy();
    expect(within(rows[1]).getByText('Automatic reminders stopped')).toBeTruthy();
    expect(within(rows[2]).getByText('Never')).toBeTruthy();
    expect(within(rows[2]).queryByText('Automatic reminders stopped')).toBeNull();
  });

  it('Send reminder on a row asks first, sends, and reads the list again', async () => {
    api.list.mockResolvedValue(reply);
    api.remind.mockResolvedValue({ ...late, emailed: true, emailedTo: 'owner@kaveri.in', emailError: null });
    render(<Invoices role="BILLING" openInvoice={() => {}} initialStatus="OVERDUE" />);
    const button = await screen.findByRole('button', { name: 'Send reminder for CLOR/26-27/0001' });
    expect(button.className).not.toMatch(/primary/);
    fireEvent.click(button);
    await waitFor(() => expect(api.remind).toHaveBeenCalledWith('i1'));
    expect(api.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Send reminder', message: expect.stringContaining('owner@kaveri.in') }));
    expect(toast.success).toHaveBeenCalledWith('Reminder sent to owner@kaveri.in.');
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('a read-only operator sees the columns but cannot remind', async () => {
    api.list.mockResolvedValue(reply);
    render(<Invoices role="READ_ONLY" openInvoice={() => {}} initialStatus="OVERDUE" />);
    expect(await screen.findByRole('columnheader', { name: 'Days late' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });
});

describe('Invoice settings', () => {
  const settings = {
    prefix: 'CLOR', dueDays: 15, footer: null, address: null, financialYear: '26-27', nextNumber: 'CLOR/26-27/0001', nextNumberValue: 1,
    gst: { registered: false }, manualPayments: true,
    books: { enabled: false, autoSend: false, accountId: null, orgId: null, branchId: null },
  };
  it('turns renewal invoices off and changes how many days before', async () => {
    api.settings.mockResolvedValue({ ...settings, renewals: { on: true, daysBefore: 7 } });
    api.saveSettings.mockResolvedValue({ ok: true });
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    const box = await screen.findByLabelText('Issue renewal invoices on their own');
    expect(await screen.findByText('No paid subscription renews in the next 30 days.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save renewals' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Days before the period ends'), { target: { value: '10' } });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save renewals' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ renewalsOn: false, renewalDaysBefore: 10 }));
  });
  it('keeps customer-added seats off until Finance switches them on, with the cap and days to pay', async () => {
    api.settings.mockResolvedValue({ ...settings, selfServe: { on: false, maxPerChange: 20, payDays: 14 } });
    api.saveSeats.mockResolvedValue({ selfServe: { on: true, maxPerChange: 10, payDays: 14 } });
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    const box = await screen.findByLabelText('Let customers add seats themselves');
    expect(box.checked).toBe(false);
    expect(screen.getByLabelText('At most at a time').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save seat settings' }).disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText('At most at a time'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save seat settings' }));
    await waitFor(() => expect(api.saveSeats).toHaveBeenCalledWith({ on: true, maxPerChange: 10, payDays: 14 }));
  });
  describe('reminders', () => {
    const reminders = { on: false, daysBefore: [3], onDueDate: true, daysAfter: [3, 7], cap: 4, since: null };
    it('are off until turned on, say what turning them on would do today, and save the schedule', async () => {
      api.settings.mockResolvedValue({ ...settings, reminders, wouldRemindToday: 0, wouldRemindIfOn: 4 });
      api.saveSettings.mockResolvedValue({ ok: true });
      const openTemplates = vi.fn();
      render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} openTemplates={openTemplates} />);
      const box = await screen.findByLabelText('Remind customers automatically');
      expect(box.checked).toBe(false);
      expect(screen.getByLabelText('Days before the due date').disabled).toBe(true);
      expect(screen.queryByText(/would be reminded today/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Save reminders' }).disabled).toBe(true);

      fireEvent.click(box);
      expect(screen.getByText('4 invoices would be reminded today. Invoices issued before today are never reminded automatically.')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Days before the due date'), { target: { value: '7, 3' } });
      fireEvent.change(screen.getByLabelText('Days after the due date'), { target: { value: '3 7 14' } });
      fireEvent.click(screen.getByLabelText('On the due date'));
      fireEvent.change(screen.getByLabelText('Stop after this many reminders'), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
      await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ remindersOn: true, reminderDaysBefore: [7, 3], reminderOnDueDate: false, reminderDaysAfter: [3, 7, 14], reminderCap: 5 }));

      fireEvent.click(screen.getByRole('button', { name: 'See the wording' }));
      expect(openTemplates).toHaveBeenCalled();
    });

    it('say what is wrong before saving, and show the server’s sentence when it refuses', async () => {
      api.settings.mockResolvedValue({ ...settings, reminders, wouldRemindToday: 0 });
      api.saveSettings.mockRejectedValue(new Error('Days after the due date must each be different.'));
      render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
      fireEvent.click(await screen.findByLabelText('Remind customers automatically'));
      fireEvent.change(screen.getByLabelText('Days before the due date'), { target: { value: '9, 7, 5, 3' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
      expect((await screen.findAllByText('Days before the due date: up to three numbers, each from 1 to 30.')).length).toBeGreaterThan(0);
      expect(screen.getByLabelText('Days before the due date').getAttribute('aria-invalid')).toBe('true');
      expect(api.saveSettings).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Days before the due date'), { target: { value: '3' } });
      fireEvent.change(screen.getByLabelText('Days after the due date'), { target: { value: '7, 7' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
      expect(await screen.findByText('Days after the due date must each be different.')).toBeTruthy();
    });

    it('once on, say since when', async () => {
      api.settings.mockResolvedValue({ ...settings, reminders: { ...reminders, on: true, since: '2026-11-17' }, wouldRemindToday: 2 });
      render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
      expect((await screen.findByLabelText('Remind customers automatically')).checked).toBe(true);
      expect(screen.getByText(/On since 17 Nov 2026\./)).toBeTruthy();
      expect(screen.queryByText(/would be reminded today/)).toBeNull();
    });
  });

  it('saves the numbering, and chooses CLOR’s Books company for the connector', async () => {
    api.settings.mockResolvedValue(settings);
    api.saveSettings.mockResolvedValue({ ok: true });
    api.choices.mockResolvedValue({ accounts: [{ id: 'acc', name: 'Clor Applications', code: '1234567890', companies: [{ id: 'org', name: 'Clor Applications Pvt Ltd', branches: [{ id: 'br', name: 'Head office' }] }] }] });
    api.link.mockResolvedValue({ ok: true });
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    expect(await screen.findByText('Next invoice: CLOR/26-27/0001')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Next number'), { target: { value: '41' } });
    expect(screen.getByText(/The next one issued is CLOR\/26-27\/0041/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save numbering' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'CLOR', nextNumber: 41, dueDays: 15 })));

    fireEvent.change(screen.getByLabelText('CLOR’s account'), { target: { value: 'Clor' } });
    fireEvent.change(await screen.findByLabelText('Account'), { target: { value: 'acc' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'org' } });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'br' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this company' }));
    await waitFor(() => expect(api.link).toHaveBeenCalledWith({ accountId: 'acc', orgId: 'org', branchId: 'br' }));
  });

  it('tests the connection and switches the connector on', async () => {
    api.settings.mockResolvedValue({ ...settings, books: { enabled: false, autoSend: false, accountId: 'acc', orgId: 'org', branchId: 'br', companyName: 'Clor Applications Pvt Ltd', branchName: 'Head office', accountName: 'Clor Applications' } });
    api.test.mockResolvedValue({ ok: true, message: 'Connected to Clor Applications Pvt Ltd, branch Head office.' });
    api.link.mockResolvedValue({ ok: true });
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected to Clor Applications Pvt Ltd, branch Head office.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch on' }));
    await waitFor(() => expect(api.link).toHaveBeenCalledWith({ enabled: true }));
  });
});
