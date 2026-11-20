import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The confirms in front of the console's money changes: each one says the consequence before
 * it goes (the provider replaced and Live or Test, how many renewal invoices to whom, the GST
 * rate old against new, a short payment), and saying no sends nothing.
 */
const api = vi.hoisted(() => ({
  confirm: vi.fn(),
  payments: vi.fn(),
  activate: vi.fn(),
  events: vi.fn(),
  settings: vi.fn(),
  renewals: vi.fn(),
  runRenewals: vi.fn(),
  tax: vi.fn(),
  saveTax: vi.fn(),
  one: vi.fn(),
  paid: vi.fn(),
  sends: vi.fn(),
}));
vi.mock('./api', () => ({
  opsPayments: () => api.payments(),
  opsActivateProvider: (c) => api.activate(c),
  opsPaymentEvents: (p) => api.events(p),
  opsSaveProvider: vi.fn(),
  opsProviderMode: vi.fn(),
  opsTestProvider: vi.fn(),
  opsRetryPaymentEvent: vi.fn(),
  opsPaymentAccounts: () => Promise.resolve({ accounts: [] }),
  opsRecordPayment: vi.fn(),
  opsInvoicing: () => api.settings(),
  opsSaveInvoicing: vi.fn(),
  opsSaveSelfServe: vi.fn(),
  opsRenewals: () => api.renewals(),
  opsRunRenewals: () => api.runRenewals(),
  opsBooksChoices: () => Promise.resolve({ accounts: [] }),
  opsSaveBooksLink: vi.fn(),
  opsTestBooks: vi.fn(),
  opsTax: () => api.tax(),
  opsSaveTax: (b) => api.saveTax(b),
  opsInvoice: (id) => api.one(id),
  opsInvoiceSends: () => api.sends(),
  opsMarkInvoicePaid: (id, b) => api.paid(id, b),
  opsInvoices: vi.fn(),
  opsInvoiceStart: vi.fn(),
  opsNewInvoice: vi.fn(),
  opsSaveInvoice: vi.fn(),
  opsDiscardInvoice: vi.fn(),
  opsIssueInvoice: vi.fn(),
  opsVoidInvoice: vi.fn(),
  opsSendInvoiceToBooks: vi.fn(),
  opsSendInvoiceAgain: vi.fn(),
  opsRemindInvoice: vi.fn(),
  opsInvoiceReminders: vi.fn(),
  opsTdsCertificate: vi.fn(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, confirmDialog: (o) => api.confirm(o) }));

import { Payments, activateWords } from './Payments';
import { InvoiceSettings, renewalRunWords } from './InvoiceSettings';
import { Settings, taxChangeWords } from './Settings';
import { InvoicePage, markPaidWords } from './Invoices';

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.events.mockResolvedValue({ events: [], next: null });
  api.sends.mockResolvedValue({ sends: [] });
});

