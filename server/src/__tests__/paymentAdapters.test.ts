import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

import { CashfreeGateway, cashfreeBase, normalizeCashfree } from '../billing/cashfree.js';
import { RazorpayGateway, normalizeRazorpay } from '../billing/razorpay.js';
import { ManualGateway, manualProblems } from '../billing/gateway.js';
import { rupeesToPaise, type Fetcher } from '../billing/webhookKit.js';

/*
 * The Cashfree and Razorpay adapters against recorded answers in the shape
 * each provider documents. No network: CLOR has no real keys for either, so
 * the success path of Test connection is proved here, not against a sandbox.
 */

type Seen = { url?: string; headers?: Record<string, string>; body?: string };
const answering = (status: number, body: unknown, seen: Seen = {}): Fetcher =>
  (async (url, init) => {
    seen.url = url;
    seen.headers = init.headers;
    seen.body = init.body;
    return { status, text: async () => JSON.stringify(body) };
  }) as Fetcher;
const unreachable: Fetcher = async () => {
  throw new Error('ENOTFOUND');
};

/* Recorded provider answers (documented shapes). */
const CF_ORDER_NOT_FOUND = { message: 'order not found', code: 'order_not_found', type: 'invalid_request_error' };
const CF_AUTH_FAILED = { message: 'authentication Failed', code: 'request_failed', type: 'authentication_error' };
const RZP_PAYMENTS = { entity: 'collection', count: 0, items: [] };
const RZP_AUTH_FAILED = { error: { code: 'BAD_REQUEST_ERROR', description: 'The api key provided is invalid', source: 'NA', step: 'NA', reason: 'NA' } };

const cf = (f: Fetcher, mode: 'TEST' | 'LIVE' = 'TEST') => new CashfreeGateway({ mode, appId: 'TEST10123456789', secretKey: 'cfsk_ma_test_abcdef123456' }, f);
const rzp = (f: Fetcher, keyId = 'rzp_test_AbCdEf123456', mode: 'TEST' | 'LIVE' = 'TEST') => new RazorpayGateway({ mode, keyId, keySecret: 'secretSecret123', webhookSecret: 'whsec_rzp_test' }, f);

describe('Cashfree, Test connection', () => {
  it('asks the sandbox in Test mode, with the documented headers, for an order that cannot exist', async () => {
    const seen: Seen = {};
    const r = await cf(answering(404, CF_ORDER_NOT_FOUND, seen)).testConnection();
    expect(r).toEqual({ ok: true, message: 'Cashfree accepted the test keys.' });
    expect(seen.url).toMatch(/^https:\/\/sandbox\.cashfree\.com\/pg\/orders\/clor_connection_check_\d+$/);
    expect(seen.headers).toMatchObject({ 'x-client-id': 'TEST10123456789', 'x-client-secret': 'cfsk_ma_test_abcdef123456', 'x-api-version': '2023-08-01' });
    expect(cashfreeBase('LIVE')).toBe('https://api.cashfree.com/pg');
  });
  it('says in plain words when the keys are wrong, or Cashfree cannot be reached', async () => {
    expect((await cf(answering(401, CF_AUTH_FAILED)).testConnection()).message).toBe(
      'Cashfree says the App ID or the secret key is wrong. Check that both are the test keys from Developers, API keys in the Cashfree dashboard.',
    );
    expect((await cf(answering(401, CF_AUTH_FAILED), 'LIVE').testConnection()).message).toContain('both are the live keys');
    expect(await cf(unreachable).testConnection()).toEqual({ ok: false, message: 'CLOR could not reach Cashfree. Try again in a few minutes.' });
    expect((await cf(answering(500, { message: 'internal' })).testConnection()).message).toBe('Cashfree answered with an error (500: internal). Try again, or check the keys.');
  });
});

