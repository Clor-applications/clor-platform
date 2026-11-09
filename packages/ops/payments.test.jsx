import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  mode: vi.fn(),
  activate: vi.fn(),
  test: vi.fn(),
  events: vi.fn(),
  retry: vi.fn(),
  accounts: vi.fn(),
  record: vi.fn(),
}));
vi.mock('./api', () => ({
  opsPayments: () => api.list(),
  opsSaveProvider: (c, b) => api.save(c, b),
  opsProviderMode: (c, m, w) => api.mode(c, m, w),
  opsActivateProvider: (c) => api.activate(c),
  opsTestProvider: (c) => api.test(c),
  opsPaymentEvents: (p) => api.events(p),
  opsRetryPaymentEvent: (id) => api.retry(id),
  opsPaymentAccounts: (q) => api.accounts(q),
  opsRecordPayment: (b) => api.record(b),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Payments } from './Payments';

const razorpay = {
  code: 'razorpay', name: 'Razorpay', enabled: true, active: false, mode: 'TEST', lastTest: null, missing: [],
  webhookUrl: 'https://api.clor.in/api/billing/webhook/razorpay',
  test: { keyId: 'rzp_test_AbCdEf123456', saved: { keySecret: '9876', webhookSecret: null } },
  live: { keyId: '', saved: { keySecret: null, webhookSecret: null } },
};
const cashfree = { code: 'cashfree', name: 'Cashfree', enabled: false, active: false, mode: 'TEST', lastTest: null, missing: ['Turn Cashfree on first.'], webhookUrl: 'https://api.clor.in/api/billing/webhook/cashfree', test: { appId: '', saved: { secretKey: null } }, live: { appId: '', saved: { secretKey: null } } };
const manual = { code: 'manual', name: 'Manual: UPI and bank transfer', enabled: true, active: true, mode: 'TEST', lastTest: { ok: true, message: 'Manual payments are ready.' }, missing: [], manual: { upiId: 'clor@okaxis', bank: null } };
const list = { providers: [cashfree, razorpay, manual] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.list.mockResolvedValue(list);
  api.events.mockResolvedValue({ events: [], next: null });
});

describe('Payments', () => {
  it('lists the providers and says which one customers pay through', async () => {
    render(<Payments role="BILLING" />);
    expect(await screen.findByText('Customers pay through Manual: UPI and bank transfer')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[3]).getByText('Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a payment' })).toBeTruthy();
  });

  it('shows a saved secret only by its last four, replaces it on request, and saves only what was typed', async () => {
    api.save.mockResolvedValue({ changed: ['test webhookSecret'], providers: list.providers });
    render(<Payments role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Razorpay' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Saved, ends in/)[0].textContent).toContain('9876');
    expect(within(dialog).getByDisplayValue('https://api.clor.in/api/billing/webhook/razorpay')).toBeTruthy();
    fireEvent.change(within(dialog).getAllByLabelText('Webhook secret')[0], { target: { value: 'whsec_typed_1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const [code, body] = api.save.mock.calls[0];
    expect(code).toBe('razorpay');
    expect(body.test).toEqual({ id: 'rzp_test_AbCdEf123456', secrets: { webhookSecret: 'whsec_typed_1234' } });
    expect(body.live.secrets).toEqual({});
  });

  it('Live needs the word typed out before it is asked for', async () => {
    api.mode.mockResolvedValue({ providers: [cashfree, { ...razorpay, mode: 'LIVE' }, manual] });
    render(<Payments role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Razorpay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Live mode…' }));
    const go = await screen.findByRole('button', { name: 'Switch to Live' });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type LIVE to confirm'), { target: { value: 'live' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(api.mode).toHaveBeenCalledWith('razorpay', 'LIVE', 'LIVE'));
  });

  it('a provider that is not ready says what is missing and cannot be made active', async () => {
    render(<Payments role="BILLING" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cashfree' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Turn Cashfree on first.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Make Cashfree the active provider' }).disabled).toBe(true);
  });

  it('the log offers Retry where it helps, and records a payment by hand in rupees', async () => {
    api.events.mockResolvedValue({
      events: [{ id: 'e1', at: '2026-11-09T10:00:00Z', gateway: 'razorpay', what: 'Payment received', accountName: 'Kave Traders', accountId: 'a1', amount: 106200, reference: 'pay_1', status: 'RECORDED', detail: 'This account has no subscription yet, so nothing changed. Retry once it has one.', canRetry: true }],
      next: null,
    });
    api.retry.mockResolvedValue({ status: 'APPLIED', detail: 'The subscription is now active.' });
    api.accounts.mockResolvedValue({ accounts: [{ id: 'a1', name: 'Kave Traders', code: '4831920657', subscription: { status: 'trialing', currentPeriodEnd: null } }] });
    api.record.mockResolvedValue({ status: 'APPLIED', paidUntil: '2026-12-09T00:00:00Z' });
    render(<Payments role="BILLING" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Payments log' }));
    expect((await screen.findAllByText('₹1,062')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('e1'));
    expect((await screen.findAllByText('Applied', { selector: '.ws-pill' })).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kave Traders' }));
    fireEvent.change(screen.getByLabelText('Amount received, ₹'), { target: { value: '1,062' } });
    fireEvent.change(screen.getByLabelText('UTR or bank reference'), { target: { value: '412345678901' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.record).toHaveBeenCalled());
    expect(api.record.mock.calls[0][0]).toMatchObject({ accountId: 'a1', amount: 106200, reference: '412345678901', months: 1 });
  });

  it('SUPPORT can look but not change', async () => {
    render(<Payments role="SUPPORT" />);
    await screen.findByText('Customers pay through Manual: UPI and bank transfer');
    expect(screen.queryByRole('button', { name: 'Record a payment' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Razorpay' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Replace' })).toBeNull();
  });
});