describe('switching the active payment gateway', () => {
  const razorpay = { code: 'razorpay', name: 'Razorpay', enabled: true, active: false, mode: 'LIVE', lastTest: null, missing: [], webhookUrl: 'https://x', test: { keyId: '', saved: {} }, live: { keyId: 'rzp_live_1', saved: { keySecret: '1234' } } };
  const cashfree = { code: 'cashfree', name: 'Cashfree', enabled: true, active: true, mode: 'TEST', lastTest: null, missing: [], webhookUrl: 'https://y', test: { appId: 'a', saved: {} }, live: { appId: '', saved: {} } };

  it('names the provider replaced and that the new one is on Live keys, then switches', async () => {
    api.payments.mockResolvedValue({ providers: [razorpay, cashfree] });
    api.confirm.mockResolvedValue(true);
    api.activate.mockResolvedValue({ providers: [{ ...razorpay, active: true }, { ...cashfree, active: false }] });
    render(<Payments role="BILLING" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Razorpay' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Razorpay the active provider' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    const asked = api.confirm.mock.calls[0][0];
    expect(asked.title).toBe('Make Razorpay (Live) the active provider?');
    expect(asked.message).toMatch(/Cashfree \(Test\) stops taking payments/);
    expect(asked.message).toMatch(/real money/);
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('razorpay'));
  });

  it('saying no changes nothing', async () => {
    api.payments.mockResolvedValue({ providers: [razorpay, cashfree] });
    api.confirm.mockResolvedValue(false);
    render(<Payments role="BILLING" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Razorpay' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Make Razorpay the active provider' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    expect(api.activate).not.toHaveBeenCalled();
  });

  it('says Test keys move no real money', () => {
    const w = activateWords({ ...razorpay, mode: 'TEST' }, { code: 'manual', name: 'Manual: UPI and bank transfer' });
    expect(w.title).toBe('Make Razorpay (Test) the active provider?');
    expect(w.message).toMatch(/^Manual: UPI and bank transfer stops taking payments\./);
    expect(w.message).toMatch(/no real money moves/);
  });
});

describe('issuing the renewal invoices due now', () => {
  const settings = { prefix: 'CLOR', dueDays: 15, financialYear: '26-27', nextNumber: 'CLOR/26-27/0001', nextNumberValue: 1, gst: { registered: false }, manualPayments: true, renewals: { on: true, daysBefore: 7 }, books: { enabled: false, autoSend: false } };
  const due = [
    { accountId: 'a1', name: 'Kaveri Traders', planName: 'People', interval: 'month', renewsOn: '2026-11-25', invoice: null, dueNow: true },
    { accountId: 'a2', name: 'Godavari Foods', planName: 'Books', interval: 'year', renewsOn: '2026-11-26', invoice: null, dueNow: true },
    { accountId: 'a3', name: 'Later Ltd', planName: 'Books', interval: 'month', renewsOn: '2026-12-15', invoice: null, dueNow: false },
  ];

  it('asks first with the count and the customers, then issues', async () => {
    api.settings.mockResolvedValue(settings);
    api.renewals.mockResolvedValue({ upcoming: due });
    api.confirm.mockResolvedValue(true);
    api.runRenewals.mockResolvedValue({ issued: 2, failed: [] });
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue the 2 due now' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    const asked = api.confirm.mock.calls[0][0];
    expect(asked.title).toBe('Issue 2 renewal invoices?');
    expect(asked.message).toMatch(/2 invoices are issued now/);
    expect(asked.message).toMatch(/Kaveri Traders and Godavari Foods/);
    expect(asked.message).not.toMatch(/Later Ltd/);
    await waitFor(() => expect(api.runRenewals).toHaveBeenCalled());
  });

  it('saying no issues nothing', async () => {
    api.settings.mockResolvedValue(settings);
    api.renewals.mockResolvedValue({ upcoming: due });
    api.confirm.mockResolvedValue(false);
    render(<InvoiceSettings role="BILLING" openTax={() => {}} openPayments={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Issue the 2 due now' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    expect(api.runRenewals).not.toHaveBeenCalled();
  });

  it('gives the total when each renewal carries its amount, and shortens a long list', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ name, amount: (i + 1) * 100000 }));
    const w = renewalRunWords(rows);
    expect(w.title).toBe('Issue 5 renewal invoices for ₹15,000?');
    expect(w.message).toMatch(/A, B, C and 2 more/);
    expect(w.message).toMatch(/Together they bill ₹15,000/);
    expect(w.confirmLabel).toBe('Issue 5 invoices');
  });
});