describe('Cashfree webhooks', () => {
  const body = JSON.stringify({
    data: {
      order: { order_id: 'clor_ord_1', order_amount: 1062.0, order_currency: 'INR', order_tags: { accountId: 'acct_1' } },
      payment: { cf_payment_id: 5114910912345, payment_status: 'SUCCESS', payment_amount: 1062.0, payment_currency: 'INR' },
      customer_details: { customer_id: 'acct_1' },
    },
    event_time: '2026-11-09T12:00:00+05:30',
    type: 'PAYMENT_SUCCESS_WEBHOOK',
  });
  const ts = '1731150000000';
  const sig = createHmac('sha256', 'cfsk_ma_test_abcdef123456').update(ts + body).digest('base64');
  it('takes an event signed with the secret key over timestamp + body, and reads it', () => {
    const r = cf(answering(200, {})).checkWebhook(Buffer.from(body), { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({ gateway: 'cashfree', eventId: 'PAYMENT_SUCCESS_WEBHOOK:5114910912345', accountId: 'acct_1', amount: 106200, reference: '5114910912345', subscription: { status: 'active' } });
  });
  it('refuses a forged or unsigned event, saying why', () => {
    const g = cf(answering(200, {}));
    expect(g.checkWebhook(body, { 'x-webhook-signature': sig, 'x-webhook-timestamp': '1' })).toEqual({ ok: false, reason: 'The signature did not match the saved test secret key, so the event was not used. Check the mode and the secret key.' });
    expect(g.checkWebhook(body, {})).toEqual({ ok: false, reason: 'The event had no Cashfree signature, so it was not used.' });
    expect(g.verifyWebhook(body, {})).toBeNull();
  });
  it('a failed payment changes no subscription; subscription events carry their status', () => {
    expect(normalizeCashfree({ type: 'PAYMENT_FAILED_WEBHOOK', data: { payment: { cf_payment_id: 9 }, order: { order_tags: { accountId: 'a' } } } }).subscription).toBeUndefined();
    expect(normalizeCashfree({ type: 'SUBSCRIPTION_STATUS_CHANGED', data: { subscription_details: { subscription_id: 'sub_9', subscription_status: 'ON_HOLD' } } }).subscription).toEqual({ status: 'past_due', gatewaySubscriptionId: 'sub_9' });
  });
});

describe('Razorpay, Test connection', () => {
  it('reads one payment with Basic auth, and says the keys work', async () => {
    const seen: Seen = {};
    expect(await rzp(answering(200, RZP_PAYMENTS, seen)).testConnection()).toEqual({ ok: true, message: 'Razorpay accepted the test keys.' });
    expect(seen.url).toBe('https://api.razorpay.com/v1/payments?count=1');
    expect(seen.headers?.Authorization).toBe(`Basic ${Buffer.from('rzp_test_AbCdEf123456:secretSecret123').toString('base64')}`);
  });
  it('catches a Live key in Test mode before calling, and says when the keys are wrong', async () => {
    let called = false;
    const r = await rzp(
      (async () => {
        called = true;
        return { status: 200, text: async () => '{}' };
      }) as Fetcher,
      'rzp_live_AbCdEf123456',
    ).testConnection();
    expect(called).toBe(false);
    expect(r.message).toBe('This Key ID does not start with rzp_test_, so it is not a test key. Razorpay is in Test mode here.');
    expect((await rzp(answering(401, RZP_AUTH_FAILED)).testConnection()).message).toBe('Razorpay says the Key ID or the Key secret is wrong. Generate a new pair under Account & Settings, API keys in the Razorpay dashboard.');
  });
});

describe('Razorpay webhooks', () => {
  const body = JSON.stringify({
    entity: 'event',
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: 'sub_P1', status: 'active', current_end: 1767225600, notes: { accountId: 'acct_2' } } },
      payment: { entity: { id: 'pay_P1', amount: 106200, currency: 'INR', status: 'captured', notes: {} } },
    },
    created_at: 1731150000,
  });
  const sig = createHmac('sha256', 'whsec_rzp_test').update(body).digest('hex');
  it('takes an event signed with the webhook secret, idempotent on X-Razorpay-Event-Id', () => {
    const r = rzp(answering(200, {})).checkWebhook(body, { 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': 'evt_Qx1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({ gateway: 'razorpay', eventId: 'evt_Qx1', accountId: 'acct_2', amount: 106200, reference: 'pay_P1' });
    expect(r.event.subscription).toEqual({ status: 'active', gatewaySubscriptionId: 'sub_P1', currentPeriodEnd: new Date(1767225600 * 1000) });
  });
  it('refuses a forged one', () => {
    expect(rzp(answering(200, {})).checkWebhook(body, { 'x-razorpay-signature': 'f'.repeat(64) })).toEqual({
      ok: false,
      reason: 'The signature did not match the saved webhook secret, so the event was not used. Check that it is the same secret as on the webhook in Razorpay.',
    });
    expect(normalizeRazorpay({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', amount: 5, notes: { accountId: 'a' } } } } }).subscription).toBeUndefined();
  });
  it('cancels a Razorpay subscription with the documented call; a local one makes no call', async () => {
    const seen: Seen = {};
    await rzp(answering(200, { id: 'sub_P1', status: 'cancelled' }, seen)).cancelSubscription('sub_P1', true);
    expect(seen.url).toBe('https://api.razorpay.com/v1/subscriptions/sub_P1/cancel');
    expect(JSON.parse(seen.body!)).toEqual({ cancel_at_cycle_end: 1 });
    await expect(rzp(answering(400, {})).cancelSubscription('sub_P1', false)).rejects.toThrow('Razorpay did not cancel subscription sub_P1 (400).');
    await rzp(unreachable).cancelSubscription('local_acct', false);
  });
});

describe('manual payments', () => {
  it('are ready with a UPI ID or a whole bank account, and say what is missing', async () => {
    expect(manualProblems({})).toEqual(['Add CLOR’s UPI ID, or the bank account customers pay into.']);
    expect(manualProblems({ bank: { accountNumber: '123456789012' } })).toEqual(['Add the name on the bank account.', 'Add the IFSC code of the branch.']);
    expect(await new ManualGateway({ upiId: 'clor@okaxis', bank: { accountName: 'CLOR', accountNumber: '123456789012', ifsc: 'HDFC0001234' } }).testConnection()).toEqual({
      ok: true,
      message: 'Manual payments are ready. Customers are shown UPI ID clor@okaxis and the bank account ending 9012.',
    });
  });
});

it('rupees as providers send them become paise without floating point', () => {
  expect(rupeesToPaise(1062)).toBe(106200);
  expect(rupeesToPaise('1062.5')).toBe(106250);
  expect(rupeesToPaise(0.29)).toBe(29);
  expect(rupeesToPaise('12.345')).toBe(1234);
  expect(rupeesToPaise('-1')).toBeNull();
});
