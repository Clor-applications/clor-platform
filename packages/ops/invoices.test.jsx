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
}));
vi.mock('./api', () => ({
  opsInvoices: (p) => api.list(p),
  opsInvoice: (id) => api.one(id),
  opsInvoiceStart: (a) => api.start(a),
  opsNewInvoice: (b) => api.create(b),
  opsSaveInvoice: (id, b) => api.save(id, b),
  opsDiscardInvoice: (id) => api.discard(id),
  opsIssueInvoice: (id) => api.issue(id),
  opsMarkInvoicePaid: (id, b) => api.paid(id, b),
  opsVoidInvoice: (id, r) => api.void(id, r),
  opsSendInvoiceToBooks: (id) => api.books(id),
  opsPaymentAccounts: (q) => api.accounts(q),
  opsInvoicing: () => api.settings(),
  opsSaveInvoicing: (b) => api.saveSettings(b),
  opsBooksChoices: (q) => api.choices(q),
  opsSaveBooksLink: (b) => api.link(b),
  opsTestBooks: () => api.test(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { InvoicePage, Invoices } from './Invoices';
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
});

describe('Invoices list', () => {
  it('shows each invoice with its status and amount, and what is unpaid', async () => {
    api.list.mockResolvedValue({ invoices: [{ ...issued, buyerName: 'Kaveri Traders', overdue: true }, { id: 'd1', number: null, status: 'DRAFT', total: 100000, buyerName: 'Godavari Foods', booksStatus: 'NOT_SENT' }], hasMore: false, totals: { ISSUED: { count: 1, amount: 247500 }, OVERDUE: { count: 1, amount: 247500 } } });
    const open = vi.fn();
    render(<Invoices role="BILLING" openInvoice={open} />);
    expect(await screen.findByText('1 unpaid, ₹2,475; 1 overdue')).toBeTruthy();
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

describe('Invoice settings', () => {
  const settings = {
    prefix: 'CLOR', dueDays: 15, footer: null, address: null, financialYear: '26-27', nextNumber: 'CLOR/26-27/0001', nextNumberValue: 1,
    gst: { registered: false }, manualPayments: true,
    books: { enabled: false, autoSend: false, accountId: null, orgId: null, branchId: null },
  };
  it('saves the numbering, and chooses CLOR’s Books company for the connector', async () => {
    api.settings.mockResolvedValue(settings);
    api.saveSettings.mockResolvedValue({ ok: true });
    api.choices.mockResolvedValue({ accounts: [{ id: 'acc', name: 'Clor Applications', code: '1234567890', companies: [{ id: 'org', name: 'Clor Applications Pvt Ltd', branches: [{ id: 'br', name: 'Head office' }] }] }] });
    api.link.mockResolvedValue({ ok: true });
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    expect(await screen.findByText('Next invoice: CLOR/26-27/0001')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Next number'), { target: { value: '41' } });
    expect(screen.getByText(/The next one issued is CLOR\/26-27\/0041/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