describe('saving the GST rate', () => {
  const tax = { registered: true, gstin: '29AABCU9603R1ZJ', legalName: 'CLOR Applications Private Limited', stateCode: '29', sac: '998314', ratePercent: 18, note: 'GST is added to quotes.' };

  it('asks first with the old and new rate and where it applies, then saves', async () => {
    api.tax.mockResolvedValue({ tax, rates: [0, 5, 12, 18, 28] });
    api.confirm.mockResolvedValue(true);
    api.saveTax.mockResolvedValue({ tax: { ...tax, ratePercent: 12 } });
    render(<Settings role="BILLING" />);
    fireEvent.change(await screen.findByLabelText('Rate'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tax settings' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    const asked = api.confirm.mock.calls[0][0];
    expect(asked.message).toMatch(/Rate: 18% → 12%/);
    expect(asked.message).toMatch(/every quote and every invoice issued adds GST at 12%/);
    expect(asked.message).toMatch(/Invoices already issued keep the GST they were issued with/);
    await waitFor(() => expect(api.saveTax).toHaveBeenCalledWith(expect.objectContaining({ ratePercent: 12 })));
  });

  it('saying no saves nothing', async () => {
    api.tax.mockResolvedValue({ tax, rates: [0, 5, 12, 18, 28] });
    api.confirm.mockResolvedValue(false);
    render(<Settings role="BILLING" />);
    fireEvent.change(await screen.findByLabelText('Rate'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tax settings' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    expect(api.saveTax).not.toHaveBeenCalled();
  });

  it('names a registration turned off', () => {
    const w = taxChangeWords({ registered: true, ratePercent: 18, gstin: 'X' }, { registered: false, ratePercent: 18, gstin: 'X' });
    expect(w.message).toMatch(/GST registered: yes → no/);
    expect(w.message).toMatch(/no quote or invoice carries GST/);
    expect(taxChangeWords({ registered: false, ratePercent: 18 }, { registered: false, ratePercent: '18' })).toBeNull();
  });
});

describe('marking an invoice paid', () => {
  const inv = {
    id: 'i1', number: 'CLOR/26-27/0001', accountId: 'a1', account: { id: 'a1', name: 'Kaveri Traders' }, status: 'ISSUED', overdue: false,
    issueDate: '2026-11-10T06:00:00Z', dueDate: '2026-11-25T06:00:00Z', lines: [{ description: 'CLOR People', quantity: 1, unitAmount: 118000, amount: 118000 }],
    subtotal: 118000, tax: { charged: false }, taxTotal: 0, total: 118000, buyer: { name: 'Kaveri Traders' }, seller: { legalName: 'CLOR' }, months: 3, booksStatus: 'NOT_SENT',
  };

  it('warns plainly when the amount is short, and saying no sends nothing', async () => {
    api.one.mockResolvedValue(inv);
    api.confirm.mockResolvedValue(false);
    render(<InvoicePage id="i1" role="BILLING" back={() => {}} openCustomer={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
    fireEvent.change(await screen.findByLabelText('UTR or bank reference'), { target: { value: 'UTR123456789012' } });
    fireEvent.change(screen.getByLabelText('Amount received, ₹'), { target: { value: '1000' } });
    expect(screen.getByText(/this is ₹180 short/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalled());
    const asked = api.confirm.mock.calls[0][0];
    expect(asked.title).toBe('Mark CLOR/26-27/0001 paid, ₹180 short?');
    expect(asked.message).toMatch(/₹1,000 from Kaveri Traders/);
    expect(asked.message).toMatch(/3 months more/);
    expect(asked.message).toMatch(/still marked paid in full/);
    expect(asked.confirmLabel).toBe('Mark paid anyway');
    expect(asked.tone).toBe('danger');
    expect(api.paid).not.toHaveBeenCalled();
  });

  it('a full amount asks without a warning, then marks it paid', async () => {
    api.one.mockResolvedValue(inv);
    api.confirm.mockResolvedValue(true);
    api.paid.mockResolvedValue({ ...inv, status: 'PAID', paidUntil: '2027-02-10T00:00:00Z' });
    render(<InvoicePage id="i1" role="BILLING" back={() => {}} openCustomer={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
    fireEvent.change(await screen.findByLabelText('UTR or bank reference'), { target: { value: 'UTR123456789012' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.paid).toHaveBeenCalledWith('i1', expect.objectContaining({ amount: 118000 })));
    expect(api.confirm.mock.calls[0][0].title).toBe('Mark CLOR/26-27/0001 paid?');
    expect(api.confirm.mock.calls[0][0].message).not.toMatch(/short/);
  });

  it('TDS kept back is not a shortfall', () => {
    expect(markPaidWords(inv, 108000, 10000).short).toBe(0);
    expect(markPaidWords(inv, 100000, 10000).message).toMatch(/₹80 short/);
  });

  it('a missing UTR is shown on the field, with no confirm', async () => {
    api.one.mockResolvedValue(inv);
    render(<InvoicePage id="i1" role="BILLING" back={() => {}} openCustomer={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark paid' }));
    expect((await screen.findAllByText(/Enter the UTR or bank reference/)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('UTR or bank reference').getAttribute('aria-invalid')).toBe('true');
    expect(api.confirm).not.toHaveBeenCalled();
  });
});
