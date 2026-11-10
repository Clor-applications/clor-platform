import type { ConnectionResult, GatewayCustomer, GatewaySubscription, NormalizedEvent, PaymentGateway, WebhookCheck } from './gateway.js';
import { call, defaultFetch, header, hmac, parseJson, rawText, rupeesToPaise, sameText, type Fetcher } from './webhookKit.js';

/**
 * Cashfree Payment Gateway, built to its documented API (version 2023-08-01):
 *   - every call carries x-client-id (the App ID), x-client-secret and x-api-version;
 *   - Test mode talks to https://sandbox.cashfree.com/pg, Live to https://api.cashfree.com/pg;
 *   - a webhook is signed as base64(HMAC-SHA256(x-webhook-timestamp + raw body))
 *     with the secret key, in x-webhook-signature. Cashfree has no separate
 *     webhook secret: the secret key signs.
 *
 * Test connection asks for an order that cannot exist: "order not found"
 * means Cashfree accepted the keys, "authentication failed" means it did not.
 * Nothing is created and nothing is charged.
 */
export type CashfreeKeys = { mode: 'TEST' | 'LIVE'; appId: string; secretKey: string };

export const CASHFREE_API_VERSION = '2023-08-01';
export const cashfreeBase = (mode: 'TEST' | 'LIVE') => (mode === 'LIVE' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg');

const SUBSCRIPTION_STATUS: Record<string, string> = { ACTIVE: 'active', BANK_APPROVAL_PENDING: 'trialing', ON_HOLD: 'past_due', CUSTOMER_PAUSED: 'paused', PAUSED: 'paused', CANCELLED: 'cancelled', CUSTOMER_CANCELLED: 'cancelled', COMPLETED: 'cancelled', EXPIRED: 'cancelled' };

export class CashfreeGateway implements PaymentGateway {
  readonly name = 'cashfree';
  readonly external = true;
  constructor(
    private readonly keys: CashfreeKeys,
    private readonly fetcher: Fetcher = defaultFetch,
  ) {}

  private headers() {
    return { 'x-client-id': this.keys.appId, 'x-client-secret': this.keys.secretKey, 'x-api-version': CASHFREE_API_VERSION, Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  async testConnection(): Promise<ConnectionResult> {
    const which = this.keys.mode === 'LIVE' ? 'live' : 'test';
    if (!this.keys.appId || !this.keys.secretKey) return { ok: false, message: `Save Cashfree’s ${which} App ID and secret key first.` };
    const r = await call(this.fetcher, `${cashfreeBase(this.keys.mode)}/orders/clor_connection_check_${Date.now()}`, { method: 'GET', headers: this.headers() });
    if (r.status === 0) return { ok: false, message: 'CLOR could not reach Cashfree. Try again in a few minutes.' };
    if (r.status === 404 || r.status === 200) return { ok: true, message: `Cashfree accepted the ${which} keys.` };
    if (r.status === 401 || r.status === 403)
      return { ok: false, message: `Cashfree says the App ID or the secret key is wrong. Check that both are the ${which} keys from Developers, API keys in the Cashfree dashboard.` };
    return { ok: false, message: `Cashfree answered with an error (${r.status}${r.body?.message ? `: ${r.body.message}` : ''}). Try again, or check the keys.` };
  }

  checkWebhook(rawBody: string | Buffer, headers: Record<string, unknown>): WebhookCheck {
    const raw = rawText(rawBody);
    const sig = header(headers, 'x-webhook-signature');
    const ts = header(headers, 'x-webhook-timestamp');
    if (!sig || !ts) return { ok: false, reason: 'The event had no Cashfree signature, so it was not used.' };
    if (!this.keys.secretKey) return { ok: false, reason: 'No Cashfree secret key is saved, so the event could not be checked.' };
    if (!sameText(sig, hmac(this.keys.secretKey, ts + raw, 'base64')))
      return { ok: false, reason: `The signature did not match the saved ${this.keys.mode === 'LIVE' ? 'live' : 'test'} secret key, so the event was not used. Check the mode and the secret key.` };
    const body = parseJson(raw);
    if (!body || typeof body.type !== 'string') return { ok: false, reason: 'The event was signed but could not be read.' };
    return { ok: true, event: normalizeCashfree(body) };
  }

  verifyWebhook(rawBody: string | Buffer, headers: Record<string, unknown>): NormalizedEvent | null {
    const r = this.checkWebhook(rawBody, headers);
    return r.ok ? r.event : null;
  }

  async createCustomer(input: { accountId: string }): Promise<GatewayCustomer> {
    /* Cashfree takes the customer with each order; CLOR's account id is the customer id. */
    return { customerId: input.accountId };
  }

  async createSubscription(input: { accountId: string; trialDays?: number | null }): Promise<GatewaySubscription> {
    /* Checkout is not built yet: a subscription starts locally, as with manual billing, and nothing is charged. */
    const trial = input.trialDays && input.trialDays > 0;
    return { subscriptionId: `local_${input.accountId}`, status: trial ? 'trialing' : 'active', currentPeriodEnd: trial ? new Date(Date.now() + input.trialDays! * 86400000) : null };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!subscriptionId || subscriptionId.startsWith('local_')) return;
    const r = await call(this.fetcher, `${cashfreeBase(this.keys.mode)}/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, {
      method: 'POST',
      headers: { ...this.headers(), 'x-api-version': '2025-01-01' },
      body: JSON.stringify({ subscription_id: subscriptionId, action: 'CANCEL' }),
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`Cashfree did not cancel subscription ${subscriptionId} (${r.status}).`);
  }
}

/** A Cashfree webhook body, provider-neutral. */
export function normalizeCashfree(body: any): NormalizedEvent {
  const data = body.data || {};
  const payment = data.payment || {};
  const order = data.order || {};
  const sub = data.subscription_details || data.subscription || {};
  const accountId = order.order_tags?.accountId || data.customer_details?.customer_id || sub.subscription_tags?.accountId || null;
  const reference = payment.cf_payment_id != null ? String(payment.cf_payment_id) : order.order_id || sub.subscription_id || null;
  const ev: NormalizedEvent = {
    gateway: 'cashfree',
    eventId: `${body.type}:${reference ?? body.event_time ?? ''}`,
    type: body.type,
    accountId,
    amount: rupeesToPaise(payment.payment_amount ?? order.order_amount),
    reference,
    raw: body,
  };
  if (body.type === 'PAYMENT_SUCCESS_WEBHOOK' && accountId) ev.subscription = { status: 'active' };
  if (/^SUBSCRIPTION_/.test(body.type) && SUBSCRIPTION_STATUS[sub.subscription_status]) {
    ev.subscription = { status: SUBSCRIPTION_STATUS[sub.subscription_status], gatewaySubscriptionId: sub.subscription_id || undefined };
  }
  return ev;
}
